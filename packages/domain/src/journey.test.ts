import { describe, expect, it } from "vitest";
import {
  analyseJourney,
  buildBenchmarks,
  estimateDelivery,
  isMilestone,
  journeyInsights,
  percentile,
  type Benchmarks,
  type JourneyEvent,
  type JourneyInput,
  type Stage,
} from "./journey";

const HOUR = 60 * 60 * 1000;
const t0 = new Date("2026-10-01T00:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * HOUR);

function ev(
  at: number,
  stage: Stage | null,
  legSequence = 1,
  extra: Partial<JourneyEvent> = {},
): JourneyEvent {
  return {
    at: h(at),
    legSequence,
    carrierCode: legSequence === 1 ? "4PX" : "SAGAWA",
    stage,
    message: stage ?? "moving",
    location: null,
    ...extra,
  };
}

const ONE_LEG = [{ sequence: 1, carrierCode: "4PX", trackingNumber: "4PX1CN" }];
const TWO_LEGS = [
  ...ONE_LEG,
  { sequence: 2, carrierCode: "SAGAWA", trackingNumber: "900011112222" },
];

/** Label at 0h, handed to Sagawa at 70h, delivered at 120h. */
function deliveredJourney(): JourneyInput {
  return {
    legs: TWO_LEGS,
    handoffs: [{ toSequence: 2, at: h(70) }],
    status: "DELIVERED",
    events: [
      ev(0, "LABEL_CREATED", 1, { location: "Shenzhen, CN" }),
      ev(10, "PICKED_UP"),
      ev(30, "DEPARTED_ORIGIN"),
      ev(50, "ARRIVED_DESTINATION", 1, { location: "Osaka, JP" }),
      ev(60, "CUSTOMS_CLEARED"),
      ev(70, "HANDED_OFF"),
      ev(80, "LAST_MILE_ACCEPTED", 2, { location: "大阪営業所" }),
      ev(90, null, 2),
      ev(110, "OUT_FOR_DELIVERY", 2),
      ev(120, "DELIVERED", 2, { location: "東京営業所" }),
    ],
  };
}

/** Handed to Sagawa at 70h; Sagawa has not scanned it yet. */
function waitingJourney(): JourneyInput {
  return {
    legs: TWO_LEGS,
    handoffs: [{ toSequence: 2, at: h(70) }],
    status: "HANDED_OFF",
    events: deliveredJourney().events.slice(0, 6),
  };
}

const typical = (median: number, p80: number, samples = 10) => ({ median, p80, samples });
const BENCHMARKS: Benchmarks = {
  segments: {
    PICKUP: typical(10, 14),
    ORIGIN: typical(20, 30),
    LINEHAUL: typical(20, 28),
    DESTINATION: typical(16, 24),
    HANDOFF: typical(12, 20),
    LAST_MILE: typical(30, 40),
  },
  total: typical(110, 130),
};

const segmentHours = (input: JourneyInput, now: Date) =>
  Object.fromEntries(analyseJourney(input, now).segments.map((s) => [s.key, s.hours]));

describe("isMilestone", () => {
  it("tells milestones from problems", () => {
    expect(isMilestone("DELIVERED")).toBe(true);
    expect(isMilestone("CUSTOMS_HOLD")).toBe(false);
  });
});

describe("analyseJourney", () => {
  it("has no position before anything is reported", () => {
    const a = analyseJourney({ legs: ONE_LEG, handoffs: [], events: [], status: "PENDING" }, h(5));
    expect(a.position).toBeNull();
    expect(a.milestones.every((m) => !m.reached && m.at === null)).toBe(true);
    expect(a.segments.every((s) => s.hours === null && !s.ongoing)).toBe(true);
    expect(a).toMatchObject({
      handoff: null,
      problems: [],
      activeProblem: null,
      startedAt: null,
      lastEventAt: null,
      totalHours: null,
      finished: false,
      holder: null,
    });
  });

  it("times every segment of a delivered journey", () => {
    const a = analyseJourney(deliveredJourney(), h(200));
    expect(a.position).toBe("DELIVERED");
    expect(segmentHours(deliveredJourney(), h(200))).toEqual({
      PICKUP: 10,
      ORIGIN: 20,
      LINEHAUL: 20,
      DESTINATION: 20,
      HANDOFF: 10,
      LAST_MILE: 40,
    });
    expect(a.segments.some((s) => s.ongoing)).toBe(false);
    expect(a.handoff).toEqual({
      fromCarrier: "4PX",
      toCarrier: "SAGAWA",
      toTrackingNumber: "900011112222",
      handedOverAt: h(70),
      firstScanAt: h(80),
      gapHours: 10,
      waiting: false,
    });
    expect(a).toMatchObject({
      startedAt: h(0),
      lastEventAt: h(120),
      totalHours: 120,
      finished: true,
      holder: { carrierCode: "SAGAWA", location: "東京営業所" },
    });
    expect(a.milestones.find((m) => m.milestone === "ARRIVED_DESTINATION")).toEqual({
      milestone: "ARRIVED_DESTINATION",
      at: h(50),
      reached: true,
      carrierCode: "4PX",
      location: "Osaka, JP",
    });
  });

  it("uses the first report of each milestone, whatever order events arrive in", () => {
    const input = deliveredJourney();
    input.events = [...input.events, ev(65, "CUSTOMS_CLEARED")].reverse();
    const cleared = analyseJourney(input, h(200)).milestones.find(
      (m) => m.milestone === "CUSTOMS_CLEARED",
    );
    expect(cleared?.at).toEqual(h(60));
  });

  it("does not move backwards when an earlier milestone is reported late", () => {
    const input: JourneyInput = {
      legs: ONE_LEG,
      handoffs: [],
      status: "SHIPPED",
      events: [ev(10, "PICKED_UP"), ev(15, "LABEL_CREATED")],
    };
    const a = analyseJourney(input, h(20));
    expect(a.position).toBe("PICKED_UP");
    // A late label report cannot make the pickup take negative time.
    expect(a.segments.find((s) => s.key === "PICKUP")?.hours).toBe(0);
  });

  it("infers the handover when the last-mile leg appears without one", () => {
    const input: JourneyInput = {
      legs: TWO_LEGS,
      handoffs: [],
      status: "HANDED_OFF",
      events: [ev(50, "ARRIVED_DESTINATION"), ev(80, null, 2)],
    };
    const a = analyseJourney(input, h(90));
    expect(a.handoff).toEqual({
      fromCarrier: "4PX",
      toCarrier: "SAGAWA",
      toTrackingNumber: "900011112222",
      handedOverAt: null,
      firstScanAt: h(80),
      gapHours: null,
      waiting: false,
    });
    expect(
      journeyInsights(a, {
        benchmarks: { segments: {}, total: null },
        now: h(90),
        stuckSince: null,
        stuckDeadline: h(152),
      }),
    ).toEqual([]);
  });

  it("counts the earliest Handoff record as the handover when no carrier event says so", () => {
    const input: JourneyInput = {
      legs: TWO_LEGS,
      handoffs: [
        { toSequence: 2, at: h(75) },
        { toSequence: 2, at: h(70) },
      ],
      status: "HANDED_OFF",
      events: deliveredJourney().events.slice(0, 4),
    };
    const a = analyseJourney(input, h(82));
    expect(a.position).toBe("HANDED_OFF");
    expect(a.milestones.find((m) => m.milestone === "HANDED_OFF")).toMatchObject({
      at: h(70),
      carrierCode: "4PX",
    });
    // Nobody reported customs, but the handover shows it happened.
    expect(a.milestones.find((m) => m.milestone === "CUSTOMS_CLEARED")).toMatchObject({
      reached: true,
      at: null,
    });
    expect(a.handoff).toMatchObject({ waiting: true, gapHours: 12, firstScanAt: null });
    expect(a.segments.find((s) => s.key === "HANDOFF")).toEqual({
      key: "HANDOFF",
      ongoing: true,
      hours: 12,
    });
  });

  it("treats the last-mile carrier's first event as acceptance, unless an earlier scan said so", () => {
    const base = waitingJourney();
    const quietScan = analyseJourney({ ...base, events: [...base.events, ev(85, null, 2)] }, h(90));
    expect(quietScan.milestones.find((m) => m.milestone === "LAST_MILE_ACCEPTED")).toMatchObject({
      at: h(85),
      carrierCode: "SAGAWA",
    });

    const laterAcceptance = analyseJourney(
      { ...base, events: [...base.events, ev(85, null, 2), ev(88, "LAST_MILE_ACCEPTED", 2)] },
      h(90),
    );
    expect(
      laterAcceptance.milestones.find((m) => m.milestone === "LAST_MILE_ACCEPTED")?.at,
    ).toEqual(h(85));

    // An aggregator that does not attribute events leaves the acceptance scan on Leg 1.
    const unattributed = analyseJourney(
      { ...base, events: [...base.events, ev(75, "LAST_MILE_ACCEPTED", 1), ev(85, null, 2)] },
      h(90),
    );
    expect(unattributed.milestones.find((m) => m.milestone === "LAST_MILE_ACCEPTED")?.at).toEqual(
      h(75),
    );
    expect(unattributed.handoff).toMatchObject({ gapHours: 5, waiting: false });
  });

  it("marks milestones implied by later ones as reached but untimed", () => {
    const input: JourneyInput = {
      legs: ONE_LEG,
      handoffs: [],
      status: "HANDED_OFF",
      events: [ev(10, "PICKED_UP"), ev(70, "HANDED_OFF")],
    };
    const a = analyseJourney(input, h(80));
    expect(a.milestones.find((m) => m.milestone === "DEPARTED_ORIGIN")).toMatchObject({
      reached: true,
      at: null,
    });
    expect(segmentHours(input, h(80))).toEqual({
      PICKUP: null,
      ORIGIN: null,
      LINEHAUL: null,
      DESTINATION: null,
      HANDOFF: 10,
      LAST_MILE: null,
    });
    // 4PX said it handed over, but nobody knows the last-mile carrier's number.
    expect(a.handoff).toMatchObject({ toCarrier: null, toTrackingNumber: null, waiting: true });
  });

  it("times the segment the parcel is in from its start, or from the furthest report inside it", () => {
    const arrived: JourneyInput = {
      legs: ONE_LEG,
      handoffs: [],
      status: "IN_TRANSIT",
      events: [ev(10, "PICKED_UP"), ev(50, "ARRIVED_DESTINATION"), ev(60, "CUSTOMS_CLEARED")],
    };
    expect(analyseJourney(arrived, h(80)).segments.find((s) => s.key === "DESTINATION")).toEqual({
      key: "DESTINATION",
      ongoing: true,
      hours: 30,
    });

    const clearedOnly = { ...arrived, events: [ev(10, "PICKED_UP"), ev(60, "CUSTOMS_CLEARED")] };
    expect(
      analyseJourney(clearedOnly, h(80)).segments.find((s) => s.key === "DESTINATION"),
    ).toEqual({ key: "DESTINATION", ongoing: true, hours: 20 });
  });

  it("treats a manual DELIVERED override as delivered even without a delivery event", () => {
    const input = { ...waitingJourney(), status: "DELIVERED" as const };
    const a = analyseJourney(input, h(300));
    expect(a.position).toBe("DELIVERED");
    expect(a.milestones.every((m) => m.reached)).toBe(true);
    expect(a.segments.some((s) => s.ongoing)).toBe(false);
    expect(a.handoff?.waiting).toBe(false);
    // Delivery time is unknown, so the journey is timed to its last event.
    expect(a.totalHours).toBe(70);

    const noEvents = analyseJourney(
      { legs: ONE_LEG, handoffs: [], events: [], status: "DELIVERED" },
      h(300),
    );
    expect(noEvents.totalHours).toBeNull();
  });

  it("keeps a customs hold that cleared as history, not an open problem", () => {
    const events = [
      ev(50, "ARRIVED_DESTINATION"),
      ev(52, "CUSTOMS_HOLD", 1, { message: "Held by customs" }),
    ];
    const held = analyseJourney(
      { legs: ONE_LEG, handoffs: [], events, status: "EXCEPTION" },
      h(60),
    );
    expect(held.activeProblem).toMatchObject({
      problem: "CUSTOMS_HOLD",
      at: h(52),
      carrierCode: "4PX",
      message: "Held by customs",
    });

    const cleared = analyseJourney(
      {
        legs: ONE_LEG,
        handoffs: [],
        events: [...events, ev(80, "CUSTOMS_CLEARED")],
        status: "IN_TRANSIT",
      },
      h(90),
    );
    expect(cleared.problems).toHaveLength(1);
    expect(cleared.activeProblem).toBeNull();
  });

  it("keeps a problem open until a milestone moves the journey on", () => {
    const base = waitingJourney();
    const events = [
      ...base.events,
      ev(80, "LAST_MILE_ACCEPTED", 2),
      ev(100, "DELIVERY_FAILED", 2),
      ev(105, null, 2),
    ];
    const failed = analyseJourney({ ...base, events, status: "EXCEPTION" }, h(110));
    expect(failed.activeProblem?.problem).toBe("DELIVERY_FAILED");

    // Staff overrode it to DELIVERED (e.g. the customer confirmed), so nothing is open.
    const overridden = analyseJourney({ ...base, events, status: "DELIVERED" }, h(110));
    expect(overridden.activeProblem).toBeNull();
  });

  it("keeps a return as the open problem even though the journey is over", () => {
    const base = waitingJourney();
    const a = analyseJourney(
      {
        ...base,
        status: "RETURNED",
        events: [...base.events, ev(80, "LAST_MILE_ACCEPTED", 2), ev(130, "RETURNED", 2)],
      },
      h(200),
    );
    expect(a.finished).toBe(true);
    expect(a.activeProblem?.problem).toBe("RETURNED");
    expect(a.totalHours).toBe(130);
    expect(a.segments.some((s) => s.ongoing)).toBe(false);
  });

  it("reports the holder's last known location", () => {
    const base = deliveredJourney();
    const a = analyseJourney(
      { ...base, status: "HANDED_OFF", events: base.events.slice(0, 8) },
      h(95),
    );
    expect(a.holder).toEqual({ carrierCode: "SAGAWA", location: "大阪営業所" });

    const unlocated = analyseJourney(
      { legs: ONE_LEG, handoffs: [], status: "SHIPPED", events: [ev(10, "PICKED_UP")] },
      h(20),
    );
    expect(unlocated.holder).toEqual({ carrierCode: "4PX", location: null });
  });
});

describe("percentile", () => {
  it("interpolates between sorted values", () => {
    expect(percentile([7], 0.8)).toBe(7);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.8)).toBeCloseTo(3.4);
  });
});

