/**
 * Keyless coverage test: for every shipped order in a NOMS export, can we name the courier, and
 * can we get its latest tracking status without any API key?
 *
 *   pnpm coverage data/noms/month-2026-10-26.tsv            (looks numbers up, resumable)
 *   pnpm coverage data/noms/month-2026-10-26.tsv --retry-missing  (asks again where nothing was found)
 *   pnpm coverage data/noms/month-2026-10-26.tsv --summary  (only prints the numbers)
 *
 * The export is tab-separated: order, date, status, courier, tracking (as NOMS stores them).
 * Results go to <export>.results.jsonl next to it, one line per order; rerunning skips orders
 * already looked up, so an interrupted run carries on. Both files contain real tracking numbers
 * and belong in the gitignored data/ folder.
 *
 * Sources, all public tracking pages: 4PX's tracking site, Sagawa's inquiry page and Takesend's
 * tracker. SF Express and FedEx have no keyless source (their sites need a captcha or block
 * scripts), so their orders count as "courier known, status not available".
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  carrierDisplayName,
  classifyStage,
  createFourPxPublicClient,
  createSagawaClient,
  createTakesendClient,
  fourPxStage,
  isSagawaNumber,
  type SagawaParcel,
} from "../src";

interface Order {
  order: string;
  date: string;
  status: string;
  courier: string;
  tracking: string;
}

interface Result {
  order: string;
  nomsDate: string;
  nomsStatus: string;
  channel: string;
  tracking: string;
  /** Who has (or delivers) the parcel, e.g. SpeedX, UPS, Sagawa, SF Express. */
  courier: string | null;
  /** How the courier was worked out: named by a tracker, from NOMS's courier field, or the number's format. */
  courierFrom: "tracker" | "noms" | "number" | null;
  source: "4PX_WEB" | "SAGAWA" | "TAKESEND" | null;
  found: boolean;
  scans: number;
  latestAt: string | null;
  latest: string | null;
  latestPlace: string | null;
  delivered: boolean;
  lastMileNumber: string | null;
  fourPxNumber: string | null;
  error: string | null;
}

const NOMS_COURIERS: [RegExp, string][] = [
  [/^4px/, "4PX"],
  [/^sfexpress/, "SF Express"],
  [/^fedex|HKFEDEX/, "FedEx"],
  [/SZUPS|UPS/, "UPS"],
  [/SAGAWA/, "Sagawa"],
  [/NL_BRAM/, "PostNL"],
  [/SGEUB/, "Singapore Post"],
  [/USCNRM/, "USPS"],
];

const NUMBER_COURIERS: [RegExp, string][] = [
  [/^4PX\d+CN$/, "4PX"],
  [/^SF\d{12,13}$/, "SF Express"],
  [/^1Z[0-9A-Z]{16}$/, "UPS"],
  [/^\d{12}$/, "FedEx or Sagawa"],
];

function channelCourier(order: Order): { courier: string | null; from: Result["courierFrom"] } {
  const noms = NOMS_COURIERS.find(([re]) => re.test(order.courier))?.[1];
  if (noms) return { courier: noms, from: "noms" };
  const byNumber = NUMBER_COURIERS.find(([re]) => re.test(order.tracking))?.[1];
  return byNumber ? { courier: byNumber, from: "number" } : { courier: null, from: null };
}

const DELIVERED = /^delivered|delivered$|delivered to|配達完了|签收|妥投|投递成功/i;
const NOT_DELIVERED = /out for delivery|attempt|undeliver|not delivered/i;
const isDeliveredText = (text: string) => DELIVERED.test(text.trim()) && !NOT_DELIVERED.test(text);

const fourPx = createFourPxPublicClient();
const sagawa = createSagawaClient();
const takesend = createTakesendClient();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function empty(order: Order): Result {
  const { courier, from } = channelCourier(order);
  return {
    order: order.order,
    nomsDate: order.date,
    nomsStatus: order.status,
    channel: order.courier,
    tracking: order.tracking,
    courier,
    courierFrom: from,
    source: null,
    found: false,
    scans: 0,
    latestAt: null,
    latest: null,
    latestPlace: null,
    delivered: false,
    lastMileNumber: null,
    fourPxNumber: null,
    error: null,
  };
}

