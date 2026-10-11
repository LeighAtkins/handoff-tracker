import type { CarrierAdapter } from "./adapter";
import { createAfterShipClient } from "./aggregators/aftership";
import { createAggregatorAdapter, type AggregatorClient } from "./aggregators/aggregator";
import type { FetchLike } from "./aggregators/http";
import { createSeventeenTrackClient } from "./aggregators/seventeen-track";
import { createShip24Client } from "./aggregators/ship24";
import { createFakeAdapter, type FakeAdapterOptions } from "./fake";
import { createFourPxClient } from "./fourpx/client";
import { createManualAdapter } from "./manual";

export const ADAPTER_NAMES = ["fake", "manual", "4px", "ship24", "17track", "aftership"] as const;
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
    case "4px":
      return createAggregatorAdapter(carrier.code, fourPx(env, http));
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

function fourPx(env: Record<string, string | undefined>, http: { fetch?: FetchLike }) {
  return createFourPxClient({
    appKey: env.FOURPX_APP_KEY,
    appSecret: env.FOURPX_APP_SECRET,
    // The test platform (open-test.4px.com) has its own key pair; see docs/4px-api-request.md.
    baseUrl: env.FOURPX_API_URL || undefined,
    ...http,
  });
}

export type ProviderName = "4PX" | "SHIP24" | "17TRACK" | "AFTERSHIP";

export interface TrackingProvider {
  name: ProviderName;
  /** The environment variables that switch it on. Never their values. */
  keys: string[];
  configured: boolean;
  client: AggregatorClient;
}

/**
 * Everything that can look up a tracking number, best first: 4PX's own API (free, authoritative,
 * names the last-mile number), then the aggregators. Unconfigured ones are listed too, so the app
 * can show what is and is not connected.
 */
export function trackingProviders(options: AdapterOptions = {}): TrackingProvider[] {
  const env = options.env ?? process.env;
  const http = options.fetch ? { fetch: options.fetch } : {};
  const provider = (name: ProviderName, keys: string[], client: AggregatorClient) => ({
    name,
    keys,
    configured: keys.every((key) => Boolean(env[key])),
    client,
  });
  return [
    provider("4PX", ["FOURPX_APP_KEY", "FOURPX_APP_SECRET"], fourPx(env, http)),
    provider(
      "SHIP24",
      ["SHIP24_API_KEY"],
      createShip24Client({ apiKey: env.SHIP24_API_KEY, ...http }),
    ),
    provider(
      "17TRACK",
      ["SEVENTEEN_TRACK_API_KEY"],
      createSeventeenTrackClient({ apiKey: env.SEVENTEEN_TRACK_API_KEY, ...http }),
    ),
    provider(
      "AFTERSHIP",
      ["AFTERSHIP_API_KEY"],
      createAfterShipClient({ apiKey: env.AFTERSHIP_API_KEY, ...http }),
    ),
  ];
}
