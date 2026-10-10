import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addNote,
  authorizeSignIn,
  markResolved,
  recordWorkerRun,
  refreshOpenShipments,
  trialMetrics,
} from "../src";
import { createShipment, day, prisma, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("trialMetrics", () => {
  it("counts what the trial write-up needs", async () => {
    const a = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    const b = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    await createShipment([{ at: day(0), status: "DELIVERED" }]);

    // Both open shipments go quiet and become stuck on day 3; the worker notices on day 4.
    await refreshOpenShipments(prisma, day(4));
    await recordWorkerRun(
      prisma,
      { checked: 7, newEvents: 0, handoffs: 0, failures: [], pausedCarriers: [] },
      2,
    );
    // An operator resolves one of them on day 5.
    await prisma.user.create({ data: { email: "op@example.com", role: "OPERATOR" } });
    await authorizeSignIn(
      prisma,
      { email: "op@example.com", emailVerified: true, method: "dev" },
      {},
    );
    await markResolved(prisma, { shipmentId: a }, "op@example.com", day(5));
    await addNote(prisma, { shipmentId: b, text: "Chased Sagawa" }, "op@example.com");

    const metrics = await trialMetrics(prisma, {
      since: day(-1),
      now: new Date(Date.now() + 60_000),
    });
    expect(metrics).toMatchObject({
      shipmentsTracked: 3, // the delivered one had activity in the period too
      openNow: 2,
      carrierChecks: 7,
      stuckSurfaced: 2,
      stuckResolvedByStaff: 1,
      stuckClearedOnTheirOwn: 0,
      activeUsers: 1,
      staffActions: 3, // NO_LONGER_STUCK and STUCK_RESOLVED by the operator, plus the note
      estimate: { minutesSaved: 7 },
    });
    expect(metrics.eventsIngested).toEqual({ FAKE: 3 }); // ingested just now by the test helper
  });

  it("is empty for a quiet period", async () => {
    const metrics = await trialMetrics(prisma, { since: day(-10), now: day(-5) });
    expect(metrics).toMatchObject({
      stuckSurfaced: 0,
      medianHoursStuck: null,
      carrierChecks: 0,
      estimate: { minutesSaved: 0 },
    });
  });
});