async function viaFourPx(order: Order, result: Result): Promise<void> {
  result.source = "4PX_WEB";
  const answer = await fourPx.track(order.tracking, "4PX");
  const facts = answer.facts;
  result.fourPxNumber = facts?.fourPxNumber ?? null;
  result.lastMileNumber = facts?.lastMile?.trackingNumber ?? null;
  if (facts?.lastMileContact) {
    result.courier = facts.lastMileContact.name;
    result.courierFrom = "tracker";
  }
  if (answer.state === "NOT_FOUND" || !answer.events.length) return;
  const latest = answer.events.at(-1)!;
  result.found = true;
  result.scans = answer.events.length;
  result.latestAt = latest.occurredAt.toISOString();
  result.latest = latest.rawMessage;
  result.latestPlace = latest.location;
  result.delivered = answer.events.some(
    (e) => fourPxStage(e.rawStatus) === "DELIVERED" || classifyStage("4PX", e) === "DELIVERED",
  );
}

function fromSagawa(parcel: SagawaParcel | undefined, result: Result): void {
  result.source = "SAGAWA";
  if (!parcel?.found || !parcel.scans.length) return;
  const latest = parcel.scans.at(-1)!;
  result.found = true;
  result.courier = "Sagawa";
  result.courierFrom = "tracker";
  result.scans = parcel.scans.length;
  result.latestAt = latest.occurredAt.toISOString();
  result.latest = latest.status;
  result.latestPlace = latest.office;
  result.delivered = /配達完了/.test(parcel.status);
}

async function viaTakesend(order: Order, result: Result): Promise<void> {
  result.source = "TAKESEND";
  const parcel = await takesend.trackParcel(order.tracking);
  if (!parcel.latest) return;
  result.found = true;
  result.scans = Math.max(parcel.scans.length, 1);
  // Takesend's times are local to the scan, with no zone; kept as written.
  result.latestAt = parcel.latest.localTime;
  result.latest = parcel.latest.message;
  result.latestPlace = parcel.latest.place;
  result.delivered =
    parcel.delivered || [parcel.latest, ...parcel.scans].some((s) => isDeliveredText(s.message));
}

function readOrders(path: string): Order[] {
  const [header, ...lines] = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const keys = header!.split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()])) as unknown as Order;
  });
}

/** The latest result per order: a retry appends a new line rather than rewriting the file. */
function readResults(path: string): Result[] {
  if (!existsSync(path)) return [];
  const latest = new Map<string, Result>();
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const result = JSON.parse(line) as Result;
    latest.set(result.order, result);
  }
  return [...latest.values()];
}

