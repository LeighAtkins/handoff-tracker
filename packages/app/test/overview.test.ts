import { beforeEach, describe, expect, it } from "vitest";
import { normalise } from "@handoff/carriers";
import { refreshShipment } from "@handoff/db";
import { loadBenchmarks, shipmentJourney } from "../src/journey";
import { overview } from "../src/overview";
import { shipmentAggregateInclude } from "@handoff/db";
import { prisma, resetDatabase } from "./helpers";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-30T00:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

type Step = [hoursAgo: number, rawStatus: string, rawMessage?: string];

/**
 * A 4PX parcel with the given 4PX steps and, if any, Sagawa steps after a handover. Raw statuses
 * are our fake carrier's codes, so stages and statuses come from the real classifiers.
 */
async function parcel(order: string, fourPx: Step[], sagawa: Step[] = []) {
  const created = ago(fourPx[0]![0] + 1);
  const shipment = await prisma.shipment.create({
    data: {
      createdAt: created,
      order: {
        create: {
          sourceSystem: "test",
          sourceOrderNumber: order,
          customerName: "Test",
          destinationCountry: "JP",
          destinationPostcode: "100-0001",
          createdAt: created,
        },
      },
    },
  });
  const handover = fourPx.find(([, code]) => code === "HANDOVER");
  const leg1 = await prisma.leg.create({
    data: {
      shipmentId: shipment.id,
      sequence: 1,
      carrierCode: "4PX",
      trackingNumber: `4PX-${order}`,
      startedAt: created,
      endedAt: handover ? ago(handover[0]) : null,
      events: {
        create: fourPx.map(([hours, rawStatus, rawMessage = rawStatus]) => ({
          occurredAt: ago(hours),
          rawStatus,
          rawMessage,
          normalisedStatus: normalise("4PX", { rawStatus, rawMessage }),
          source: "FAKE" as const,
        })),
      },
    },
  });
  if (handover) {
    const leg2 = await prisma.leg.create({
      data: {
        shipmentId: shipment.id,
        sequence: 2,
        carrierCode: "SAGAWA",
        trackingNumber: `9${order}`,
        startedAt: ago(handover[0]),
        events: {
          create: sagawa.map(([hours, rawStatus, rawMessage = rawStatus]) => ({
            occurredAt: ago(hours),
            rawStatus,
            rawMessage,
            normalisedStatus: normalise("SAGAWA", { rawStatus, rawMessage }),
            source: "FAKE" as const,
          })),
        },
      },
    });
    await prisma.handoff.create({
      data: {
        shipmentId: shipment.id,
        fromLegId: leg1.id,
        toLegId: leg2.id,
        detectedAt: ago(handover[0]),
        source: "CARRIER_EVENT",
      },
    });
  }
  await refreshShipment(prisma, shipment.id, now);
  return shipment.id;
}

const china: Step[] = [
  [200, "INFO_RECEIVED"],
  [190, "PICKED_UP"],
  [170, "FLIGHT_DEPARTED"],
  [160, "ARRIVED_DEST"],
  [150, "CUSTOMS_CLEARED"],
];
const shift = (steps: Step[], by: number): Step[] => steps.map(([h, ...rest]) => [h - by, ...rest]);

beforeEach(async () => {
  await resetDatabase();
  // Two delivered parcels: handoff gaps of 6h and 30h, door to door 6.9 and 4.0 days.
  await parcel(
    "D1",
    [...china, [140, "HANDOVER"]],
    [
      [134, "", "荷物を受け付けました"],
      [40, "", "配達中です"],
      [35, "", "配達が完了しました"],
    ],
  );
  await parcel(
    "D2",
    [...shift(china, 30), [110, "HANDOVER"]],
    [
      [80, "", "荷物を受け付けました"],
      [75, "", "配達が完了しました"],
    ],
  );
  // Open: waiting for Sagawa 4 days after the handover (not stuck until 5).
  await parcel("W1", [...shift(china, 50), [96, "HANDOVER"]]);
  // Open: in the air.
  await parcel("A1", [
    [30, "INFO_RECEIVED"],
    [20, "PICKED_UP"],
    [10, "FLIGHT_DEPARTED"],
  ]);
  // Open: held by customs.
  await parcel("H1", [...shift(china, 100).slice(0, 4), [40, "CUSTOMS_HOLD", "Held by customs"]]);
});

describe("overview", () => {
  it("shows where open parcels are, and which have a problem", async () => {
    const o = await overview(prisma, { now });
    expect(o.open).toBe(3);
    expect(Object.fromEntries(o.pipeline.map((p) => [p.stage, [p.count, p.withProblem]]))).toEqual({
      IN_CHINA: [0, 0],
      IN_THE_AIR: [1, 0],
      IN_CUSTOMS: [1, 1],
      AWAITING_LAST_MILE: [1, 0],
      WITH_LAST_MILE: [0, 0],
      OUT_FOR_DELIVERY: [0, 0],
    });
    expect(o.openProblems).toEqual([{ problem: "CUSTOMS_HOLD", count: 1 }]);
    expect(o.waitingAtHandoff).toBe(1);
    expect(o.stuck).toBe(0);
  });

  it("measures door-to-door time and the handoff against the target", async () => {
    const o = await overview(prisma, { now, targetDays: 6 });
    expect(o.delivered).toEqual({ count: 2, medianDays: 5.4, p80Days: 6.3, withinTarget: 0.5 });
    expect(o.handoff).toMatchObject({ samples: 2, medianHours: 18, within24h: 0.5 });
    expect(o.handoff.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(o.segments.find((s) => s.key === "HANDOFF")).toEqual({
      key: "HANDOFF",
      medianHours: 18,
      p80Hours: 25.2,
      samples: 2,
    });
  });

  it("counts deliveries per week, oldest week first", async () => {
    const o = await overview(prisma, { now, weeks: 2 });
    expect(o.weekly.map((w) => [w.delivered, w.medianDays])).toEqual([
      [0, null],
      [2, 5.4],
    ]);
  });

  it("lists parcels that need someone, most urgent first", async () => {
    const o = await overview(prisma, { now });
    expect(o.attention.map((a) => [a.orderNumber, a.insight.code, a.insight.severity])).toEqual([
      ["H1", "PROBLEM", "critical"],
      ["W1", "WAITING_FOR_LAST_MILE", "warning"],
    ]);
    expect(o.attention[1]).toMatchObject({ carrierCode: "SAGAWA", trackingNumber: "9W1" });
  });
});

describe("shipment journeys", () => {
  it("compare a parcel with the benchmarks learnt from the others", async () => {
    const benchmarks = await loadBenchmarks(prisma, now);
    expect(benchmarks.segments.HANDOFF?.samples).toBe(2);
    const row = await prisma.shipment.findFirstOrThrow({
      where: { order: { sourceOrderNumber: "W1" } },
      include: shipmentAggregateInclude,
    });
    const view = shipmentJourney(row, { benchmarks, now });
    expect(view.analysis.position).toBe("HANDED_OFF");
    expect(view.stuckDeadline).toEqual(new Date(ago(96).getTime() + 5 * 24 * HOUR));
    expect(view.insights[0]).toMatchObject({ code: "WAITING_FOR_LAST_MILE", hours: 96 });
  });
});