describe("buildBenchmarks", () => {
  it("learns from finished segments and delivered journeys only", () => {
    const fast = deliveredJourney();
    const slow = deliveredJourney();
    slow.events = slow.events.map((e) =>
      e.legSequence === 2 ? { ...e, at: new Date(e.at.getTime() + 20 * HOUR) } : e,
    );
    const stillWaiting = waitingJourney();
    const benchmarks = buildBenchmarks([
      analyseJourney(fast, h(300)),
      analyseJourney(slow, h(300)),
      analyseJourney(stillWaiting, h(300)),
    ]);
    // The waiting parcel's running handoff is not a finished sample.
    expect(benchmarks.segments.HANDOFF).toEqual({ median: 20, p80: 26, samples: 2 });
    expect(benchmarks.segments.DESTINATION).toEqual({ median: 20, p80: 20, samples: 3 });
    expect(benchmarks.total).toEqual({ median: 130, p80: 136, samples: 2 });
  });

  it("leaves out segments and totals nobody has completed", () => {
    const overridden = { ...waitingJourney(), status: "DELIVERED" as const };
    const benchmarks = buildBenchmarks([
      analyseJourney(waitingJourney(), h(100)),
      // Delivered by override: there is no delivery time to learn from.
      analyseJourney(overridden, h(100)),
    ]);
    expect(benchmarks.segments.LAST_MILE).toBeUndefined();
    expect(benchmarks.total).toBeNull();
  });
});

