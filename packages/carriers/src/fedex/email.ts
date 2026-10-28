/**
 * FedEx's track-by-email service: email up to 30 tracking numbers, one per line, to
 * track@fedex.com and FedEx replies (from TrackingUpdates@fedex.com, subject
 * "FedEx track by e-mail results - <first number>") with each parcel's status and every scan.
 * It is FedEx's own public service and needs no account or key, unlike fedex.com and the FedEx
 * API, which refuse scripts or need a key.
 *
 * This file only reads the reply. Sending the request and fetching the reply is the mailbox's job.
 */
export const FEDEX_TRACK_EMAIL = "track@fedex.com";
export const FEDEX_TRACK_EMAIL_BATCH = 30;

export interface FedExEmailScan {
  /** As FedEx writes it, in the scan location's local time: "Oct 26, 2026 7:52 AM". */
  localTime: string;
  activity: string;
  location: string | null;
}

export interface FedExEmailParcel {
  trackingNumber: string;
  /** The summary status: "Out for delivery", "Delivered", "Delivery exception"... */
  status: string;
  /** When the summary status happened, local time as written. */
  statusTime: string | null;
  destination: string | null;
  shipDate: string | null;
  scheduledDelivery: string | null;
  service: string | null;
  /** Oldest first. */
  scans: FedExEmailScan[];
  delivered: boolean;
}

export interface FedExEmailResult {
  parcels: FedExEmailParcel[];
  /** Numbers FedEx listed under "INVALID" (unknown to FedEx). */
  invalid: string[];
}

const RULE = /^-{20,}$/;
const DATE = String.raw`[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M`;
const SUMMARY_ROW = new RegExp(String.raw`^(\d{10,22})\s+(.*?)\s*(${DATE})\s*(.*)$`);
const SCAN_ROW = new RegExp(String.raw`^(${DATE})\s+(.+)$`);

const field = (block: string, name: string) =>
  new RegExp(String.raw`^\s*${name}\s*:\s*(.+)$`, "m").exec(block)?.[1]?.trim() ?? null;

/** Reads FedEx's plain-text reply into one entry per tracking number. */
export function parseFedExTrackEmail(text: string): FedExEmailResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const summaries: {
    trackingNumber: string;
    status: string;
    time: string | null;
    destination: string | null;
  }[] = [];
  const invalid: string[] = [];

  // Summary table: "879041083962 Out for deliveryOct 26, 2026 7:52 AM RENNES, 35, FR".
  // FedEx sometimes omits the space before the date, hence the lazy status match.
  for (const raw of lines) {
    const line = raw.trim();
    const row = SUMMARY_ROW.exec(line);
    if (row) {
      summaries.push({
        trackingNumber: row[1]!,
        status: row[2]!.trim(),
        time: row[3]!,
        destination: row[4]!.trim() || null,
      });
    } else if (/^\d{10,22}\s+\S/.test(line) && !SCAN_ROW.test(line) && summaries.length === 0) {
      const [number, ...rest] = line.split(/\s+/);
      summaries.push({
        trackingNumber: number!,
        status: rest.join(" "),
        time: null,
        destination: null,
      });
    }
  }
  const invalidAt = lines.findIndex((l) => l.trim() === "INVALID");
  if (invalidAt >= 0) {
    for (const raw of lines.slice(invalidAt + 1)) {
      const line = raw.trim();
      if (/^\d{10,22}$/.test(line)) invalid.push(line);
      else if (line && !/^\d/.test(line)) break;
    }
  }

  // Detailed results: one "Ship date :" block per parcel, in the same order as the summary.
  const details = text
    .split(/^\s*Ship date\s*:/m)
    .slice(1)
    .map((block) => `Ship date :${block}`);
  const parcels = summaries
    .filter((s) => !invalid.includes(s.trackingNumber))
    .map((summary, i) => {
      const block = details[i] ?? "";
      const scans: FedExEmailScan[] = [];
      const blockLines = block.split("\n");
      for (let j = 0; j < blockLines.length; j++) {
        const line = blockLines[j]!.trim();
        if (RULE.test(line)) continue;
        const scan = SCAN_ROW.exec(line);
        if (!scan) continue;
        const next = blockLines[j + 1]?.trim() ?? "";
        // The location sits on its own indented line under the activity, when there is one.
        const location = next && !SCAN_ROW.test(next) && !RULE.test(next) ? next : null;
        scans.push({ localTime: scan[1]!, activity: scan[2]!.trim(), location });
      }
      scans.reverse();
      const status = summary.status;
      return {
        trackingNumber: summary.trackingNumber,
        status,
        statusTime: summary.time,
        destination: summary.destination ?? field(block, "Destination"),
        shipDate: field(block, "Ship date"),
        scheduledDelivery: field(block, "Scheduled delivery"),
        service: field(block, "Service type"),
        scans,
        delivered:
          /^delivered\b/i.test(status) || /^delivered\b/i.test(scans.at(-1)?.activity ?? ""),
      };
    });
  return { parcels, invalid };
}

/** "Oct 26, 2026 7:52 AM" → a Date read as UTC (FedEx gives the scan's local time, no zone). */
export function fedExEmailTime(localTime: string): Date | null {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ([AP])M$/.exec(localTime.trim());
  if (!m) return null;
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(m[1]!);
  if (month < 0) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "P") hour += 12;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5])));
}

/** The email body that asks FedEx about these numbers (at most 30 per email). */
export function fedExTrackRequestBody(trackingNumbers: string[]): string {
  if (trackingNumbers.length > FEDEX_TRACK_EMAIL_BATCH) {
    throw new Error(`FedEx answers at most ${FEDEX_TRACK_EMAIL_BATCH} numbers per email`);
  }
  return trackingNumbers.join("\n");
}
