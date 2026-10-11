import {
  analyseJourney,
  buildBenchmarks,
  percentile,
  SEGMENTS,
  type Benchmarks,
  type Insight,
  type Milestone,
  type Problem,
  type SegmentKey,
  type Severity,
  type Status,
} from "@handoff/domain";
import { shipmentAggregateInclude, toShipmentState, type PrismaClient } from "@handoff/db";
import { journeyInputFromShipment, viewJourney, type JourneyView } from "./journey";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Where open parcels are now, in the words staff use. */
export const PIPELINE = [
  "IN_CHINA",
  "IN_THE_AIR",
  "IN_CUSTOMS",
  "AWAITING_LAST_MILE",
  "WITH_LAST_MILE",
  "OUT_FOR_DELIVERY",
] as const;
export type PipelineStage = (typeof PIPELINE)[number];

const PIPELINE_OF: Record<Milestone, PipelineStage> = {
  LABEL_CREATED: "IN_CHINA",
  PICKED_UP: "IN_CHINA",
  DEPARTED_ORIGIN: "IN_THE_AIR",
  ARRIVED_DESTINATION: "IN_CUSTOMS",
  CUSTOMS_CLEARED: "IN_CUSTOMS",
  HANDED_OFF: "AWAITING_LAST_MILE",
  LAST_MILE_ACCEPTED: "WITH_LAST_MILE",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "OUT_FOR_DELIVERY",
};

/** Hours from handover to the last-mile carrier's first scan. */
export const HANDOFF_BUCKETS = [
  { label: "≤6h", max: 6 },
  { label: "6–12h", max: 12 },
  { label: "12–24h", max: 24 },
  { label: "1–2d", max: 48 },
  { label: "2–3d", max: 72 },
  { label: ">3d", max: Number.POSITIVE_INFINITY },
] as const;

export interface AttentionItem {
  shipmentId: string;
  orderNumber: string;
  status: Status;
  carrierCode: string;
  trackingNumber: string;
  insight: Insight;
  lastEventAt: Date | null;
}

export interface Overview {
  now: Date;
  periodDays: number;
  targetDays: number;
  benchmarks: Benchmarks;
  open: number;
  stuck: number;
  stuckAfterHandoff: number;
  waitingAtHandoff: number;
  openProblems: { problem: Problem; count: number }[];
  pipeline: { stage: PipelineStage; count: number; withProblem: number }[];
  delivered: {
    count: number;
    medianDays: number | null;
    p80Days: number | null;
    withinTarget: number | null;
  };
  handoff: {
    samples: number;
    medianHours: number | null;
    p80Hours: number | null;
    within24h: number | null;
    buckets: { label: string; count: number }[];
  };
  segments: { key: SegmentKey; medianHours: number; p80Hours: number; samples: number }[];
  weekly: { from: Date; to: Date; delivered: number; medianDays: number | null }[];
  attention: AttentionItem[];
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
/** Insights someone can act on today. A slow segment that is already over is not one of them. */
const ACTIONABLE: ReadonlySet<Insight["code"]> = new Set([
  "STUCK",
  "PROBLEM",
  "WAITING_FOR_LAST_MILE",
  "NO_LAST_MILE_NUMBER",
]);

/**
 * The manager's view: what is open and where, where the time goes, how the 4PX → last-mile
 * handoff performs, and which parcels need someone today. Computed from tracked Shipments with
 * the same journey analysis the shipment pages use, so every number can be traced to parcels.
 */
export async function overview(
  prisma: PrismaClient,
  options: { now?: Date; periodDays?: number; targetDays?: number; weeks?: number } = {},
): Promise<Overview> {
  const now = options.now ?? new Date();
  const periodDays = options.periodDays ?? 30;
  const targetDays = options.targetDays ?? 7;
  const weeks = options.weeks ?? 8;
  const rows = await prisma.shipment.findMany({
    include: { ...shipmentAggregateInclude, order: true },
  });

  const inputs = rows.map((row) => ({ row, input: journeyInputFromShipment(row) }));
  const benchmarks = buildBenchmarks(inputs.map(({ input }) => analyseJourney(input, now)));
  const views = inputs.map(({ row, input }) => ({
    row,
    view: viewJourney(input, toShipmentState(row), { benchmarks, now }),
  }));
  const open = views.filter(({ view }) => !view.analysis.finished);

  const pipeline = PIPELINE.map((stage) => {
    const here = open.filter(
      ({ view }) => PIPELINE_OF[view.analysis.position ?? "LABEL_CREATED"] === stage,
    );
    return {
      stage,
      count: here.length,
      withProblem: here.filter(({ view }) => view.analysis.activeProblem).length,
    };
  });

  const problemCounts = new Map<Problem, number>();
  for (const { view } of open) {
    const problem = view.analysis.activeProblem?.problem;
    if (problem) problemCounts.set(problem, (problemCounts.get(problem) ?? 0) + 1);
  }

  const deliveredAt = (view: JourneyView) =>
    view.analysis.milestones.find((m) => m.milestone === "DELIVERED")?.at ?? null;
  const periodStart = now.getTime() - periodDays * DAY_MS;
  const deliveredDays = views
    .filter(({ view }) => (deliveredAt(view)?.getTime() ?? 0) >= periodStart)
    .map(({ view }) => view.analysis.totalHours! / 24);

  const gaps = views.flatMap(({ view }) => {
    const handoff = view.analysis.segments.find((s) => s.key === "HANDOFF")!;
    return !handoff.ongoing && handoff.hours !== null ? [handoff.hours] : [];
  });

  const weekly = Array.from({ length: weeks }, (_, i) => {
    const to = new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY_MS);
    const from = new Date(to.getTime() - 7 * DAY_MS);
    const days = views
      .filter(({ view }) => {
        const at = deliveredAt(view);
        return at !== null && at > from && at <= to;
      })
      .map(({ view }) => view.analysis.totalHours! / 24);
    return {
      from,
      to,
      delivered: days.length,
      medianDays: days.length ? round1(percentile(days, 0.5)) : null,
    };
  });

