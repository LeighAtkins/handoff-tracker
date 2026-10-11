import type { Status } from "./status";

/**
 * Points along a 4PX → last-mile journey, in the order they normally happen. Carriers report
 * them in their own words; packages/carriers classifies each event into one of these (or a
 * Problem), the same way it normalises status.
 */
export const MILESTONES = [
  "LABEL_CREATED",
  "PICKED_UP",
  "DEPARTED_ORIGIN",
  "ARRIVED_DESTINATION",
  "CUSTOMS_CLEARED",
  "HANDED_OFF",
  "LAST_MILE_ACCEPTED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Events off the happy path that need someone's attention. */
export const PROBLEMS = [
  "DELAYED",
  "CUSTOMS_HOLD",
  "DELIVERY_FAILED",
  "ADDRESS_PROBLEM",
  "AWAITING_PICKUP",
  "RETURNING",
  "RETURNED",
  "EXCEPTION",
] as const;
export type Problem = (typeof PROBLEMS)[number];

export type Stage = Milestone | Problem;

export function isMilestone(stage: Stage): stage is Milestone {
  return (MILESTONES as readonly string[]).includes(stage);
}

/**
 * The stretches of a journey that are worth timing. HANDOFF is the one this app exists for:
 * from the first carrier's handover to the last-mile carrier's first scan.
 */
export const SEGMENTS = [
  { key: "PICKUP", from: "LABEL_CREATED", to: "PICKED_UP" },
  { key: "ORIGIN", from: "PICKED_UP", to: "DEPARTED_ORIGIN" },
  { key: "LINEHAUL", from: "DEPARTED_ORIGIN", to: "ARRIVED_DESTINATION" },
  { key: "DESTINATION", from: "ARRIVED_DESTINATION", to: "HANDED_OFF" },
  { key: "HANDOFF", from: "HANDED_OFF", to: "LAST_MILE_ACCEPTED" },
  { key: "LAST_MILE", from: "LAST_MILE_ACCEPTED", to: "DELIVERED" },
] as const satisfies readonly { key: string; from: Milestone; to: Milestone }[];
export type SegmentKey = (typeof SEGMENTS)[number]["key"];

export interface JourneyEvent {
  at: Date;
  legSequence: number;
  carrierCode: string;
  /** Null when the carrier message does not mark a milestone or a problem. */
  stage: Stage | null;
  message: string;
  location: string | null;
}

export interface JourneyInput {
  legs: { sequence: number; carrierCode: string; trackingNumber: string }[];
  handoffs: { toSequence: number; at: Date }[];
  events: JourneyEvent[];
  /** The Shipment's current status, which may be a manual override. */
  status: Status;
}

export interface MilestonePoint {
  milestone: Milestone;
  /** When a carrier first reported it. Null if it was never reported. */
  at: Date | null;
  /** Reported, or implied because a later milestone was reported. */
  reached: boolean;
  carrierCode: string | null;
  location: string | null;
}

/** Hours from one milestone to the next, or so far for the segment the parcel is in now. */
export type SegmentTiming =
  | { key: SegmentKey; ongoing: true; hours: number }
  | { key: SegmentKey; ongoing: false; hours: number | null };

export interface ProblemEvent {
  problem: Problem;
  at: Date;
  carrierCode: string;
  message: string;
  location: string | null;
}

export interface HandoffSummary {
  fromCarrier: string;
  toCarrier: string | null;
  toTrackingNumber: string | null;
  handedOverAt: Date | null;
  firstScanAt: Date | null;
  /** Hours from handover to the receiving carrier's first scan, or so far while waiting. */
  gapHours: number | null;
  /** Handed over, and the receiving carrier has not reported anything yet. */
  waiting: boolean;
}

export interface JourneyAnalysis {
  milestones: MilestonePoint[];
  segments: SegmentTiming[];
  /** The furthest milestone reached, or null before anything is reported. */
  position: Milestone | null;
  handoff: HandoffSummary | null;
  problems: ProblemEvent[];
  /** The latest problem, unless the journey has moved on since. */
  activeProblem: ProblemEvent | null;
  startedAt: Date | null;
  lastEventAt: Date | null;
  /** Hours from the first event to delivery (or until now while open). */
  totalHours: number | null;
  finished: boolean;
  /** Who has the parcel now, going by the latest event. */
  holder: { carrierCode: string; location: string | null } | null;
}

const HOUR_MS = 60 * 60 * 1000;
const hoursBetween = (from: Date, to: Date) =>
  Math.max(0, (to.getTime() - from.getTime()) / HOUR_MS);
const rank = (milestone: Milestone) => MILESTONES.indexOf(milestone);
const byTime = <T extends { at: Date }>(a: T, b: T) => a.at.getTime() - b.at.getTime();

/** Turns a journey's events into milestones, timed segments, the handoff and any open problem. */
export function analyseJourney(input: JourneyInput, now: Date): JourneyAnalysis {
  const events = [...input.events].sort(byTime);
  const finished = input.status === "DELIVERED" || input.status === "RETURNED";

  const reported = new Map<Milestone, { at: Date; carrierCode: string; location: string | null }>();
  for (const event of events) {
    if (event.stage && isMilestone(event.stage) && !reported.has(event.stage))
      reported.set(event.stage, event);
  }
  // A Handoff record counts as a handover even when no carrier event said so (ADR-0002).
  const recorded = [...input.handoffs].sort(byTime)[0];
  if (recorded && !reported.has("HANDED_OFF")) {
    reported.set("HANDED_OFF", {
      at: recorded.at,
      carrierCode: input.legs[0]!.carrierCode,
      location: null,
    });
  }
  // Any event from a later Leg means the last-mile carrier has the parcel.
  const firstLastMile = events.find((e) => e.legSequence > 1) ?? null;
  const accepted = reported.get("LAST_MILE_ACCEPTED");
  if (firstLastMile && (!accepted || firstLastMile.at < accepted.at)) {
    reported.set("LAST_MILE_ACCEPTED", firstLastMile);
  }

  let position: Milestone | null = null;
  for (const milestone of reported.keys()) {
    if (!position || rank(milestone) > rank(position)) position = milestone;
  }
  if (input.status === "DELIVERED") position = "DELIVERED";

  const milestones: MilestonePoint[] = MILESTONES.map((milestone) => {
    const point = reported.get(milestone);
    return {
      milestone,
      at: point?.at ?? null,
      reached: position !== null && rank(milestone) <= rank(position),
      carrierCode: point?.carrierCode ?? null,
      location: point?.location ?? null,
    };
  });
  const point = (milestone: Milestone) => milestones[rank(milestone)]!;

  const segments: SegmentTiming[] = SEGMENTS.map(({ key, from, to }): SegmentTiming => {
    const start = point(from);
    const end = point(to);
    if (start.at && end.at) return { key, hours: hoursBetween(start.at, end.at), ongoing: false };
    if (!start.reached || end.reached || finished) return { key, hours: null, ongoing: false };
    // The parcel is inside this segment, so the furthest milestone reported lies within it. Time
    // from the segment's start, or from that milestone if nobody reported the start.
    const since = start.at ?? point(position!).at!;
    return { key, hours: hoursBetween(since, now), ongoing: true };
  });

  const problems: ProblemEvent[] = events
    .filter((e) => e.stage !== null && !isMilestone(e.stage))
    .map((e) => ({
      problem: e.stage as Problem,
      at: e.at,
      carrierCode: e.carrierCode,
      message: e.message,
      location: e.location,
    }));
  const latestProblem = problems.at(-1) ?? null;
  const movedOnSince =
    latestProblem !== null &&
    events.some((e) => e.at > latestProblem.at && e.stage !== null && isMilestone(e.stage));
  // A manual DELIVERED override (e.g. the customer confirmed) closes any open problem.
  const activeProblem =
    latestProblem && !movedOnSince && input.status !== "DELIVERED" ? latestProblem : null;

  const lastLeg = input.legs.at(-1)!;
  const handedOver = point("HANDED_OFF");
  const firstScan = point("LAST_MILE_ACCEPTED");
  const handoff: HandoffSummary | null =
    handedOver.reached || input.legs.length > 1
      ? {
          fromCarrier: input.legs[0]!.carrierCode,
          toCarrier: input.legs.length > 1 ? lastLeg.carrierCode : null,
          toTrackingNumber: input.legs.length > 1 ? lastLeg.trackingNumber : null,
          handedOverAt: handedOver.at,
          firstScanAt: firstScan.at,
          gapHours: segments.find((s) => s.key === "HANDOFF")!.hours,
          waiting: handedOver.reached && !firstScan.reached && !finished,
        }
      : null;

  const startedAt = events[0]?.at ?? null;
  const lastEvent = events.at(-1) ?? null;
  const endedAt = point("DELIVERED").at ?? (finished ? (lastEvent?.at ?? null) : now);
  const located = [...events].reverse().find((e) => e.location);

  return {
    milestones,
    segments,
    position,
    handoff,
    problems,
    activeProblem,
    startedAt,
    lastEventAt: lastEvent?.at ?? null,
    totalHours: startedAt && endedAt ? hoursBetween(startedAt, endedAt) : null,
    finished,
    holder: lastEvent
      ? { carrierCode: lastEvent.carrierCode, location: located?.location ?? null }
      : null,
  };
}

export interface Benchmark {
  median: number;
  p80: number;
  samples: number;
}

/** Typical hours per segment and door to door, learnt from journeys that completed them. */
export interface Benchmarks {
  segments: Partial<Record<SegmentKey, Benchmark>>;
  total: Benchmark | null;
}

/** Linear-interpolated percentile (p in 0..1) of a non-empty list. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

function benchmark(values: number[]): Benchmark | null {
  return values.length
    ? { median: percentile(values, 0.5), p80: percentile(values, 0.8), samples: values.length }
    : null;
}

export function buildBenchmarks(analyses: JourneyAnalysis[]): Benchmarks {
  const segments: Partial<Record<SegmentKey, Benchmark>> = {};
  for (const { key } of SEGMENTS) {
    const hours = analyses.flatMap((a) =>
      a.segments
        .filter((s) => s.key === key && !s.ongoing && s.hours !== null)
        .map((s) => s.hours!),
    );
    const result = benchmark(hours);
    if (result) segments[key] = result;
  }
  const delivered = analyses.filter(
    (a) => a.position === "DELIVERED" && a.totalHours !== null && point(a, "DELIVERED").at,
  );
  return { segments, total: benchmark(delivered.map((a) => a.totalHours!)) };
}

function point(analysis: JourneyAnalysis, milestone: Milestone): MilestonePoint {
  return analysis.milestones[rank(milestone)]!;
}

export interface DeliveryEstimate {
  earliest: Date;
  latest: Date;
  /** The smallest number of past journeys behind any segment used. */
  samples: number;
}

