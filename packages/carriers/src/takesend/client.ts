import { RateLimitedError } from "../adapter";
import type {
  AggregatorClient,
  AggregatorResult,
  AttributedEvent,
} from "../aggregators/aggregator";
import type { FetchLike } from "../aggregators/http";

/**
 * Takesend's public tracking page (a Kingtrans "WebTrack" system), used for the parcels NOMS sends
 * through Takesend: UPS (SZUPS_X03), Sagawa (SAGAWA), PostNL, Singapore Post and others. It
 * relays the carrier's own scans for UPS, so UPS parcels can be followed without going through
 * ups.com, which blocks scripts. For Sagawa it only shows Takesend's own Shenzhen scans; Sagawa's
 * inquiry page has the Japanese leg.
 *
 * Plain HTTP on a non-standard port, no key. Not a documented interface: it can change or be
 * unreachable from some networks.
 */
export const TAKESEND_TRACK_URL = "http://k5.takesend.com:8180/WebTrack?action=repeat";

export interface TakesendScan {
  /** Local time at the scan's location; Takesend gives no time zone. */
  localTime: string;
  place: string | null;
  message: string;
}

export interface TakesendParcel {
  trackingNumber: string;
  found: boolean;
  scans: TakesendScan[];
  /** The latest event, which Takesend also gives on its own when it has no scan list. */
  latest: TakesendScan | null;
  /** Takesend's own status: trackstatus 200 (签收, "Delivery") means delivered. */
  delivered: boolean;
}

const ATTRIBUTE = /(\w+)="([^"]*)"/g;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key, value] of tag.matchAll(ATTRIBUTE)) out[key!] = decode(value!);
  return out;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const tidyPlace = (place: string | undefined) => place?.replace(/\s+/g, " ").trim() || null;

/** Reads Takesend's XML answer: one <track> summary, then <trackitem>s newest first. */
export function parseTakesend(trackingNumber: string, xml: string): TakesendParcel {
  const track = /<track\b[^>]*>/.exec(xml)?.[0];
  if (!track) return { trackingNumber, found: false, scans: [], latest: null, delivered: false };
  const summary = attributes(track);
  const scans = [...xml.matchAll(/<trackitem\b[^>]*\/?>/g)]
    .map((m) => attributes(m[0]))
    .filter((a) => a.sdate && a.intro)
    .map((a) => ({ localTime: a.sdate!, place: tidyPlace(a.place), message: a.intro!.trim() }))
    .reverse();
  const latest =
    summary.sdate && summary.intro
      ? { localTime: summary.sdate, place: tidyPlace(summary.desti), message: summary.intro.trim() }
      : (scans.at(-1) ?? null);
  const delivered = summary.trackstatus === "200" || summary.statusname === "签收";
  return { trackingNumber, found: Boolean(latest), scans, latest, delivered };
}

/**
 * Takesend's times have no zone. They are read as UTC, which can be off by the location's offset
 * (up to 9 hours in Japan); the order of scans and the day are what matter for "where is it".
 */
export function takesendTime(localTime: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(localTime.trim());
  return m ? new Date(`${m[1]}T${m[2]!.length === 5 ? `${m[2]}:00` : m[2]}Z`) : null;
}

export interface TakesendClient extends AggregatorClient {
  trackParcel(trackingNumber: string): Promise<TakesendParcel>;
}

/**
 * Takesend's page asks with isRepeat=no, which answers from Takesend's copy in about half a second;
 * isRepeat=yes (its "re-query" button) makes it fetch from the carrier live, which is slow and
 * often comes back empty. So the copy is asked for first, and a live fetch only when it is empty.
 */
export function createTakesendClient(
  options: { fetch?: FetchLike; url?: string; retryDelayMs?: number } = {},
): TakesendClient {
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url ?? TAKESEND_TRACK_URL;
  const retryDelayMs = options.retryDelayMs ?? 3000;

  async function trackParcel(trackingNumber: string): Promise<TakesendParcel> {
    try {
      const first = await askOnce(trackingNumber, false);
      if (first.found) return first;
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
    }
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return askOnce(trackingNumber, true);
  }

  async function askOnce(trackingNumber: string, live: boolean): Promise<TakesendParcel> {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: url.replace("action=repeat", "action=list"),
      },
      body: new URLSearchParams({
        index: "0",
        billid: trackingNumber,
        isRepeat: live ? "yes" : "no",
        language: "en",
      }).toString(),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 429) throw new RateLimitedError("TAKESEND", null);
    const text = await response.text();
    if (!response.ok)
      throw new Error(`Takesend responded ${response.status}: ${text.slice(0, 200)}`);
    return parseTakesend(trackingNumber, text);
  }

  return {
    name: "TAKESEND",
    trackParcel,
    async track(trackingNumber, carrierCode): Promise<AggregatorResult> {
      const parcel = await trackParcel(trackingNumber);
      if (!parcel.found) return { events: [], handoff: null, state: "NOT_FOUND" };
      const scans = parcel.scans.length ? parcel.scans : parcel.latest ? [parcel.latest] : [];
      const events: AttributedEvent[] = scans.flatMap((scan) => {
        const occurredAt = takesendTime(scan.localTime);
        return occurredAt
          ? [
              {
                occurredAt,
                rawStatus: "",
                rawMessage: scan.message,
                location: scan.place,
                carrierCode,
                trackingNumber,
              },
            ]
          : [];
      });
      return { events, handoff: null };
    },
  };
}
