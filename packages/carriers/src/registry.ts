import type { CarrierAdapter } from "./adapter";
import { createAfterShipClient } from "./aggregators/aftership";
import {
  createAggregatorAdapter,
  type AggregatorClient,
  type AggregatorResult,
} from "./aggregators/aggregator";
import type { FetchLike } from "./aggregators/http";
import { createSeventeenTrackClient } from "./aggregators/seventeen-track";
import { createShip24Client } from "./aggregators/ship24";
import { createFakeAdapter, type FakeAdapterOptions } from "./fake";
import { createFourPxClient } from "./fourpx/client";
import { createFourPxPublicClient } from "./fourpx/public";
import { withSagawaLastMile } from "./lastmile";
import { createManualAdapter } from "./manual";
import { createSagawaClient, type SagawaClient } from "./sagawa/client";
import { createTakesendClient } from "./takesend/client";

export const ADAPTER_NAMES = [
  "fake",
  "manual",
  "4px",
  "4px-web",
  "sagawa",
  "takesend",
  "ship24",
  "17track",
  "aftership",
] as const;
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
      return createAggregatorAdapter(carrier.code, fourPx(env, http, createSagawaClient(http)));
    case "4px-web":
      return createAggregatorAdapter(carrier.code, fourPxWeb(http, createSagawaClient(http)));
    case "sagawa":
      return createAggregatorAdapter(
        carrier.code,
        firstWithEvents("SAGAWA", [createSagawaClient(http), createTakesendClient(http)]),
      );
    // Takesend's tracker relays the carrier's scans for parcels booked through it (UPS mostly).
    case "takesend":
      return createAggregatorAdapter(carrier.code, createTakesendClient(http));
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

/**
 * Asks each client in turn and returns the first answer with events. Japan parcels booked through
 * Takesend are unknown to Sagawa until they reach Japan; Takesend shows the leg before that.
 */
export function firstWithEvents(name: string, clients: AggregatorClient[]): AggregatorClient {
  return {
    name,
    async track(trackingNumber, carrierCode) {
      let last: AggregatorResult = { events: [], handoff: null, state: "NOT_FOUND" };
      for (const client of clients) {
        last = await client.track(trackingNumber, carrierCode);
        if (last.events.length) return last;
      }
      return last;
    },
  };
}

/** 4PX's API names Sagawa itself, so its last-mile number is kept even before Sagawa scans it. */
function fourPx(
  env: Record<string, string | undefined>,
  http: { fetch?: FetchLike },
  sagawa: SagawaClient,
) {
  const client = createFourPxClient({
    appKey: env.FOURPX_APP_KEY,
    appSecret: env.FOURPX_APP_SECRET,
    // The test platform (open-test.4px.com) has its own key pair; see docs/4px-api-request.md.
    baseUrl: env.FOURPX_API_URL || undefined,
    ...http,
  });
  return withSagawaLastMile(client, sagawa);
}

/** 4PX's tracking site does not name the carrier, so Sagawa has to recognise the number. */
function fourPxWeb(http: { fetch?: FetchLike }, sagawa: SagawaClient) {
  return withSagawaLastMile(createFourPxPublicClient(http), sagawa, { confirmCarrier: true });
}

export type ProviderName = "4PX" | "4PX_WEB" | "SAGAWA" | "SHIP24" | "17TRACK" | "AFTERSHIP";

export interface TrackingProvider {
  name: ProviderName;
  /** The environment variables that switch it on. Never their values. Empty for public sites. */
  keys: string[];
  /** A public tracking page rather than an API: no key, but no guarantee it keeps working. */
  publicSite: boolean;
  configured: boolean;
  client: AggregatorClient;
}

/**
 * Everything that can look up a tracking number, best first: 4PX's own API (free, authoritative,
 * names the last-mile number), then 4PX's and Sagawa's public tracking sites (no key needed), then
 * the aggregators. 4PX answers are followed onto Sagawa (withSagawaLastMile). Unconfigured ones are
 * listed too, so the app can show what is and is not connected.
 *
 * The public sites are on unless PUBLIC_TRACKING_SITES=false, for servers that must not call them.
 */
export function trackingProviders(options: AdapterOptions = {}): TrackingProvider[] {
  const env = options.env ?? process.env;
  const http = options.fetch ? { fetch: options.fetch } : {};
  const sagawa = createSagawaClient(http);
  const publicSites = env.PUBLIC_TRACKING_SITES?.toLowerCase() !== "false";
  const provider = (name: ProviderName, keys: string[], client: AggregatorClient) => ({
    name,
    keys,
    publicSite: keys.length === 0,
    configured: keys.length ? keys.every((key) => Boolean(env[key])) : publicSites,
    client,
  });
  return [
    provider("4PX", ["FOURPX_APP_KEY", "FOURPX_APP_SECRET"], fourPx(env, http, sagawa)),
    provider("4PX_WEB", [], fourPxWeb(http, sagawa)),
    provider("SAGAWA", [], sagawa),
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
