import type { Insight } from "@handoff/domain";
import { formatDateTime, formatDay, formatDuration } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n";

export interface InsightText {
  title: string;
  detail: string | null;
  action: string | null;
}

export interface InsightContext {
  t: Dictionary;
  /** The current carrier's tracking number, for "call them with this number" actions. */
  trackingNumber: string;
  /** Whole days since the last event. */
  quietDays: number;
  lastMileCarrier: string | null;
}

export function carrierLabel(t: Dictionary, code: string | null | undefined): string {
  return code ? (t.carriers[code] ?? code) : t.journey.lastMileFallback;
}

/** Puts an insight into words: a headline, the facts behind it, and what to do about it. */
export function describeInsight(
  insight: Insight,
  { t, trackingNumber, quietDays, lastMileCarrier }: InsightContext,
): InsightText {
  const i = t.insights;
  const duration = (hours: number) => formatDuration(hours, t.duration);
  switch (insight.code) {
    case "STUCK": {
      const carrier = carrierLabel(t, insight.carrierCode);
      const since = formatDateTime(insight.since);
      if (insight.afterHandoff)
        return {
          title: i.stuckAfterHandoffTitle,
          detail: i.stuckAfterHandoffDetail(carrier, since),
          action: i.chaseAction(carrier, trackingNumber),
        };
      if (!insight.carrierCode)
        return {
          title: i.nothingScannedTitle,
          detail: i.nothingScannedDetail(since),
          action: i.checkLabelAction,
        };
      return {
        title: i.stuckTitle(quietDays),
        detail: i.stuckDetail(carrier, since),
        action: i.chaseAction(carrier, trackingNumber),
      };
    }
    case "WAITING_FOR_LAST_MILE": {
      const carrier = carrierLabel(t, insight.carrierCode);
      const typical = insight.typicalHours === null ? null : duration(insight.typicalHours);
      const detail = i.waitingDetail(duration(insight.hours), carrier, typical);
      return {
        title: insight.severity === "warning" ? i.waitingTitle(carrier) : i.handedTitle(carrier),
        detail: insight.flagAt ? `${detail} ${i.flagAt(formatDateTime(insight.flagAt))}` : detail,
        action: insight.severity === "warning" ? i.chaseAction(carrier, trackingNumber) : null,
      };
    }
    case "NO_LAST_MILE_NUMBER":
      return { title: i.noNumberTitle, detail: i.noNumberDetail, action: i.noNumberAction };
    case "PROBLEM": {
      const { problem } = insight;
      const carrier = carrierLabel(t, problem.carrierCode);
      return {
        title: t.stages[problem.problem],
        detail: i.problemDetail(formatDateTime(problem.at), problem.message),
        action: i.problemActions[problem.problem](carrier, trackingNumber),
      };
    }
    case "SLOW_SEGMENT":
      return {
        title: i.slowTitle(t.segments[insight.segment]),
        detail: i.slowDetail(duration(insight.hours), duration(insight.typicalHours)),
        action: null,
      };
    case "QUICK_HANDOFF":
      return {
        title: i.quickTitle,
        detail: i.quickDetail(
          carrierLabel(t, lastMileCarrier),
          duration(insight.hours),
          duration(insight.typicalHours),
        ),
        action: null,
      };
    case "DELIVERED": {
      const typical = insight.typicalHours === null ? null : duration(insight.typicalHours);
      return {
        title: i.deliveredTitle(duration(insight.hours)),
        detail:
          typical === null
            ? i.deliveredNoHistory
            : insight.severity === "good"
              ? i.deliveredFaster(typical)
              : i.deliveredUsual(typical),
        action: null,
      };
    }
    case "ESTIMATE":
      return {
        title: i.estimateTitle(
          formatDay(insight.estimate.earliest),
          formatDay(insight.estimate.latest),
        ),
        detail: i.estimateDetail(insight.estimate.samples),
        action: null,
      };
  }
}
