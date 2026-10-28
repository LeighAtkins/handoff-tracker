/**
 * Finds the Sagawa number for each 4PX number and asks Sagawa where the parcel is.
 *
 *   pnpm lastmile 4PX3002711212113CN 4PX3002711212114CN
 *   pnpm lastmile --file numbers.txt          (one number per line; commas and spaces also work)
 *   pnpm lastmile --csv --file numbers.txt > sagawa.csv
 *
 * 4PX numbers go through 4PX's API when FOURPX_APP_KEY/SECRET are set, otherwise its public
 * tracking site. Sagawa numbers (10 or 12 digits) can be mixed in and go straight to Sagawa's k2k
 * inquiry page. Sagawa only answers for 60 days after shipping.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  createFourPxClient,
  createFourPxPublicClient,
  createSagawaClient,
  isSagawaNumber,
  type AggregatorClient,
  type SagawaParcel,
} from "../src";

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${root}.env`, quiet: true });

interface Row {
  input: string;
  sagawaNumber: string | null;
  /** Why there is no Sagawa result, when there is none. */
  note: string | null;
  parcel: SagawaParcel | null;
}

function parseArgs(argv: string[]) {
  const csv = argv.includes("--csv");
  const numbers: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--csv") continue;
    if (arg === "--file") {
      const path = resolve(process.env.INIT_CWD ?? process.cwd(), argv[++i] ?? "");
      numbers.push(...readFileSync(path, "utf8").split(/[\s,]+/));
    } else {
      numbers.push(...arg.split(/[\s,]+/));
    }
  }
  const cleaned = numbers.map((n) => n.replace(/-/g, "").trim().toUpperCase()).filter(Boolean);
  return { csv, numbers: [...new Set(cleaned)] };
}

async function main() {
  const { csv, numbers } = parseArgs(process.argv.slice(2));
  if (!numbers.length) {
    console.error("Usage: pnpm lastmile <4PX or Sagawa numbers...> | --file numbers.txt [--csv]");
    process.exitCode = 1;
    return;
  }

  const env = process.env;
  const fourPx: AggregatorClient =
    env.FOURPX_APP_KEY && env.FOURPX_APP_SECRET
      ? createFourPxClient({
          appKey: env.FOURPX_APP_KEY,
          appSecret: env.FOURPX_APP_SECRET,
          baseUrl: env.FOURPX_API_URL || undefined,
        })
      : createFourPxPublicClient();
  const sagawa = createSagawaClient();
  if (!csv)
    console.error(
      `Finding Sagawa numbers via ${fourPx.name === "4PX" ? "4PX's API" : "4PX's tracking site"}…`,
    );

  const rows: Row[] = [];
  for (const input of numbers) {
    if (isSagawaNumber(input)) {
      rows.push({ input, sagawaNumber: input, note: null, parcel: null });
      continue;
    }
    try {
      const result = await fourPx.track(input, "4PX");
      const number =
        result.handoff?.nextCarrierCode === "SAGAWA"
          ? result.handoff.nextTrackingNumber
          : result.facts?.lastMile?.carrierCode === "SAGAWA"
            ? result.facts.lastMile.trackingNumber
            : null;
      const note =
        result.state === "NOT_FOUND"
          ? "4PX does not know this number"
          : number
            ? null
            : result.facts?.lastMile
              ? `last mile is ${result.facts.lastMile.carrierCode}, not Sagawa`
              : "4PX has not assigned a Sagawa number yet";
      rows.push({ input, sagawaNumber: number, note, parcel: null });
    } catch (error) {
      rows.push({
        input,
        sagawaNumber: null,
        note: `4PX lookup failed: ${message(error)}`,
        parcel: null,
      });
    }
  }

  const toAsk = [...new Set(rows.flatMap((r) => (r.sagawaNumber ? [r.sagawaNumber] : [])))];
  if (toAsk.length) {
    try {
      const parcels = new Map((await sagawa.trackMany(toAsk)).map((p) => [p.trackingNumber, p]));
      for (const row of rows) {
        if (!row.sagawaNumber) continue;
        row.parcel = parcels.get(row.sagawaNumber) ?? null;
        if (row.parcel && !row.parcel.found)
          row.note = "Sagawa has no record (not scanned yet, or shipped over 60 days ago)";
      }
    } catch (error) {
      for (const row of rows)
        if (row.sagawaNumber) row.note = `Sagawa lookup failed: ${message(error)}`;
    }
  }

  if (csv) printCsv(rows);
  else printTable(rows);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const jst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function columns(row: Row) {
  const latest = row.parcel?.found ? row.parcel.scans.at(-1) : undefined;
  return {
    "4PX / input": row.input,
    Sagawa: row.sagawaNumber ?? "",
    Status: row.parcel?.found ? row.parcel.status : "",
    "Latest scan (JST)": latest ? jst.format(latest.occurredAt).replace(",", "") : "",
    Office: latest?.office ?? "",
    "Delivery branch": row.parcel?.deliveryOffice
      ? `${row.parcel.deliveryOffice.name} ${row.parcel.deliveryOffice.tel ?? ""}`.trim()
      : "",
    Note: row.note ?? "",
  };
}

function printTable(rows: Row[]) {
  const data = rows.map(columns);
  const headers = Object.keys(data[0]!) as (keyof ReturnType<typeof columns>)[];
  // East Asian characters take two columns in a terminal.
  const width = (s: string) =>
    [...s].reduce((w, c) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
  const sizes = headers.map((h) => Math.max(width(h), ...data.map((d) => width(d[h]))));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c + " ".repeat(sizes[i]! - width(c)))
      .join("  ")
      .trimEnd();
  console.log(line(headers));
  console.log(line(sizes.map((s) => "-".repeat(s))));
  for (const d of data) console.log(line(headers.map((h) => d[h])));
  const delivered = rows.filter((r) => r.parcel?.found && /配達完了/.test(r.parcel.status)).length;
  console.error(`\n${delivered} of ${rows.length} delivered.`);
}

function printCsv(rows: Row[]) {
  const data = rows.map(columns);
  const headers = Object.keys(data[0]!) as (keyof ReturnType<typeof columns>)[];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  console.log(headers.map(cell).join(","));
  for (const d of data) console.log(headers.map((h) => cell(d[h])).join(","));
}

await main();
