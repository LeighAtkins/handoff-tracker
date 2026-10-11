import { beforeEach, describe, expect, it } from "vitest";
import {
  createSampleClient,
  type AggregatorClient,
  type AggregatorResult,
  type AttributedEvent,
} from "@handoff/carriers";
import { analyseJourney } from "@handoff/domain";
import {
  carrierForNumber,
  lookupJourney,
  lookupTracking,
  normaliseTrackingNumber,
  recentLookups,
  type LookupResult,
} from "../src/lookup";
import { createShipment, prisma, resetDatabase, t0 } from "./helpers";

const HOUR = 60 * 60 * 1000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

function event(
  hours: number,
  rawStatus: string,
  extra: Partial<AttributedEvent> = {},
): AttributedEvent {
  return {
    occurredAt: at(hours),
    rawStatus,
    rawMessage: rawStatus,
    location: null,
    carrierCode: "4PX",
    trackingNumber: "4PX3002711212113CN",
    ...extra,
  };
}

/** A provider that answers with a fixed result (or throws), counting calls. */
function provider(name: string, answer: AggregatorResult | Error) {
  const calls: string[] = [];
  const client: AggregatorClient = {
    name,
    async track(trackingNumber) {
      calls.push(trackingNumber);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { name, client, calls };
}

const ready: AggregatorResult = {
  events: [event(0, "FPX_L_RPIF"), event(10, "FPX_C_SPLS", { location: "Shenzhen" })],
  handoff: null,
  facts: {
    destinationCountry: "JP",
    lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" },
    estimatedDelivery: { from: at(100), to: null, source: "4PX" },
  },
};

beforeEach(resetDatabase);

describe("normaliseTrackingNumber", () => {
  it("accepts numbers pasted with spaces or hyphens, and rejects anything else", () => {
    expect(normaliseTrackingNumber(" 4px 3002-7112-12113cn ")).toBe("4PX3002711212113CN");
    expect(normaliseTrackingNumber("9000 1111 2222")).toBe("900011112222");
    expect(normaliseTrackingNumber("abc")).toBeNull();
    expect(normaliseTrackingNumber("4PX'; DROP TABLE")).toBeNull();
  });

  it("knows 12-digit numbers are Sagawa's", () => {
    expect(carrierForNumber("900011112222")).toBe("SAGAWA");
    expect(carrierForNumber("4PX3002711212113CN")).toBe("4PX");
  });
});

describe("lookupTracking", () => {
  const number = "4PX3002711212113CN";
  const actor = "operator@example.com";

  it("says so when no provider is connected", async () => {
    const result = await lookupTracking(
      prisma,
      { trackingNumber: number, actor },
      { candidates: [] },
    );
    expect(result).toMatchObject({ state: "NO_PROVIDER", provider: null, events: [] });
    expect(await prisma.trackingLookup.count()).toBe(0);
  });

  it("asks the first provider, stores the answer and audits the lookup", async () => {
    const fourPx = provider("4PX", ready);
    const result = await lookupTracking(
      prisma,
      { trackingNumber: number, actor },
      { candidates: [fourPx], now: at(20) },
    );
    expect(result).toMatchObject({
      provider: "4PX",
      state: "READY",
      fetchedAt: at(20),
      fromCache: false,
      shipment: null,
    });
    expect(result.events).toHaveLength(2);
    expect(fourPx.calls).toEqual([number]);

    const audit = await prisma.auditEntry.findMany({ where: { entityType: "Lookup" } });
    expect(audit.map((a) => [a.action, a.entityId, a.actor, a.after])).toEqual([
      ["TRACKING_LOOKED_UP", number, actor, { provider: "4PX", state: "READY", events: 2 }],
    ]);
  });

  it("reuses a fresh answer, with its dates intact, until asked to refresh", async () => {
    const fourPx = provider("4PX", ready);
    const options = { candidates: [fourPx] };
    await lookupTracking(prisma, { trackingNumber: number, actor }, { ...options, now: at(20) });

    const cached = await lookupTracking(
      prisma,
      { trackingNumber: number, actor: "viewer@example.com" },
      { ...options, now: at(20.2) },
    );
    expect(cached.fromCache).toBe(true);
    expect(cached.events[1]).toEqual(ready.events[1]);
    expect(cached.facts?.estimatedDelivery).toEqual({ from: at(100), to: null, source: "4PX" });
    expect(fourPx.calls).toHaveLength(1);
    expect((await recentLookups(prisma))[0]).toMatchObject({
      trackingNumber: number,
      lookedUpBy: "viewer@example.com",
    });

    await lookupTracking(
      prisma,
      { trackingNumber: number, actor, refresh: true },
      { ...options, now: at(20.3) },
    );
    await lookupTracking(prisma, { trackingNumber: number, actor }, { ...options, now: at(21) });
    expect(fourPx.calls).toHaveLength(3);
  });

  it("moves on when a provider does not know the number or fails", async () => {
    const fourPx = provider("4PX", { events: [], handoff: null, state: "NOT_FOUND" });
    const ship24 = provider("SHIP24", new Error("SHIP24 responded 401: bad key"));
    const seventeen = provider("17TRACK", ready);
    const result = await lookupTracking(
      prisma,
      { trackingNumber: number, actor },
      { candidates: [fourPx, ship24, seventeen], now: at(20) },
    );
    expect(result.provider).toBe("17TRACK");
    expect([fourPx.calls.length, ship24.calls.length]).toEqual([1, 1]);
  });

  it("reports pending, not found and errors when nobody has events", async () => {
    const pending = await lookupTracking(
      prisma,
      { trackingNumber: number, actor },
      {
        candidates: [
          provider("4PX", { events: [], handoff: null, state: "NOT_FOUND" }),
          provider("17TRACK", { events: [], handoff: null, state: "PENDING" }),
        ],
        now: at(20),
      },
    );
    expect(pending).toMatchObject({ state: "PENDING", provider: "17TRACK" });

    const notFound = await lookupTracking(
      prisma,
      { trackingNumber: "4PX1111111111111CN", actor },
      { candidates: [provider("4PX", { events: [], handoff: null, state: "NOT_FOUND" })] },
    );
    expect(notFound).toMatchObject({ state: "NOT_FOUND", provider: "4PX" });

    const failed = await lookupTracking(
      prisma,
      { trackingNumber: "4PX2222222222222CN", actor },
      { candidates: [provider("4PX", new Error("4PX refused the request (500): APP不存在"))] },
    );
    expect(failed).toMatchObject({ state: "ERROR", provider: "4PX" });
    expect(failed.error).toContain("APP不存在");
  });

  it("points to the tracked shipment that already uses the number", async () => {
    const shipmentId = await createShipment();
    const leg = await prisma.leg.findFirstOrThrow({ where: { shipmentId } });
    const result = await lookupTracking(
      prisma,
      { trackingNumber: leg.trackingNumber, actor },
      { candidates: [provider("4PX", ready)] },
    );
    expect(result.shipment).toEqual({ id: shipmentId, orderNumber: expect.stringMatching(/^T-/) });
  });

  it("answers sample numbers from the sample journeys", async () => {
    const result = await lookupTracking(prisma, { trackingNumber: "4PXDEMO1001CN", actor });
    expect(result).toMatchObject({ provider: "SAMPLE", state: "READY" });
  });
});

describe("lookupJourney", () => {
  const base: LookupResult = {
    trackingNumber: "4PX3002711212113CN",
    provider: "4PX",
    state: "READY",
    fetchedAt: at(200),
    error: null,
    events: [],
    handoff: null,
    facts: null,
    fromCache: false,
    shipment: null,
  };

  it("puts 4PX's reports of Sagawa's work on the Sagawa leg", () => {
    const { input, state } = lookupJourney(
      {
        ...base,
        events: [
          event(0, "FPX_L_RPIF"),
          event(30, "FPX_M_DFOA"),
          event(40, "FPX_M_ATA"),
          event(60, "FPX_D_STPP"),
          event(70, "FPX_O_RR"),
          event(90, "FPX_D_SD"),
          event(95, "FPX_S_OK"),
        ],
        handoff: { nextCarrierCode: "SAGAWA", nextTrackingNumber: "900011112222" },
      },
      at(200),
    );
    expect(input.legs).toEqual([
      { sequence: 1, carrierCode: "4PX", trackingNumber: "4PX3002711212113CN" },
      { sequence: 2, carrierCode: "SAGAWA", trackingNumber: "900011112222" },
    ]);
    expect(input.events.map((e) => [e.legSequence, e.stage])).toEqual([
      [1, "LABEL_CREATED"],
      [1, "DEPARTED_ORIGIN"],
      [1, "ARRIVED_DESTINATION"],
      [1, "HANDED_OFF"],
      [2, "LAST_MILE_ACCEPTED"],
      [2, "OUT_FOR_DELIVERY"],
      [2, "DELIVERED"],
    ]);
    expect(input.status).toBe("DELIVERED");
    expect(input.handoffs).toEqual([{ toSequence: 2, at: at(60) }]);
    expect(state.legs[0]?.endedAt).toEqual(at(60));
    const analysis = analyseJourney(input, at(200));
    expect(analysis.handoff).toMatchObject({ gapHours: 10, waiting: false });
  });

  it("builds the Sagawa leg from an aggregator's Sagawa events", () => {
    const { input } = lookupJourney(
      {
        ...base,
        provider: "SHIP24",
        events: [
          event(40, "", { rawMessage: "Arrived at destination airport" }),
          event(80, "", {
            rawMessage: "荷物を受け付けました",
            carrierCode: "SAGAWA",
            trackingNumber: "900011112222",
          }),
        ],
      },
      at(100),
    );
    expect(input.legs[1]).toEqual({
      sequence: 2,
      carrierCode: "SAGAWA",
      trackingNumber: "900011112222",
    });
    expect(input.events.map((e) => [e.legSequence, e.stage])).toEqual([
      [1, "ARRIVED_DESTINATION"],
      [2, "LAST_MILE_ACCEPTED"],
    ]);
    expect(input.handoffs).toEqual([{ toSequence: 2, at: at(80) }]);
    expect(input.status).toBe("HANDED_OFF");
  });

  it("keeps a single leg while the last-mile number is only planned", () => {
    const { input, state } = lookupJourney(
      {
        ...base,
        events: [event(0, "FPX_L_RPIF"), event(30, "FPX_M_DFOA")],
        facts: { lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" } },
      },
      at(40),
    );
    expect(input.legs).toHaveLength(1);
    expect(input.handoffs).toEqual([]);
    expect(input.status).toBe("IN_TRANSIT");
    expect(state.createdAt).toEqual(at(0));
  });

  it("starts an empty journey when the provider answered", () => {
    const { input, state } = lookupJourney(
      { ...base, provider: "17TRACK", state: "PENDING" },
      at(5),
    );
    expect(input).toMatchObject({ legs: [{ sequence: 1 }], events: [], status: "PENDING" });
    expect(state.createdAt).toEqual(at(200));
  });

  it("uses the last-mile number from the facts when events do not carry it", async () => {
    const sample = await createSampleClient({ now: () => at(300) }).track("4PXDEMO1004CN", "4PX");
    const events = sample.events.map((e) => ({ ...e, trackingNumber: null }));
    const { input } = lookupJourney(
      {
        ...base,
        trackingNumber: "4PXDEMO1004CN",
        provider: "SAMPLE",
        ...sample,
        events,
        handoff: null,
      },
      at(300),
    );
    expect(input.legs[1]?.trackingNumber).toBe("900000101004");
    expect(input.events.at(-1)).toMatchObject({ legSequence: 2, stage: "DELIVERY_FAILED" });
  });
});