describe("estimateDelivery", () => {
  it("adds the typical time left in each remaining segment", () => {
    const a = analyseJourney(waitingJourney(), h(76));
    // Handoff 6h in: 12-6 more at the median, 20-6 at p80; then the last mile.
    expect(estimateDelivery(a, BENCHMARKS, h(76))).toEqual({
      earliest: h(76 + 6 + 30),
      latest: h(76 + 14 + 40),
      samples: 10,
    });
  });

  it("counts nothing more for a segment already running longer than usual", () => {
    const a = analyseJourney(waitingJourney(), h(100));
    expect(estimateDelivery(a, BENCHMARKS, h(100))).toEqual({
      earliest: h(130),
      latest: h(140),
      samples: 10,
    });
  });

  it("gives no estimate when finished, blocked by a problem, or short of history", () => {
    expect(
      estimateDelivery(analyseJourney(deliveredJourney(), h(200)), BENCHMARKS, h(200)),
    ).toBeNull();

    const held = analyseJourney(
      {
        legs: ONE_LEG,
        handoffs: [],
        status: "EXCEPTION",
        events: [ev(50, "ARRIVED_DESTINATION"), ev(52, "CUSTOMS_HOLD")],
      },
      h(60),
    );
    expect(estimateDelivery(held, BENCHMARKS, h(60))).toBeNull();

    const thin: Benchmarks = {
      ...BENCHMARKS,
      segments: { ...BENCHMARKS.segments, LAST_MILE: typical(30, 40, 3) },
    };
    expect(estimateDelivery(analyseJourney(waitingJourney(), h(76)), thin, h(76))).toBeNull();
  });
});

