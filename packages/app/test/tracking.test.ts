import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeAdapter,
  RateLimitedError,
  type CarrierAdapter,
  type FakeFixture,
} from "@handoff/carriers";
import { ingestLegEvents, pollDueLegs, refreshOpenShipments } from "../src";
import { auditFor, createShipment, day, prisma, resetDatabase, t0 } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const HOUR = 3600_000;
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);

async function trackingNumberOf(shipmentId: string) {
  return (await prisma.leg.findFirstOrThrow({ where: { shipmentId, sequence: 1 } })).trackingNumber;
}

function fixtureFor(trackingNumber: string): FakeFixture {
  return {
    journeys: [
      {
        carrierCode: "4PX",
        trackingNumber,
        events: [
          {
            offsetHours: 1,
            rawStatus: "PICKED_UP",
            rawMessage: "Parcel picked up",
            location: "Shenzhen",
          },
          {
            offsetHours: 30,
            rawStatus: "HANDOVER",
            rawMessage: "Handed over to last-mile carrier: Sagawa (900000000555)",
            location: "Osaka",
          },
        ],
      },
      {
        carrierCode: "SAGAWA",
        trackingNumber: "900000000555",
        events: [
          { offsetHours: 40, rawStatus: "配達中", rawMessage: "配達中です", location: "東京" },
        ],
      },
    ],
  };
}

function fakeAdapters(fixture: FakeFixture, now: Date) {
  return (carrier: { code: string }) =>
    createFakeAdapter(carrier.code, { fixture, anchor: t0, now: () => now });
}

describe("pollDueLegs", () => {
  it("follows a journey across the handoff as time passes", async () => {
    const id = await createShipment();
    const fixture = fixtureFor(await trackingNumberOf(id));

    let report = await pollDueLegs(prisma, {
      adapterFor: fakeAdapters(fixture, at(2)),
      now: at(2),
    });
    expect(report).toMatchObject({ checked: 1, newEvents: 1, handoffs: 0 });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id } })).status).toBe("SHIPPED");

    // Not due again until the carrier's poll interval (240 minutes) has passed.
    expect(
      (await pollDueLegs(prisma, { adapterFor: fakeAdapters(fixture, at(3)), now: at(3) })).checked,
    ).toBe(0);

    report = await pollDueLegs(prisma, { adapterFor: fakeAdapters(fixture, at(31)), now: at(31) });
    expect(report).toMatchObject({ checked: 1, newEvents: 1, handoffs: 1 });
    const legs = await prisma.leg.findMany({
      where: { shipmentId: id },
      orderBy: { sequence: "asc" },
    });
    expect(
      legs.map((l) => [l.carrierCode, l.trackingNumber === "900000000555" ? "new" : "old"]),
    ).toEqual([
      ["4PX", "old"],
      ["SAGAWA", "new"],
    ]);
    expect(await prisma.handoff.findFirst({ where: { shipmentId: id } })).toMatchObject({
      source: "CARRIER_EVENT",
    });

    report = await pollDueLegs(prisma, { adapterFor: fakeAdapters(fixture, at(41)), now: at(41) });
    expect(report).toMatchObject({ checked: 1, newEvents: 1 });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id } })).status).toBe(
      "OUT_FOR_DELIVERY",
    );

    const actions = (await auditFor(id)).map((e) => [e.action, e.actor]);
    expect(actions).toContainEqual(["HANDOFF_RECORDED", "system:worker"]);
    expect(actions.filter(([a]) => a === "EVENTS_INGESTED")).toHaveLength(3);
  });

  it("pauses a carrier after a 429 and skips its other legs", async () => {
    await createShipment();
    await createShipment();
    let calls = 0;
    const limited: CarrierAdapter = {
      code: "4PX",
      async fetchEvents() {
        calls++;
        throw new RateLimitedError("4PX", 60);
      },
    };
    const report = await pollDueLegs(prisma, { adapterFor: () => limited, now: day(1) });
    expect(calls).toBe(1);
    expect(report.pausedCarriers).toEqual(["4PX"]);
    expect(
      (await prisma.carrier.findUniqueOrThrow({ where: { code: "4PX" } })).pausedUntil,
    ).toEqual(new Date(day(1).getTime() + 60_000));
    expect((await pollDueLegs(prisma, { adapterFor: () => limited, now: day(1) })).checked).toBe(0);
  });

  it("records failures on the leg and carries on", async () => {
    const id = await createShipment();
    const broken: CarrierAdapter = {
      code: "4PX",
      async fetchEvents() {
        throw new Error("upstream 500");
      },
    };
    const report = await pollDueLegs(prisma, { adapterFor: () => broken, now: day(1) });
    expect(report.failures).toHaveLength(1);
    const leg = await prisma.leg.findFirstOrThrow({ where: { shipmentId: id } });
    expect(leg).toMatchObject({ lastCheckError: "upstream 500", lastCheckedAt: day(1) });
  });

  it("never polls manual carriers or finished shipments", async () => {
    await prisma.carrier.update({ where: { code: "4PX" }, data: { adapter: "manual" } });
    await createShipment();
    await prisma.carrier.update({ where: { code: "4PX" }, data: { adapter: "fake" } });
    await createShipment([{ at: day(0), status: "DELIVERED" }]);
    await prisma.carrier.update({ where: { code: "4PX" }, data: { adapter: "manual" } });
    expect(
      (
        await pollDueLegs(prisma, {
          adapterFor: () => {
            throw new Error("should not be called");
          },
          now: day(1),
        })
      ).checked,
    ).toBe(0);
  });
});

describe("ingestLegEvents", () => {
  it("is idempotent", async () => {
    const id = await createShipment();
    const leg = await prisma.leg.findFirstOrThrow({ where: { shipmentId: id } });
    const events = [
      {
        occurredAt: day(0),
        rawStatus: "PICKED_UP",
        rawMessage: "Parcel picked up",
        location: null,
      },
    ];
    expect((await ingestLegEvents(prisma, { legId: leg.id, events }, day(1))).newEvents).toBe(1);
    expect((await ingestLegEvents(prisma, { legId: leg.id, events }, day(1))).newEvents).toBe(0);
    expect((await auditFor(id)).filter((e) => e.action === "EVENTS_INGESTED")).toHaveLength(1);
  });

  it("creates a carrier it has not seen before, using the reporting adapter", async () => {
    const id = await createShipment();
    const leg = await prisma.leg.findFirstOrThrow({ where: { shipmentId: id } });
    await ingestLegEvents(
      prisma,
      {
        legId: leg.id,
        events: [],
        handoff: { nextCarrierCode: "YAMATO", nextTrackingNumber: "Y123" },
      },
      day(1),
    );
    expect(await prisma.carrier.findUnique({ where: { code: "YAMATO" } })).toMatchObject({
      adapter: "fake",
    });
  });
});

describe("refreshOpenShipments", () => {
  it("flags shipments that went quiet just because time passed", async () => {
    const id = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    expect(await refreshOpenShipments(prisma, day(2))).toEqual({ open: 1, changed: 0 });
    expect(await refreshOpenShipments(prisma, day(4))).toEqual({ open: 1, changed: 1 });
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id } })).stuckSince).toEqual(day(3));
  });
});
