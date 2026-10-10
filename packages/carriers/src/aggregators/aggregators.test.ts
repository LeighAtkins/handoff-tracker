import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import { normalise } from "../normaliser";
import { adapterFor } from "../registry";
import { carrierCodeFromAggregator } from "./aggregator";
import { AggregatorHttpError, type FetchLike } from "./http";
import { ship24Time } from "./ship24";

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
    expect(sagawaEvents[1]?.rawStatus).toBe("DeliveryFailure");
    expect(normalise("SAGAWA", sagawaEvents[1]!)).toBe("EXCEPTION");
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
    next_couriers: [{ slug: "sagawa", tracking_number: "900011112222" }],
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

describe("carrierCodeFromAggregator", () => {
  it("maps names and codes", () => {
    expect(carrierCodeFromAggregator("sagawa-express")).toBe("SAGAWA");
    expect(carrierCodeFromAggregator("Japan Post")).toBe("JAPANPOST");
    expect(carrierCodeFromAggregator("yamato-japan")).toBe("YAMATO");
    expect(carrierCodeFromAggregator("dhl")).toBe("DHL");
    expect(carrierCodeFromAggregator(null)).toBeNull();
  });
});
