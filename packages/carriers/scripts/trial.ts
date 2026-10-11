/**
 * Tracking trial for ADR-0003 and ADR-0004: runs the same real 4PX -> Sagawa tracking numbers
 * through 4PX's own API and each aggregator whose key is set, and scores whether the Sagawa leg
 * appears.
 *
 *   1. Put one 4PX tracking number per line in data/trial-numbers.txt (repo root, gitignored).
 *   2. Set FOURPX_APP_KEY + FOURPX_APP_SECRET and/or any of SHIP24_API_KEY,
 *      SEVENTEEN_TRACK_API_KEY, AFTERSHIP_API_KEY in .env.
 *   3. pnpm trial:aggregators   (17TRACK registers numbers on the first run; run again a few hours later)
 *
 * Per-number results (which contain real tracking numbers) are written under data/trial/ only.
 * The printed summary has no tracking numbers and can be pasted into ADR-0003.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  classifyStage,
  normalise,
  trackingProviders,
  type AggregatorResult,
  type AttributedEvent,
} from "../src";

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${root}.env`, quiet: true });

interface NumberResult {
  trackingNumber: string;
  error?: string;
  events: number;
  fourPxEvents: number;
  sagawaEvents: number;
  sagawaAppeared: boolean;
  nextTrackingNumber: string | null;
  /** Hours from 4PX's last event to Sagawa's first. */
  handoffLagHours: number | null;
  unrecognised: number;
}

function score(
  trackingNumber: string,
  { events, handoff, facts }: Pick<AggregatorResult, "events" | "handoff" | "facts">,
): NumberResult {
  const fourPx = events.filter((e) => e.carrierCode === "4PX" || e.carrierCode === null);
  const sagawa = events.filter((e) => e.carrierCode === "SAGAWA");
  const times = (list: AttributedEvent[]) => list.map((e) => e.occurredAt.getTime());
  const stage = (e: AttributedEvent) =>
    classifyStage(e.carrierCode ?? "4PX", e, e.carrierCode === "SAGAWA" ? 2 : 1);
  // 4PX's own API reports the handover and Sagawa's first scan as its own codes; aggregators
  // show them as the switch from 4PX's events to Sagawa's.
  const handedOver = Math.min(...times(events.filter((e) => stage(e) === "HANDED_OFF")));
  const firstScan = Math.min(...times(events.filter((e) => stage(e) === "LAST_MILE_ACCEPTED")));
  const lag =
    Number.isFinite(handedOver) && Number.isFinite(firstScan)
      ? firstScan - handedOver
      : sagawa.length && fourPx.length
        ? Math.min(...times(sagawa)) - Math.max(...times(fourPx))
        : null;
  const lastMile = handoff
    ? { carrierCode: handoff.nextCarrierCode, trackingNumber: handoff.nextTrackingNumber }
    : (facts?.lastMile ?? null);
  return {
    trackingNumber,
    events: events.length,
    fourPxEvents: fourPx.length,
    sagawaEvents: sagawa.length,
    sagawaAppeared: sagawa.length > 0 || lastMile?.carrierCode === "SAGAWA",
    nextTrackingNumber: lastMile?.trackingNumber ?? null,
    handoffLagHours: lag === null ? null : Math.round((lag / 3_600_000) * 10) / 10,
    unrecognised: events.filter((e) => normalise(e.carrierCode ?? "4PX", e) === null).length,
  };
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

async function main() {
  const file = `${root}data/trial-numbers.txt`;
  if (!existsSync(file))
    throw new Error("Put one 4PX tracking number per line in data/trial-numbers.txt first");
  const numbers = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const clients = trackingProviders()
    .filter((p) => p.configured)
    .map((p) => p.client);
  if (!clients.length)
    throw new Error(
      "Set FOURPX_APP_KEY + FOURPX_APP_SECRET, or one of SHIP24_API_KEY, SEVENTEEN_TRACK_API_KEY, AFTERSHIP_API_KEY",
    );

  const results: Record<string, NumberResult[]> = {};
  for (const client of clients) {
    results[client.name] = [];
    for (const trackingNumber of numbers) {
      try {
        results[client.name]!.push(
          score(trackingNumber, await client.track(trackingNumber, "4PX")),
        );
      } catch (error) {
        results[client.name]!.push({
          ...score(trackingNumber, { events: [], handoff: null }),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((r) => setTimeout(r, 500)); // stay well inside every free tier's rate limit
    }
  }

  const lines = [
    `Tracking trial, ${new Date().toISOString().slice(0, 10)}, ${numbers.length} 4PX -> Sagawa numbers`,
    "",
    "| Source | Tracked | Sagawa leg appeared | Next tracking number given | Median handoff lag (h) | Events | Unrecognised messages | Errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [name, rows] of Object.entries(results)) {
    const ok = rows.filter((r) => !r.error);
    const events = ok.reduce((n, r) => n + r.events, 0);
    const unrecognised = ok.reduce((n, r) => n + r.unrecognised, 0);
    lines.push(
      `| ${name} | ${ok.filter((r) => r.events > 0).length}/${rows.length} | ${ok.filter((r) => r.sagawaAppeared).length}/${rows.length} | ${ok.filter((r) => r.nextTrackingNumber).length}/${rows.length} | ${median(ok.flatMap((r) => (r.handoffLagHours === null ? [] : [r.handoffLagHours]))) ?? "n/a"} | ${events} | ${events ? Math.round((unrecognised / events) * 100) : 0}% | ${rows.length - ok.length} |`,
    );
  }
  const summary = lines.join("\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(`${root}data/trial`, { recursive: true });
  writeFileSync(`${root}data/trial/results-${stamp}.json`, JSON.stringify(results, null, 2));
  writeFileSync(`${root}data/trial/summary-${stamp}.md`, summary + "\n");
  console.log(summary);
  console.log(
    `\nPer-number results: data/trial/results-${stamp}.json (gitignored; contains real tracking numbers)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
