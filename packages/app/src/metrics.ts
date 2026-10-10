import type { PrismaClient } from "@handoff/db";
import { writeAudit } from "./audit";
import type { PollReport } from "./tracking";

/** One audit entry per worker run, so "carrier lookups automated" can be counted later. */
export async function recordWorkerRun(prisma: PrismaClient, report: PollReport, refreshed: number) {
  await writeAudit(prisma, {
    entityType: "System",
    entityId: "worker",
    action: "WORKER_RUN",
    actor: "system:worker",
    after: {
      checked: report.checked,
      newEvents: report.newEvents,
      handoffs: report.handoffs,
      failures: report.failures.length,
      pausedCarriers: report.pausedCarriers,
      refreshed,
    },
  });
}

export interface MetricsAssumptions {
  /** Minutes for a person to check one parcel by hand: open 4PX, find the Sagawa number, open Sagawa. */
  manualCheckMinutes: number;
  /** Minutes to check the same parcel in this app. */
  appCheckMinutes: number;
}

export const DEFAULT_ASSUMPTIONS: MetricsAssumptions = {
  manualCheckMinutes: 4,
  appCheckMinutes: 0.5,
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** The numbers for the internal trial write-up, over [since, now]. */
export async function trialMetrics(
  prisma: PrismaClient,
  {
    since,
    now = new Date(),
    assumptions = DEFAULT_ASSUMPTIONS,
  }: { since: Date; now?: Date; assumptions?: MetricsAssumptions },
) {
  const inPeriod = { gte: since, lte: now };
  const [shipmentsTracked, openNow, newShipments, eventsBySource, carrierHandoffs, audit] =
    await Promise.all([
      prisma.shipment.count({
        where: {
          createdAt: { lte: now },
          OR: [{ status: { notIn: ["DELIVERED", "RETURNED"] } }, { lastEventAt: { gte: since } }],
        },
      }),
      prisma.shipment.count({ where: { status: { notIn: ["DELIVERED", "RETURNED"] } } }),
      prisma.shipment.count({ where: { createdAt: inPeriod } }),
      prisma.trackingEvent.groupBy({
        by: ["source"],
        where: { ingestedAt: inPeriod },
        _count: true,
      }),
      prisma.handoff.count({ where: { detectedAt: inPeriod, source: "CARRIER_EVENT" } }),
      prisma.auditEntry.findMany({
        where: { at: inPeriod },
        select: { action: true, actor: true, entityId: true, at: true, after: true },
        orderBy: { at: "asc" },
      }),
    ]);

  const carrierChecks = audit
    .filter((e) => e.action === "WORKER_RUN")
    .reduce((sum, e) => sum + Number((e.after as { checked?: number } | null)?.checked ?? 0), 0);

  const becameStuck = audit.filter((e) => e.action === "BECAME_STUCK");
  const resolvedByStaff = new Set(
    audit.filter((e) => e.action === "STUCK_RESOLVED").map((e) => e.entityId),
  );
  // Pair each NO_LONGER_STUCK with the BECAME_STUCK before it, to time how long parcels sat stuck.
  const stuckAt = new Map<string, Date>();
  const hoursStuck: number[] = [];
  let clearedOnTheirOwn = 0;
  for (const entry of audit) {
    if (entry.action === "BECAME_STUCK") stuckAt.set(entry.entityId, entry.at);
    if (entry.action === "NO_LONGER_STUCK") {
      const start = stuckAt.get(entry.entityId);
      if (start) hoursStuck.push((entry.at.getTime() - start.getTime()) / 3_600_000);
      stuckAt.delete(entry.entityId);
      if (!resolvedByStaff.has(entry.entityId)) clearedOnTheirOwn++;
    }
  }

  const people = audit.filter((e) => !e.actor.startsWith("system:"));
  const stuckSurfaced = new Set(becameStuck.map((e) => e.entityId)).size;
  const median_ = median(hoursStuck);

  return {
    period: { since, now },
    shipmentsTracked,
    openNow,
    newShipments,
    eventsIngested: Object.fromEntries(eventsBySource.map((g) => [g.source, g._count])) as Record<
      string,
      number
    >,
    carrierChecks,
    carrierHandoffs,
    stuckSurfaced,
    stuckResolvedByStaff: resolvedByStaff.size,
    stuckClearedOnTheirOwn: clearedOnTheirOwn,
    medianHoursStuck: median_ === null ? null : Math.round(median_ * 10) / 10,
    activeUsers: new Set(people.filter((e) => e.action === "SIGNED_IN").map((e) => e.actor)).size,
    staffActions: people.filter((e) => e.action !== "SIGNED_IN").length,
    estimate: {
      assumptions,
      minutesSaved: Math.round(
        stuckSurfaced * (assumptions.manualCheckMinutes - assumptions.appCheckMinutes),
      ),
    },
  };
}