/**
 * When an open parcel will probably arrive: now plus the typical time left in each remaining
 * segment (median for the earliest date, 80th percentile for the latest). Plain arithmetic on
 * past journeys, so anyone can check it. No estimate while a problem is open or when there is
 * too little history.
 */
export function estimateDelivery(
  analysis: JourneyAnalysis,
  benchmarks: Benchmarks,
  now: Date,
  minSamples = 5,
): DeliveryEstimate | null {
  if (analysis.finished || analysis.activeProblem) return null;
  let early = 0;
  let late = 0;
  let samples = Number.POSITIVE_INFINITY;
  for (const { key, to } of SEGMENTS) {
    if (point(analysis, to).reached) continue;
    const typical = benchmarks.segments[key];
    if (!typical || typical.samples < minSamples) return null;
    const timing = analysis.segments.find((s) => s.key === key)!;
    const elapsed = timing.ongoing ? timing.hours : 0;
    early += Math.max(typical.median - elapsed, 0);
    late += Math.max(typical.p80 - elapsed, 0);
    samples = Math.min(samples, typical.samples);
  }
  return {
    earliest: new Date(now.getTime() + early * HOUR_MS),
    latest: new Date(now.getTime() + Math.max(early, late) * HOUR_MS),
    samples,
  };
}

