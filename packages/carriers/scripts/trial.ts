/**
 * Aggregator trial for ADR-0003: runs the same real 4PX -> Sagawa tracking numbers through each
 * aggregator whose API key is set, and scores whether the Sagawa leg appears.
 *
 *   1. Put one 4PX tracking number per line in data/trial-numbers.txt (repo root, gitignored).
 *   2. Set any of SHIP24_API_KEY, SEVENTEEN_TRACK_API_KEY, AFTERSHIP_API_KEY in .env.
 *   3. pnpm trial:aggregators   (17TRACK registers numbers on the first run; run again a few hours later)
 *
 * Per-number results (which contain real tracking numbers) are written under data/trial/ only.
 * The printed summary has no tracking numbers and can be pasted into ADR-0003.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  createAfterShipClient,
  createSeventeenTrackClient,
  createShip24Client,
  normalise,
  type AggregatorClient,
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
  events: AttributedEvent[],
  handoff: { nextCarrierCode: string; nextTrackingNumber: string } | null,
): NumberResult {
  const fourPx = events.filter((e) => e.carrierCode === "4PX" || e.carrierCode === null);
  const sagawa = events.filter((e) => e.carrierCode === "SAGAWA");
  const lastFourPx = Math.max(...fourPx.map((e) => e.occurredAt.getTime()));
  const firstSagawa = Math.min(...sagawa.map((e) => e.occurredAt.getTime()));
  return {
    trackingNumber,
    events: events.length,
    fourPxEvents: fourPx.length,
    sagawaEvents: sagawa.length,
    sagawaAppeared: sagawa.length > 0 || handoff?.nextCarrierCode === "SAGAWA",
    nextTrackingNumber: handoff?.nextTrackingNumber ?? null,
    handoffLagHours:
      sagawa.length && fourPx.length
        ? Math.round(((firstSagawa - lastFourPx) / 3_600_000) * 10) / 10
        : null,
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
  const clients: AggregatorClient[] = [
    process.env.SHIP24_API_KEY && createShip24Client({ apiKey: process.env.SHIP24_API_KEY }),
    process.env.SEVENTEEN_TRACK_API_KEY &&
      createSeventeenTrackClient({ apiKey: process.env.SEVENTEEN_TRACK_API_KEY }),
    process.env.AFTERSHIP_API_KEY &&
      createAfterShipClient({ apiKey: process.env.AFTERSHIP_API_KEY }),
  ].filter((c): c is AggregatorClient => Boolean(c));
  if (!clients.length)
    throw new Error(
      "Set at least one of SHIP24_API_KEY, SEVENTEEN_TRACK_API_KEY, AFTERSHIP_API_KEY",
    );

  const results: Record<string, NumberResult[]> = {};
  for (const client of clients) {
    results[client.name] = [];
    for (const trackingNumber of numbers) {
      try {
        const { events, handoff } = await client.track(trackingNumber, "4PX");
        results[client.name]!.push(score(trackingNumber, events, handoff));
      } catch (error) {
        results[client.name]!.push({
          ...score(trackingNumber, [], null),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((r) => setTimeout(r, 500)); // stay well inside every free tier's rate limit
    }
  }

  const lines = [
    `Aggregator trial, ${new Date().toISOString().slice(0, 10)}, ${numbers.length} 4PX -> Sagawa numbers`,
    "",
    "| Aggregator | Tracked | Sagawa leg appeared | Next tracking number given | Median handoff lag (h) | Events | Unrecognised messages | Errors |",
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