  const attention = open
    .flatMap(({ row, view }) => {
      const urgent = view.insights.find(
        (i) => ACTIONABLE.has(i.code) && (i.severity === "critical" || i.severity === "warning"),
      );
      const leg = row.legs.at(-1)!;
      return urgent
        ? [
            {
              shipmentId: row.id,
              orderNumber: row.order.sourceOrderNumber,
              status: row.status,
              carrierCode: leg.carrierCode,
              trackingNumber: leg.trackingNumber,
              insight: urgent,
              lastEventAt: view.analysis.lastEventAt,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.insight.severity] - SEVERITY_RANK[b.insight.severity] ||
        (a.lastEventAt?.getTime() ?? 0) - (b.lastEventAt?.getTime() ?? 0),
    );

  return {
    now,
    periodDays,
    targetDays,
    benchmarks,
    open: open.length,
    stuck: open.filter(({ view }) => view.stuckSince).length,
    stuckAfterHandoff: open.filter(({ view }) => view.stuckSince && view.analysis.handoff?.waiting)
      .length,
    waitingAtHandoff: open.filter(({ view }) => view.analysis.handoff?.waiting).length,
    openProblems: [...problemCounts]
      .map(([problem, count]) => ({ problem, count }))
      .sort((a, b) => b.count - a.count),
    pipeline,
    delivered: {
      count: deliveredDays.length,
      medianDays: deliveredDays.length ? round1(percentile(deliveredDays, 0.5)) : null,
      p80Days: deliveredDays.length ? round1(percentile(deliveredDays, 0.8)) : null,
      withinTarget: deliveredDays.length
        ? deliveredDays.filter((d) => d <= targetDays).length / deliveredDays.length
        : null,
    },
    handoff: {
      samples: gaps.length,
      medianHours: gaps.length ? round1(percentile(gaps, 0.5)) : null,
      p80Hours: gaps.length ? round1(percentile(gaps, 0.8)) : null,
      within24h: gaps.length ? gaps.filter((g) => g <= 24).length / gaps.length : null,
      buckets: HANDOFF_BUCKETS.map((bucket, i) => {
        const min = i === 0 ? Number.NEGATIVE_INFINITY : HANDOFF_BUCKETS[i - 1]!.max;
        return {
          label: bucket.label,
          count: gaps.filter((g) => g > min && g <= bucket.max).length,
        };
      }),
    },
    segments: SEGMENTS.flatMap(({ key }) => {
      const b = benchmarks.segments[key];
      return b
        ? [{ key, medianHours: round1(b.median), p80Hours: round1(b.p80), samples: b.samples }]
        : [];
    }),
    weekly,
    attention,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