export type Severity = "critical" | "warning" | "info" | "good";

export type Insight =
  | { code: "PROBLEM"; severity: Severity; problem: ProblemEvent }
  | {
      code: "STUCK";
      severity: "critical";
      since: Date;
      carrierCode: string | null;
      afterHandoff: boolean;
    }
  | {
      code: "WAITING_FOR_LAST_MILE";
      severity: Severity;
      carrierCode: string | null;
      hours: number;
      typicalHours: number | null;
      flagAt: Date | null;
    }
  | { code: "NO_LAST_MILE_NUMBER"; severity: "warning"; carrierCode: string | null }
  | {
      code: "SLOW_SEGMENT";
      severity: "warning";
      segment: SegmentKey;
      hours: number;
      typicalHours: number;
    }
  | { code: "QUICK_HANDOFF"; severity: "good"; hours: number; typicalHours: number }
  | { code: "DELIVERED"; severity: "good" | "info"; hours: number; typicalHours: number | null }
  | { code: "ESTIMATE"; severity: "info"; estimate: DeliveryEstimate };

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "good"];
const PROBLEM_SEVERITY: Record<Problem, Severity> = {
  // A carrier's own delay notice (weather, flights, holidays): worth knowing, rarely actionable.
  DELAYED: "info",
  CUSTOMS_HOLD: "critical",
  DELIVERY_FAILED: "warning",
  ADDRESS_PROBLEM: "critical",
  AWAITING_PICKUP: "warning",
  RETURNING: "critical",
  RETURNED: "critical",
  EXCEPTION: "critical",
};