async function run(orders: Order[], resultsPath: string, retryMissing: boolean) {
  const done = new Set(
    readResults(resultsPath)
      .filter((r) => !(retryMissing && r.source && !r.found))
      .map((r) => r.order),
  );
  const todo = orders.filter((o) => !done.has(o.order));
  console.error(`${orders.length} orders, ${done.size} already looked up, ${todo.length} to go.`);
  const save = (r: Result) => appendFileSync(resultsPath, `${JSON.stringify(r)}\n`);

  // Sagawa answers 10 numbers at a time, so its orders are asked together.
  const sagawaOrders = todo.filter(
    (o) => /SAGAWA/.test(o.courier) || (!o.courier && isSagawaNumber(o.tracking)),
  );
  for (let i = 0; i < sagawaOrders.length; i += 10) {
    const batch = sagawaOrders.slice(i, i + 10);
    const parcels = await sagawa.trackMany(batch.map((o) => o.tracking)).catch(() => []);
    for (const order of batch) {
      const result = empty(order);
      fromSagawa(
        parcels.find((p) => p.trackingNumber === order.tracking),
        result,
      );
      // Not with Sagawa yet: Takesend shows the leg before it.
      if (!result.found) await viaTakesend(order, result).catch((e) => (result.error = String(e)));
      save(result);
    }
    await pause(1000);
  }

  let count = 0;
  for (const order of todo) {
    if (sagawaOrders.includes(order)) continue;
    const result = empty(order);
    try {
      if (!order.tracking) {
        result.error = "no tracking number in NOMS";
      } else if (result.courier === "4PX") {
        await viaFourPx(order, result);
        await pause(400);
      } else if (/^takesend/.test(order.courier) || result.courier === "UPS") {
        await viaTakesend(order, result);
        await pause(400);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    save(result);
    if (++count % 50 === 0) console.error(`  ${count} of ${todo.length - sagawaOrders.length}`);
  }
}

function pct(n: number, of: number) {
  return of ? `${((100 * n) / of).toFixed(1)}%` : "—";
}

function summarise(results: Result[]) {
  const total = results.length;
  const withNumber = results.filter((r) => r.tracking);
  const knownCourier = withNumber.filter((r) => r.courier && r.courier !== "FedEx or Sagawa");
  const keyless = knownCourier.filter((r) => !["SF Express", "FedEx"].includes(r.courier!));
  const found = knownCourier.filter((r) => r.found);

  console.log(`Orders: ${total} (${withNumber.length} with a tracking number)`);
  console.log(
    `\n1. Courier known: ${knownCourier.length} of ${withNumber.length} (${pct(knownCourier.length, withNumber.length)})`,
  );
  const named = knownCourier.filter((r) => r.courierFrom === "tracker").length;
  console.log(`   named by the tracker itself: ${named} (${pct(named, knownCourier.length)})`);

  console.log(
    `\n2. Latest status found, of courier known: ${found.length} of ${knownCourier.length} (${pct(found.length, knownCourier.length)})`,
  );
  console.log(
    `   excluding SF Express and FedEx (no keyless source): ${found.length} of ${keyless.length} (${pct(found.length, keyless.length)})`,
  );

  const byCourier = new Map<string, { n: number; found: number; delivered: number }>();
  for (const r of withNumber) {
    const key = r.courier ? carrierDisplayName(r.courier) : "(unknown)";
    const row = byCourier.get(key) ?? { n: 0, found: 0, delivered: 0 };
    row.n++;
    if (r.found) row.found++;
    if (r.delivered) row.delivered++;
    byCourier.set(key, row);
  }
  console.log("\n   courier                         orders  status found  delivered");
  for (const [courier, row] of [...byCourier].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `   ${courier.padEnd(32)}${String(row.n).padStart(6)}  ${`${row.found} (${pct(row.found, row.n)})`.padStart(12)}  ${String(row.delivered).padStart(9)}`,
    );
  }

  // Accuracy check against NOMS: orders staff marked Delivered should show as delivered.
  const nomsDelivered = found.filter((r) => r.nomsStatus === "Delivered");
  const agree = nomsDelivered.filter((r) => r.delivered).length;
  console.log(
    `\n3. Agreement with NOMS: of ${nomsDelivered.length} orders NOMS marks Delivered (and we found), the tracker also says delivered for ${agree} (${pct(agree, nomsDelivered.length)})`,
  );
  const shippedDelivered = found.filter((r) => r.nomsStatus === "Shipped" && r.delivered).length;
  const shipped = found.filter((r) => r.nomsStatus === "Shipped").length;
  console.log(
    `   NOMS still says Shipped but the tracker says delivered: ${shippedDelivered} of ${shipped}`,
  );

  const notFound = knownCourier.filter((r) => !r.found && r.source);
  if (notFound.length) {
    console.log(`\nNot found by a keyless source (${notFound.length}), by channel:`);
    const byChannel = new Map<string, number>();
    for (const r of notFound)
      byChannel.set(r.channel || "(none)", (byChannel.get(r.channel || "(none)") ?? 0) + 1);
    for (const [c, n] of byChannel) console.log(`   ${c}: ${n}`);
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) console.log(`\nErrors: ${errors.length} (e.g. ${errors[0]!.error})`);
}

const [input, ...flags] = process.argv.slice(2);
if (!input) {
  console.error("Usage: pnpm coverage <noms-export.tsv> [--summary]");
  process.exitCode = 1;
} else {
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), input);
  const resultsPath = path.replace(/\.tsv$/, "") + ".results.jsonl";
  if (!flags.includes("--summary"))
    await run(readOrders(path), resultsPath, flags.includes("--retry-missing"));
  summarise(readResults(resultsPath));
}
