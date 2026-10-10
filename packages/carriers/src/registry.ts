import type { CarrierAdapter } from "./adapter";
import { createAfterShipClient } from "./aggregators/aftership";
import { createAggregatorAdapter } from "./aggregators/aggregator";
import type { FetchLike } from "./aggregators/http";
import { createSeventeenTrackClient } from "./aggregators/seventeen-track";
import { createShip24Client } from "./aggregators/ship24";
import { createFakeAdapter, type FakeAdapterOptions } from "./fake";
import { createManualAdapter } from "./manual";

export const ADAPTER_NAMES = ["fake", "manual", "ship24", "17track", "aftership"] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export interface AdapterOptions {
  fake?: FakeAdapterOptions;
  /** API keys come from the environment only, never from the repo or the database. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

/** Builds the adapter named in a Carrier row's `adapter` column. Unknown names fall back to manual. */
export function adapterFor(
  carrier: { code: string; adapter: string },
  options: AdapterOptions = {},
): CarrierAdapter {
  const env = options.env ?? process.env;
  const http = options.fetch ? { fetch: options.fetch } : {};
  switch (carrier.adapter) {
    case "fake":
      return createFakeAdapter(carrier.code, options.fake);
    case "ship24":
      return createAggregatorAdapter(
        carrier.code,
        createShip24Client({ apiKey: env.SHIP24_API_KEY, ...http }),
      );
    case "17track":
      return createAggregatorAdapter(
        carrier.code,
        createSeventeenTrackClient({ apiKey: env.SEVENTEEN_TRACK_API_KEY, ...http }),
      );
    case "aftership":
      return createAggregatorAdapter(
        carrier.code,
        createAfterShipClient({ apiKey: env.AFTERSHIP_API_KEY, ...http }),
      );
    default:
      return createManualAdapter(carrier.code);
  }
}