describe("journeyInsights", () => {
  const context = (overrides: Partial<Parameters<typeof journeyInsights>[1]> = {}) => ({
    benchmarks: BENCHMARKS,
    now: h(76),
    stuckSince: null,
    stuckDeadline: h(190),
    ...overrides,
  });
  const codes = (insights: ReturnType<typeof journeyInsights>) => insights.map((i) => i.code);

  it("flags a parcel stuck after its handoff once, as critical, with no estimate", () => {
    const insights = journeyInsights(
      analyseJourney(waitingJourney(), h(200)),
      context({ now: h(200), stuckSince: h(190) }),
    );
    expect(insights).toEqual([
      {
        code: "STUCK",
        severity: "critical",
        since: h(190),
        carrierCode: "SAGAWA",
        afterHandoff: true,
      },
    ]);
  });

  it("says when a waiting handoff will be flagged, warning once it is slower than usual", () => {
    const early = journeyInsights(analyseJourney(waitingJourney(), h(76)), context());
    expect(early[0]).toEqual({
      code: "WAITING_FOR_LAST_MILE",
      severity: "info",
      carrierCode: "SAGAWA",
      hours: 6,
      typicalHours: 12,
      flagAt: h(190),
    });
    expect(codes(early)).toContain("ESTIMATE");

    const late = journeyInsights(
      analyseJourney(waitingJourney(), h(100)),
      context({ now: h(100) }),
    );
    expect(late[0]).toMatchObject({
      code: "WAITING_FOR_LAST_MILE",
      severity: "warning",
      hours: 30,
    });
  });

  it("warns about a waiting handoff after a day when there is no history", () => {
    const none: Benchmarks = { segments: {}, total: null };
    const at = (hour: number) =>
      journeyInsights(
        analyseJourney(waitingJourney(), h(hour)),
        context({ benchmarks: none, now: h(hour) }),
      );
    expect(at(80)[0]).toMatchObject({ severity: "info", typicalHours: null });
    expect(at(100)[0]).toMatchObject({ severity: "warning" });
  });

  it("asks for the last-mile number when the first carrier handed over without one", () => {
    const insights = journeyInsights(
      analyseJourney(
        {
          legs: ONE_LEG,
          handoffs: [],
          status: "HANDED_OFF",
          events: [ev(10, "PICKED_UP"), ev(70, "HANDED_OFF")],
        },
        h(76),
      ),
      context(),
    );
    expect(insights).toContainEqual({
      code: "NO_LAST_MILE_NUMBER",
      severity: "warning",
      carrierCode: null,
    });
  });

  it("flags a parcel stuck before any handoff, even one nobody has scanned", () => {
    const quiet = journeyInsights(
      analyseJourney(
        { legs: ONE_LEG, handoffs: [], status: "IN_TRANSIT", events: [ev(30, "DEPARTED_ORIGIN")] },
        h(200),
      ),
      context({ now: h(200), stuckSince: h(102) }),
    );
    expect(quiet).toEqual([
      {
        code: "STUCK",
        severity: "critical",
        since: h(102),
        carrierCode: "4PX",
        afterHandoff: false,
      },
    ]);

    const silent = journeyInsights(
      analyseJourney({ legs: ONE_LEG, handoffs: [], status: "PENDING", events: [] }, h(200)),
      context({ now: h(200), stuckSince: h(72) }),
    );
    expect(silent[0]).toMatchObject({ code: "STUCK", carrierCode: null, afterHandoff: false });
  });

  it("does not ask for a last-mile number once 4PX has delivered the parcel itself", () => {
    const insights = journeyInsights(
      analyseJourney(
        {
          legs: ONE_LEG,
          handoffs: [],
          status: "DELIVERED",
          events: [ev(10, "PICKED_UP"), ev(70, "HANDED_OFF"), ev(90, "DELIVERED")],
        },
        h(100),
      ),
      context({ now: h(100) }),
    );
    expect(codes(insights)).not.toContain("NO_LAST_MILE_NUMBER");
  });

  it("says nothing about delivery time when a delivered parcel has no events", () => {
    const insights = journeyInsights(
      analyseJourney({ legs: ONE_LEG, handoffs: [], status: "DELIVERED", events: [] }, h(100)),
      context({ now: h(100) }),
    );
    expect(insights).toEqual([]);
  });

  it("calls out slow segments, quick handoffs and how long delivery took", () => {
    const benchmarks: Benchmarks = {
      ...BENCHMARKS,
      segments: {
        ...BENCHMARKS.segments,
        DESTINATION: typical(8, 12),
        // Over p80 but not 1.5x the median: within the normal spread.
        LAST_MILE: typical(30, 38),
      },
    };
    const insights = journeyInsights(
      analyseJourney(deliveredJourney(), h(200)),
      context({ benchmarks, now: h(200) }),
    );
    expect(insights).toEqual([
      {
        code: "SLOW_SEGMENT",
        severity: "warning",
        segment: "DESTINATION",
        hours: 20,
        typicalHours: 8,
      },
      { code: "DELIVERED", severity: "info", hours: 120, typicalHours: 110 },
      { code: "QUICK_HANDOFF", severity: "good", hours: 10, typicalHours: 12 },
    ]);
  });

  it("praises a fast delivery and ignores segments with too little history", () => {
    const sparse: Benchmarks = {
      // A 10h handoff against a median of 8h is neither slow nor quick.
      segments: { DESTINATION: typical(8, 12, 2), HANDOFF: typical(8, 12) },
      total: typical(150, 170),
    };
    expect(
      journeyInsights(analyseJourney(deliveredJourney(), h(200)), context({ benchmarks: sparse })),
    ).toEqual([{ code: "DELIVERED", severity: "good", hours: 120, typicalHours: 150 }]);

    const noHistory: Benchmarks = { segments: {}, total: null };
    expect(
      journeyInsights(
        analyseJourney(deliveredJourney(), h(200)),
        context({ benchmarks: noHistory }),
      ),
    ).toEqual([{ code: "DELIVERED", severity: "info", hours: 120, typicalHours: null }]);
  });

  it("leads with an open problem, using its own severity", () => {
    const held = journeyInsights(
      analyseJourney(
        {
          legs: ONE_LEG,
          handoffs: [],
          status: "EXCEPTION",
          events: [ev(50, "ARRIVED_DESTINATION"), ev(52, "CUSTOMS_HOLD")],
        },
        h(60),
      ),
      context({ now: h(60) }),
    );
    expect(held[0]).toMatchObject({ code: "PROBLEM", severity: "critical" });

    const base = waitingJourney();
    const awaiting = journeyInsights(
      analyseJourney(
        {
          ...base,
          status: "OUT_FOR_DELIVERY",
          events: [...base.events, ev(80, "LAST_MILE_ACCEPTED", 2), ev(100, "AWAITING_PICKUP", 2)],
        },
        h(110),
      ),
      context({ now: h(110) }),
    );
    expect(awaiting[0]).toMatchObject({ code: "PROBLEM", severity: "warning" });

    const delayed = journeyInsights(
      analyseJourney(
        {
          legs: ONE_LEG,
          handoffs: [],
          status: "IN_TRANSIT",
          events: [ev(30, "DEPARTED_ORIGIN"), ev(40, "DELAYED", 1, { message: "Flight delay" })],
        },
        h(45),
      ),
      context({ now: h(45) }),
    );
    expect(delayed[0]).toMatchObject({ code: "PROBLEM", severity: "info" });
  });
});
