/**
 * Loads a NOMS export into the database as Orders, Shipments and first Legs, then adds what the
 * captcha and email sources found, so the app shows real parcels. The keyless carriers (4PX,
 * Sagawa, Takesend) are then filled in by the normal worker run.
 *
 *   DATABASE_URL=...handoff_real pnpm --filter @handoff/worker load-noms data/noms/noms-2026-10-27.tsv
 *
 * The export is tab-separated: order, date, status, courier, tracking, country, postcode (no names
 * or contact details). Customer names are not loaded: the order number stands in for them.
 * Rerunning is safe: orders and legs that already exist are left alone, and duplicate events are
 * skipped by the database.
 *
 * Also read when present (all in data/noms/, gitignored):
 *   fedex-replies/*.txt   FedEx track-by-email replies (FedEx has no keyless web source)
 *   sf-status.jsonl       results of the daily SF Express captcha check
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { ingestLegEvents, WORKER_ACTOR } from "@handoff/app";
import {
  fedExEmailTime,
  parseFedExTrackEmail,
  type RawTrackingEvent,
  type ShipmentFacts,
} from "@handoff/carriers";
import { createPrismaClient } from "@handoff/db";

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${root}.env`, quiet: true });

/** Our carrier code for a NOMS courier field, with the adapter that tracks it keylessly. */
const CARRIERS: Record<string, { name: string; adapter: string }> = {
  "4PX": { name: "4PX Express", adapter: "4px-web" },
  SAGAWA: { name: "Sagawa Express", adapter: "sagawa" },
  TAKESEND: { name: "Takesend (UPS and others)", adapter: "takesend" },
  SFEXPRESS: { name: "SF Express", adapter: "manual" },
  FEDEX: { name: "FedEx", adapter: "manual" },
};

export function carrierFor(courier: string, tracking: string): string | null {
  const c = courier.toLowerCase();
  if (c.startsWith("4px")) return "4PX";
  if (c === "takesend:sagawa") return "SAGAWA";
  if (c.startsWith("takesend")) return "TAKESEND";
  if (c.startsWith("sfexpress")) return "SFEXPRESS";
  if (c.startsWith("fedex")) return "FEDEX";
  if (/^4PX\d+CN$/.test(tracking)) return "4PX";
  if (/^SF\d{13}$/.test(tracking)) return "SFEXPRESS";
  if (/^1Z[0-9A-Z]{16}$/.test(tracking)) return "TAKESEND";
  if (/^36876\d{7}$/.test(tracking)) return "SAGAWA";
  return null;
}

const COUNTRIES: Record<string, string> = {
  usa: "US",
  "united states": "US",
  france: "FR",
  "united kingdom": "GB",
  japan: "JP",
  germany: "DE",
  canada: "CA",
  australia: "AU",
  switzerland: "CH",
  spain: "ES",
  austria: "AT",
  belgium: "BE",
  singapore: "SG",
  israel: "IL",
  finland: "FI",
  luxembourg: "LU",
  netherlands: "NL",
  italy: "IT",
  ireland: "IE",
  "new zealand": "NZ",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  portugal: "PT",
  poland: "PL",
  "hong kong": "HK",
  "czech republic": "CZ",
  czechia: "CZ",
  slovenia: "SI",
  romania: "RO",
  greece: "GR",
  "south korea": "KR",
  korea: "KR",
  taiwan: "TW",
  mexico: "MX",
  "united arab emirates": "AE",
  hungary: "HU",
  estonia: "EE",
  latvia: "LV",
  lithuania: "LT",
  croatia: "HR",
  slovakia: "SK",
  malaysia: "MY",
  "saudi arabia": "SA",
  qatar: "QA",
  iceland: "IS",
  malta: "MT",
  cyprus: "CY",
};

function readTsv(path: string) {
  const [header, ...lines] = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const keys = header!.split("\t");
  return lines.map(
    (line) =>
      Object.fromEntries(keys.map((k, i) => [k, (line.split("\t")[i] ?? "").trim()])) as Record<
        string,
        string
      >,
  );
}

/** What one source said about a parcel, and when it was asked. */
interface Checked {
  events: RawTrackingEvent[];
  checkedAt: Date;
  facts?: ShipmentFacts;
}

/** FedEx replies give local times without a zone; read as UTC, like the parser. */
function fedExEvents(dir: string): Map<string, Checked> {
  const byNumber = new Map<string, Checked>();
  if (!existsSync(dir)) return byNumber;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
    const checkedAt = statSync(`${dir}/${file}`).mtime;
    for (const parcel of parseFedExTrackEmail(readFileSync(`${dir}/${file}`, "utf8")).parcels) {
      const events = parcel.scans.flatMap((scan) => {
        const occurredAt = fedExEmailTime(scan.localTime);
        return occurredAt
          ? [{ occurredAt, rawStatus: "", rawMessage: scan.activity, location: scan.location }]
          : [];
      });
      const previous = byNumber.get(parcel.trackingNumber);
      if (!previous || previous.checkedAt < checkedAt) {
        byNumber.set(parcel.trackingNumber, { events, checkedAt });
      }
    }
  }
  return byNumber;
}

/** SF shows times in China time. */
const sfTime = (value: string) => new Date(`${value.replace(" ", "T")}+08:00`);

/**
 * The SF captcha check gives a status, not a scan list: one event per check result. The latest
 * check sets when the parcel was last checked and its ETA.
 */
