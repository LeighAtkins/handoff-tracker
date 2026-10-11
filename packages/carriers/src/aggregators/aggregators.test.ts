import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import { normalise } from "../normaliser";
import { adapterFor } from "../registry";
import { createAfterShipClient } from "./aftership";
import { carrierCodeFromAggregator, localOffsetFor } from "./aggregator";
import { AggregatorHttpError, type FetchLike } from "./http";
import { createSeventeenTrackClient } from "./seventeen-track";
import { createShip24Client, ship24Time } from "./ship24";

/** Response bodies follow each aggregator's documented shape. The trial (ADR-0003) checks them against reality. */
function mockFetch(
  routes: Record<string, unknown | ((init?: RequestInit) => unknown)>,
  calls: string[] = [],
): FetchLike {
  return async (url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const route = Object.entries(routes).find(([pattern]) => key.startsWith(pattern));
    if (!route) return new Response("not found", { status: 404 });
    const body =
      typeof route[1] === "function"
        ? (route[1] as (init?: RequestInit) => unknown)(init)
        : route[1];
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const env = { SHIP24_API_KEY: "k", SEVENTEEN_TRACK_API_KEY: "k", AFTERSHIP_API_KEY: "k" };

describe("Ship24", () => {
  const body = {
    data: {
      trackings: [
        {
          shipment: {
            statusMilestone: "in_transit",
            trackingNumbers: [{ tn: "4PX1CN" }, { tn: "900011112222" }],
          },
          events: [
            {
              status: "Parcel picked up",
              occurrenceDatetime: "2026-10-01T10:00:00",
              utcOffset: "+08:00",
              courierCode: "4px",
              eventTrackingNumber: "4PX1CN",
              statusMilestone: "in_transit",
            },
            {
              status: "Handed over to Sagawa",
              occurrenceDatetime: "2026-10-03T09:00:00",
              utcOffset: "+09:00",
              courierCode: "4px",
              eventTrackingNumber: "4PX1CN",
              statusMilestone: "in_transit",
            },
            {
              status: "荷物を受け付けました",
              occurrenceDatetime: "2026-10-04T08:00:00",
              utcOffset: "+09:00",
              courierCode: "sagawa",
              eventTrackingNumber: "900011112222",
              statusMilestone: "in_transit",
              location: "大阪",
            },
          ],
        },
      ],
    },
  };

  it("keeps the 4PX leg's events and reports the Sagawa handoff", async () => {
    const calls: string[] = [];
    const adapter = adapterFor(
      { code: "4PX", adapter: "ship24" },
      {
        env,
        fetch: mockFetch({ "POST https://api.ship24.com/public/v1/trackers/track": body }, calls),
      },
    );
    const events = await adapter.fetchEvents("4PX1CN");
    expect(events.map((e) => e.rawMessage)).toEqual(["Parcel picked up", "Handed over to Sagawa"]);
    expect(events[0]?.occurredAt).toEqual(new Date("2026-10-01T02:00:00Z"));
    expect(adapter.detectHandoff?.(events)).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900011112222",
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps only Sagawa's events when polling the Sagawa leg", async () => {
    const adapter = adapterFor(
      { code: "SAGAWA", adapter: "ship24" },
      { env, fetch: mockFetch({ "POST https://api.ship24.com": body }) },
    );
    const events = await adapter.fetchEvents("900011112222");
    expect(events.map((e) => e.location)).toEqual(["大阪"]);
    expect(normalise("SAGAWA", events[0]!)).toBe("IN_TRANSIT");
    expect(adapter.detectHandoff?.(events)).toBeNull();
  });

  it("reads times with or without offsets", () => {
    expect(ship24Time({ occurrenceDatetime: "2026-10-01T10:00:00" })).toEqual(
      new Date("2026-10-01T10:00:00Z"),
    );
    expect(ship24Time({ occurrenceDatetime: "x", datetime: "2026-10-01T10:00:00+09:00" })).toEqual(
      new Date("2026-10-01T01:00:00Z"),
    );
    expect(ship24Time({ occurrenceDatetime: "2026-10-01T10:00:00Z" })).toEqual(
      new Date("2026-10-01T10:00:00Z"),
    );
  });

  it("reads offset-less local times in each carrier's own zone, and reports the estimate", async () => {
    const local = {
      data: {
        trackings: [
          {
            shipment: {
              originCountryCode: "CN",
              destinationCountryCode: "JP",
              delivery: {
                courierEstimatedDeliveryDate: { from: "2026-10-05", to: "2026-10-06" },
                service: "Standard",
              },
            },
            events: [
              {
                status: "Departure from the original airport",
                occurrenceDatetime: "2026-10-01T10:00:00",
                courierCode: "4px",
                location: "Shenzhen",
              },
              {
                status: "Arrival to the destination airport",
                occurrenceDatetime: "2026-10-02T10:00:00",
                courierCode: "4px",
                location: "Kansai Airport, Japan",
              },
              {
                status: "荷物を受け付けました",
                occurrenceDatetime: "2026-10-03T10:00:00",
                courierCode: "sagawa",
                eventTrackingNumber: "900011112222",
              },
              { status: "Note", occurrenceDatetime: "2026-10-04", courierCode: null },
            ],
          },
        ],
      },
    };
    const client = createShip24Client({
      apiKey: "k",
      fetch: mockFetch({ "POST https://api.ship24.com": local }),
    });
    const result = await client.track("4PX1CN", "4PX");
    expect(result.events.map((e) => e.occurredAt.toISOString())).toEqual([
      "2026-10-01T02:00:00.000Z", // China time
      "2026-10-02T01:00:00.000Z", // 4PX in Japan: Japan time
      "2026-10-03T01:00:00.000Z", // Sagawa: Japan time
      "2026-10-04T04:00:00.000Z", // a date only, read as midday in the polled carrier's zone
    ]);
    expect(result.facts).toEqual({
      originCountry: "CN",
      destinationCountry: "JP",
      lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" },
      estimatedDelivery: {
        from: new Date("2026-10-05"),
        to: new Date("2026-10-06"),
        source: "Ship24",
      },
      service: "Standard",
    });
  });

  it("falls back to Ship24's single estimated date", async () => {
    const client = createShip24Client({
      apiKey: "k",
      fetch: mockFetch({
        "POST https://api.ship24.com": {
          data: {
            trackings: [{ shipment: { delivery: { estimatedDeliveryDate: "2026-10-06" } } }],
          },
        },
      }),
    });
    expect((await client.track("4PX1CN", "4PX")).facts?.estimatedDelivery).toEqual({
      from: new Date("2026-10-06"),
      to: null,
      source: "Ship24",
    });
  });

  it("copes with a tracker that has no events yet", async () => {
    const adapter = adapterFor(
      { code: "4PX", adapter: "ship24" },
      { env, fetch: mockFetch({ "POST https://api.ship24.com": { data: { trackings: [{}] } } }) },
    );
    expect(await adapter.fetchEvents("4PX1CN")).toEqual([]);
  });
});

describe("17TRACK", () => {
  const tracked = {
    code: 0,
    data: {
      accepted: [
        {
          number: "4PX1CN",
          track_info: {
            tracking: {
              providers: [
                {
                  provider: { key: 190094, name: "4PX" },
                  events: [
                    {
                      time_utc: "2026-10-01T02:00:00Z",
                      description: "Arrived at destination country",
                      stage: "Arrival",
                    },
                  ],
                },
                {
                  provider: { key: 100040, name: "Sagawa" },
                  events: [
                    {
                      time_utc: "2026-10-04T00:00:00Z",
                      description: "配達中です",
                      stage: "OutForDelivery",
                    },
                    {
                      time_utc: "2026-10-05T00:00:00Z",
                      description: "持戻（その他）",
                      sub_status: "DeliveryFailure_Other",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  };

  it("registers unknown numbers and reports no events yet", async () => {
    const calls: string[] = [];
    const fetch = mockFetch(
      {
        "POST https://api.17track.net/track/v2.4/gettrackinfo": {
          code: 0,
          data: { accepted: [], rejected: [{ number: "4PX1CN" }] },
        },
        "POST https://api.17track.net/track/v2.4/register": {
          code: 0,
          data: { accepted: [{ number: "4PX1CN" }] },
        },
      },
      calls,
    );
    expect(
      await adapterFor({ code: "4PX", adapter: "17track" }, { env, fetch }).fetchEvents("4PX1CN"),
    ).toEqual([]);
    expect(calls.map((c) => c.split("/").at(-1))).toEqual(["gettrackinfo", "register"]);
  });

  it("sends the carrier key and reports a rejected registration", async () => {
    const bodies: unknown[] = [];
    const fetch = mockFetch({
      "POST https://api.17track.net/track/v2.4/gettrackinfo": (init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { code: 0, data: { accepted: [], rejected: [{ number: "900011112222" }] } };
      },
      "POST https://api.17track.net/track/v2.4/register": {
        code: 0,
        data: {
          accepted: [],
          rejected: [{ number: "900011112222", error: { message: "Carrier cannot be detected." } }],
        },
      },
    });
    await expect(
      adapterFor({ code: "4PX", adapter: "17track" }, { env, fetch }).fetchEvents("900011112222"),
    ).rejects.toThrow("Carrier cannot be detected.");
    expect(bodies).toEqual([[{ number: "900011112222", carrier: 190094 }]]);
  });

  it("waits quietly on a number that is registered but has no events yet", async () => {
    const fetch = mockFetch({
      "POST https://api.17track.net/track/v2.4/gettrackinfo": {
        code: 0,
        data: { accepted: [], rejected: [{ number: "4PX1CN" }] },
      },
      "POST https://api.17track.net/track/v2.4/register": {
        code: 0,
        data: {
          rejected: [{ number: "4PX1CN", error: { code: -18019901, message: "registered" } }],
        },
      },
    });
    expect(
      await adapterFor({ code: "4PX", adapter: "17track" }, { env, fetch }).fetchEvents("4PX1CN"),
    ).toEqual([]);
  });

  it("splits providers into legs and hands off under the same number", async () => {
    const fetch = mockFetch({ "POST https://api.17track.net/track/v2.4/gettrackinfo": tracked });
    const fourPx = adapterFor({ code: "4PX", adapter: "17track" }, { env, fetch });
    const events = await fourPx.fetchEvents("4PX1CN");
    expect(events.map((e) => e.rawStatus)).toEqual(["Arrival"]);
    expect(fourPx.detectHandoff?.(events)).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "4PX1CN",
    });

    const sagawa = adapterFor({ code: "SAGAWA", adapter: "17track" }, { env, fetch });
    const sagawaEvents = await sagawa.fetchEvents("4PX1CN");
    expect(normalise("SAGAWA", sagawaEvents[0]!)).toBe("OUT_FOR_DELIVERY");
    expect(sagawaEvents[1]?.rawStatus).toBe("DeliveryFailure_Other");
    expect(normalise("SAGAWA", sagawaEvents[1]!)).toBe("EXCEPTION");
  });

  it("names Sagawa's own number and the parcel's facts when 17TRACK knows them", async () => {
    const accepted = tracked.data.accepted[0]!;
    const withInfo = {
      ...tracked,
      data: {
        accepted: [
          {
            ...accepted,
            track_info: {
              ...accepted.track_info,
              shipping_info: {
                shipper_address: { country: "CN" },
                recipient_address: { country: "JP" },
              },
              time_metrics: {
                estimated_delivery_date: {
                  source: "Official",
                  from: "2026-10-06T00:00:00+09:00",
                  to: null,
                },
              },
              misc_info: {
                service_type: "Express",
                weight_kg: "2.40",
                local_number: "900011112222",
                local_provider: "Sagawa (佐川急便)",
                local_key: 100040,
              },
            },
          },
        ],
      },
    };
    const client = createSeventeenTrackClient({
      apiKey: "k",
      fetch: mockFetch({ "POST https://api.17track.net": withInfo }),
    });
    const result = await client.track("4PX1CN", "4PX");
    expect(result.handoff).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900011112222",
    });
    expect(result.facts).toEqual({
      originCountry: "CN",
      destinationCountry: "JP",
      lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" },
      estimatedDelivery: {
        from: new Date("2026-10-05T15:00:00Z"),
        to: null,
        source: "Official",
      },
      weightKg: 2.4,
      service: "Express",
    });
  });

  it("attributes events by carrier key, whatever the provider is called", async () => {
    const renamed = structuredClone(tracked);
    renamed.data.accepted[0]!.track_info.tracking.providers[1]!.provider.name = "佐川急便 SGH";
    renamed.data.accepted[0]!.track_info.tracking.providers[1]!.provider.key = 100041;
    const client = createSeventeenTrackClient({
      apiKey: "k",
      fetch: mockFetch({ "POST https://api.17track.net": renamed }),
    });
    const result = await client.track("4PX1CN", "4PX");
    expect(new Set(result.events.map((e) => e.carrierCode))).toEqual(new Set(["4PX", "SAGAWA"]));
    expect(result.facts).toMatchObject({ lastMile: null, estimatedDelivery: null, weightKg: null });
  });

  it("marks a newly registered number as pending", async () => {
    const client = createSeventeenTrackClient({
      apiKey: "k",
      fetch: mockFetch({
        "POST https://api.17track.net/track/v2.4/gettrackinfo": { code: 0, data: { accepted: [] } },
        "POST https://api.17track.net/track/v2.4/register": { code: 0, data: { accepted: [] } },
      }),
    });
    expect((await client.track("4PX1CN", "4PX")).state).toBe("PENDING");
  });
});

describe("AfterShip", () => {
  const tracking = {
    slug: "4px",
    checkpoints: [
      {
        checkpoint_time: "2026-10-01T10:00:00+08:00",
        message: "Departed from sorting centre",
        city: "Shenzhen",
        country_region: "CHN",
        tag: "InTransit",
        slug: "4px",
      },
    ],
    last_mile: { slug: "sagawa", tracking_number: "900011112222" },
  };

  it("reads an existing tracking and its next courier", async () => {
    const calls: string[] = [];
    const fetch = mockFetch(
      {
        "GET https://api.aftership.com/tracking/2025-07/trackings?": {
          data: { trackings: [tracking] },
        },
      },
      calls,
    );
    const adapter = adapterFor({ code: "4PX", adapter: "aftership" }, { env, fetch });
    const events = await adapter.fetchEvents("4PX1CN");
    expect(events).toEqual([
      {
        occurredAt: new Date("2026-10-01T02:00:00Z"),
        rawStatus: "InTransit",
        rawMessage: "Departed from sorting centre",
        location: "Shenzhen, CHN",
      },
    ]);
    expect(adapter.detectHandoff?.(events)).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900011112222",
    });
    expect(calls).toHaveLength(1);
  });

  it("reports the handover scan, the estimate and the weight", async () => {
    const detailed = {
      ...tracking,
      origin_country_region: "CHN",
      destination_country_region: "JPN",
      shipment_weight: { value: 2.4, unit: "kg" },
      courier_estimated_delivery_date: {
        estimated_delivery_date: "2026-10-06T00:00:00+09:00",
        estimated_delivery_date_min: null,
        estimated_delivery_date_max: "2026-10-07T00:00:00+09:00",
      },
      checkpoints: [
        ...tracking.checkpoints,
        {
          checkpoint_time: "2026-10-03T09:00:00+09:00",
          message: "Handed over to the local carrier",
          tag: "InTransit",
          subtag: "InTransit_001",
          slug: "4px",
          events: [{ code: "handed_over_to_last_mile_carrier" }],
        },
      ],
    };
    const client = createAfterShipClient({
      apiKey: "k",
      fetch: mockFetch({ "GET https://api.aftership.com": { data: { trackings: [detailed] } } }),
    });
    const result = await client.track("4PX1CN", "4PX");
    expect(result.events.map((e) => e.rawStatus)).toEqual([
      "InTransit",
      "handed_over_to_last_mile_carrier",
    ]);
    expect(normalise("4PX", result.events[1]!)).toBe("HANDED_OFF");
    expect(result.state).toBe("READY");
    expect(result.facts).toEqual({
      originCountry: "CHN",
      destinationCountry: "JPN",
      lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" },
      estimatedDelivery: {
        from: new Date("2026-10-05T15:00:00Z"),
        to: new Date("2026-10-06T15:00:00Z"),
        source: "Carrier",
      },
      weightKg: 2.4,
    });
  });

  it("falls back to AfterShip's own estimate, and ignores weights in other units", async () => {
    const client = createAfterShipClient({
      apiKey: "k",
      fetch: mockFetch({
        "GET https://api.aftership.com": {
          data: {
            trackings: [
              {
                ...tracking,
                last_mile: { slug: "4px", tracking_number: "4PX1CN" },
                shipment_weight: { value: 5, unit: "lb" },
                aftership_estimated_delivery_date: { estimated_delivery_date: "2026-10-06" },
              },
            ],
          },
        },
      }),
    });
    const result = await client.track("4PX1CN", "4PX");
    expect(result.handoff).toBeNull();
    expect(result.facts).toMatchObject({
      lastMile: null,
      weightKg: null,
      estimatedDelivery: { from: new Date("2026-10-06"), to: null, source: "AfterShip" },
    });
  });

  it("creates the tracking the first time", async () => {
    const calls: string[] = [];
    const fetch = mockFetch(
      {
        "GET https://api.aftership.com": { data: { trackings: [] } },
        "POST https://api.aftership.com/tracking/2025-07/trackings": (init?: RequestInit) => {
          expect(JSON.parse(String(init?.body))).toEqual({ tracking_number: "4PX1CN" });
          return { data: { slug: "4px", checkpoints: [] } };
        },
      },
      calls,
    );
    expect(
      await adapterFor({ code: "4PX", adapter: "aftership" }, { env, fetch }).fetchEvents("4PX1CN"),
    ).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

describe("HTTP failures", () => {
  it("turns 429 into RateLimitedError with Retry-After", async () => {
    const fetch: FetchLike = async () =>
      new Response("slow down", { status: 429, headers: { "retry-after": "120" } });
    const error = await adapterFor({ code: "4PX", adapter: "ship24" }, { env, fetch })
      .fetchEvents("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(120);
  });

  it("reports other errors with the status", async () => {
    const fetch: FetchLike = async () => new Response("bad key", { status: 401 });
    await expect(
      adapterFor({ code: "4PX", adapter: "aftership" }, { env, fetch }).fetchEvents("x"),
    ).rejects.toThrow(AggregatorHttpError);
  });

  it("fails clearly when the API key is missing", async () => {
    await expect(
      adapterFor({ code: "4PX", adapter: "17track" }, { env: {} }).fetchEvents("x"),
    ).rejects.toThrow("SEVENTEEN_TRACK_API_KEY is not set");
  });
});

describe("localOffsetFor", () => {
  it("uses Japan time for Japanese carriers and places, China time for 4PX, UTC otherwise", () => {
    expect(localOffsetFor("SAGAWA")).toBe("+09:00");
    expect(localOffsetFor("4PX", "Narita Airport")).toBe("+09:00");
    expect(localOffsetFor("4PX", "Shenzhen")).toBe("+08:00");
    expect(localOffsetFor(null, null)).toBe("Z");
  });
});

describe("carrierCodeFromAggregator", () => {
  it("maps names and codes", () => {
    expect(carrierCodeFromAggregator("sagawa-express")).toBe("SAGAWA");
    expect(carrierCodeFromAggregator("Japan Post")).toBe("JAPANPOST");
    expect(carrierCodeFromAggregator("yamato-japan")).toBe("YAMATO");
    expect(carrierCodeFromAggregator("dhl")).toBe("DHL");
    expect(carrierCodeFromAggregator(null)).toBeNull();
  });
});