/** Without history, a handoff still waiting after a day deserves a look. */
const DEFAULT_HANDOFF_WARNING_HOURS = 24;

/**
 * What staff should know about one journey, most urgent first. Each insight is data, not text,
 * so the web app can phrase it in English or Japanese.
 */
export function journeyInsights(
  analysis: JourneyAnalysis,
  context: {
    benchmarks: Benchmarks;
    now: Date;
    /** From the stuck rules (ADR-0002): when it became stuck, or when it will if nothing arrives. */
    stuckSince: Date | null;
    stuckDeadline: Date | null;
  },
): Insight[] {
  const { benchmarks, now } = context;
  const insights: Insight[] = [];
  const handoff = analysis.handoff;
  const typical = (key: SegmentKey) => benchmarks.segments[key];

  if (analysis.activeProblem) {
    insights.push({
      code: "PROBLEM",
      severity: PROBLEM_SEVERITY[analysis.activeProblem.problem],
      problem: analysis.activeProblem,
    });
  }
  if (context.stuckSince) {
    // Stuck after a handover: the carrier to chase is the one that received the parcel.
    const afterHandoff = Boolean(handoff?.waiting);
    insights.push({
      code: "STUCK",
      severity: "critical",
      since: context.stuckSince,
      carrierCode: afterHandoff ? handoff!.toCarrier : (analysis.holder?.carrierCode ?? null),
      afterHandoff,
    });
  } else if (handoff?.waiting) {
    // Waiting means the handover is the furthest milestone, so the HANDOFF segment is running.
    const hours = handoff.gapHours!;
    const handoffTypical = typical("HANDOFF");
    insights.push({
      code: "WAITING_FOR_LAST_MILE",
      severity: hours > (handoffTypical?.p80 ?? DEFAULT_HANDOFF_WARNING_HOURS) ? "warning" : "info",
      carrierCode: handoff.toCarrier,
      hours,
      typicalHours: handoffTypical?.median ?? null,
      flagAt: context.stuckDeadline,
    });
  }
  if (handoff?.handedOverAt && !handoff.toTrackingNumber && !analysis.finished) {
    insights.push({
      code: "NO_LAST_MILE_NUMBER",
      severity: "warning",
      carrierCode: handoff.toCarrier,
    });
  }

  for (const segment of analysis.segments) {
    const usual = typical(segment.key);
    if (segment.ongoing || segment.hours === null || !usual || usual.samples < 5) continue;
    if (segment.hours > usual.p80 && segment.hours > usual.median * 1.5) {
      insights.push({
        code: "SLOW_SEGMENT",
        severity: "warning",
        segment: segment.key,
        hours: segment.hours,
        typicalHours: usual.median,
      });
    } else if (segment.key === "HANDOFF" && segment.hours <= usual.median) {
      insights.push({
        code: "QUICK_HANDOFF",
        severity: "good",
        hours: segment.hours,
        typicalHours: usual.median,
      });
    }
  }

  if (analysis.position === "DELIVERED" && analysis.totalHours !== null) {
    const usual = benchmarks.total;
    insights.push({
      code: "DELIVERED",
      severity: usual && analysis.totalHours <= usual.median ? "good" : "info",
      hours: analysis.totalHours,
      typicalHours: usual?.median ?? null,
    });
  }
  const estimate = estimateDelivery(analysis, benchmarks, now);
  if (estimate && !context.stuckSince)
    insights.push({ code: "ESTIMATE", severity: "info", estimate });

  return insights.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}