function sfEvents(path: string): Map<string, Checked> {
  const byNumber = new Map<string, Checked>();
  if (!existsSync(path)) return byNumber;
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as {
      waybill: string;
      checkedAt: string;
      status: string;
      delivered: boolean;
      signedOffAt: string | null;
      eta: string | null;
      destination: string | null;
    };
    const checked = byNumber.get(s.waybill) ?? { events: [], checkedAt: new Date(0) };
    const events = checked.events;
    if (s.delivered && s.signedOffAt) {
      events.push({
        occurredAt: sfTime(s.signedOffAt),
        rawStatus: "Signed off",
        rawMessage: "Delivered (signed off)",
        location: s.destination,
      });
    } else {
      events.push({
        occurredAt: new Date(s.checkedAt),
        rawStatus: s.status,
        rawMessage:
          s.status === "In transit" && s.eta
            ? `In transit, estimated arrival ${s.eta}`
            : s.status === "Awaiting Pickup"
              ? "Awaiting pickup by SF: not collected yet"
              : s.status,
        location: s.destination,
      });
    }
    const checkedAt = new Date(s.checkedAt);
    if (checkedAt >= checked.checkedAt) {
      checked.checkedAt = checkedAt;
      checked.facts = {
        estimatedDelivery: s.eta ? { from: sfTime(s.eta), to: null, source: "SFEXPRESS" } : null,
      };
    }
    byNumber.set(s.waybill, checked);
  }
  return byNumber;
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: load-noms <noms-export.tsv>");
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  const prisma = createPrismaClient();
  try {
    for (const [code, carrier] of Object.entries(CARRIERS)) {
      await prisma.carrier.upsert({
        where: { code },
        create: { code, ...carrier, pollIntervalMinutes: 360 },
        update: { adapter: carrier.adapter, name: carrier.name },
      });
    }

    const rows = readTsv(path);
    let created = 0;
    let skipped = 0;
    const legsByNumber = new Map<string, { id: string; carrierCode: string }>();
    for (const row of rows) {
      const tracking = row.tracking!.replace(/\s+/g, "");
      const carrierCode = tracking ? carrierFor(row.courier!, tracking) : null;
      if (!carrierCode) {
        skipped++;
        continue;
      }
      const createdAt = new Date(`${row.date}T12:00:00+08:00`);
      const order = await prisma.order.upsert({
        where: {
          sourceSystem_sourceOrderNumber: { sourceSystem: "NOMS", sourceOrderNumber: row.order! },
        },
        create: {
          sourceSystem: "NOMS",
          sourceOrderNumber: row.order!,
          customerName: row.order!,
          destinationCountry: COUNTRIES[row.country!.toLowerCase()] ?? "ZZ",
          destinationPostcode: row.postcode || "-",
        },
        update: {},
      });
      let leg = await prisma.leg.findFirst({
        where: { trackingNumber: tracking, shipment: { orderId: order.id } },
      });
      if (!leg) {
        const shipment = await prisma.shipment.create({
          data: {
            orderId: order.id,
            createdAt,
            status: "SHIPPED",
            legs: {
              create: { sequence: 1, carrierCode, trackingNumber: tracking, startedAt: createdAt },
            },
          },
          include: { legs: true },
        });
        leg = shipment.legs[0]!;
        created++;
      }
      legsByNumber.set(tracking, { id: leg.id, carrierCode });
    }
    console.log(
      `orders: ${rows.length} rows, ${created} shipments created, ${skipped} skipped (no number or unknown courier)`,
    );

    const sources: [string, Map<string, Checked>][] = [
      ["FEDEX", fedExEvents(`${root}data/noms/fedex-replies`)],
      ["SFEXPRESS", sfEvents(`${root}data/noms/sf-status.jsonl`)],
    ];
    for (const [carrierCode, events] of sources) {
      let applied = 0;
      for (const [number, checked] of events) {
        const leg = legsByNumber.get(number);
        if (!leg || leg.carrierCode !== carrierCode || !checked.events.length) continue;
        await ingestLegEvents(
          prisma,
          { legId: leg.id, events: checked.events, facts: checked.facts },
          checked.checkedAt,
        );
        applied++;
      }
      console.log(`${carrierCode}: events added for ${applied} parcels`);
    }

    // SF and FedEx have no source the worker can poll. A parcel NOMS already marks Delivered, with
    // nothing from the captcha check or the FedEx emails, would show as stuck with no scans, which
    // is wrong, so it is left out.
    const withData = new Set(sources.flatMap(([, events]) => [...events.keys()]));
    const unknown = rows
      .map((row) => ({
        courier: row.courier ?? "",
        status: row.status ?? "",
        tracking: (row.tracking ?? "").replace(/\s+/g, ""),
      }))
      .filter((row) => {
        const code = row.tracking ? carrierFor(row.courier, row.tracking) : null;
        return (
          (code === "SFEXPRESS" || code === "FEDEX") &&
          row.status.startsWith("Delivered") &&
          !withData.has(row.tracking)
        );
      });
    const { count: removed } = await prisma.shipment.deleteMany({
      where: {
        legs: { some: { trackingNumber: { in: unknown.map((r) => r.tracking) } } },
        status: { not: "DELIVERED" },
      },
    });
    console.log(`left out ${removed} SF/FedEx parcels NOMS marks Delivered with no carrier data`);
    console.log(
      `Done. Now run the worker (as ${WORKER_ACTOR}) to fetch 4PX, Sagawa and Takesend scans.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
