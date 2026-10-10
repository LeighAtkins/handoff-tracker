import {
  normalise,
  RateLimitedError,
  type CarrierAdapter,
  type DetectedHandoff,
  type RawTrackingEvent,
} from "@handoff/carriers";
import type { PrismaClient } from "@handoff/db";
import { refresh } from "./refresh";
import { writeAudit } from "./audit";
import { recordHandoffInTx } from "./shipments";

export const WORKER_ACTOR = "system:worker";

const OPEN = { notIn: ["DELIVERED", "RETURNED"] as ("DELIVERED" | "RETURNED")[] };
const DEFAULT_PAUSE_MS = 15 * 60 * 1000;

/**
 * Stores what a carrier told us about one Leg. Duplicate events are skipped by the
 * (legId, occurredAt, rawMessage) constraint, so polling the same history twice changes nothing.
 * If the carrier names the next carrier's tracking number, Leg n+1 and a Handoff are created.
 */
export async function ingestLegEvents(
  prisma: PrismaClient,
  input: { legId: string; events: RawTrackingEvent[]; handoff?: DetectedHandoff | null },
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const leg = await tx.leg.findUniqueOrThrow({
      where: { id: input.legId },
      include: { carrier: true },
    });
    const { count: newEvents } = await tx.trackingEvent.createMany({
      data: input.events.map((event) => ({
        legId: leg.id,
        occurredAt: event.occurredAt,
        rawStatus: event.rawStatus.slice(0, 200),
        rawMessage: event.rawMessage.slice(0, 1000),
        location: event.location?.slice(0, 200) ?? null,
        normalisedStatus: normalise(leg.carrierCode, event),
        source:
          leg.carrier.adapter === "fake"
            ? "FAKE"
            : leg.carrier.adapter === "manual"
              ? "MANUAL"
              : "AGGREGATOR",
      })),
      skipDuplicates: true,
    });
    await tx.leg.update({
      where: { id: leg.id },
      data: { lastCheckedAt: now, lastCheckError: null },
    });

    let handedOff = false;
    if (input.handoff && !leg.endedAt) {
      const { nextCarrierCode, nextTrackingNumber } = input.handoff;
      const alreadyLeg = await tx.leg.findFirst({
        where: {
          shipmentId: leg.shipmentId,
          carrierCode: nextCarrierCode,
          trackingNumber: nextTrackingNumber,
        },
      });
      if (!alreadyLeg) {
        // A carrier we have not seen before is polled through the same adapter that reported it.
        await tx.carrier.upsert({
          where: { code: nextCarrierCode },
          create: { code: nextCarrierCode, name: nextCarrierCode, adapter: leg.carrier.adapter },
          update: {},
        });
        const latest = input.events.reduce<Date | null>(
          (max, e) => (!max || e.occurredAt > max ? e.occurredAt : max),
          null,
        );
        const at = latest && latest > leg.startedAt ? latest : now;
        await recordHandoffInTx(
          tx,
          {
            shipmentId: leg.shipmentId,
            carrierCode: nextCarrierCode,
            trackingNumber: nextTrackingNumber,
            at,
            source: "CARRIER_EVENT",
          },
          WORKER_ACTOR,
          now,
        );
        handedOff = true;
      }
    }

    const refreshed = await refresh(tx, leg.shipmentId, now, WORKER_ACTOR);
    if (newEvents > 0) {
      await writeAudit(tx, {
        entityType: "Shipment",
        entityId: leg.shipmentId,
        action: "EVENTS_INGESTED",
        actor: WORKER_ACTOR,
        after: {
          leg: `${leg.sequence} ${leg.carrierCode}`,
          newEvents,
          statusChange:
            refreshed.before.status === refreshed.after.status
              ? undefined
              : { from: refreshed.before.status, to: refreshed.after.status },
        },
      });
    }
    return { newEvents, handedOff };
  });
}

export interface PollReport {
  checked: number;
  newEvents: number;
  handoffs: number;
  failures: { legId: string; carrierCode: string; error: string }[];
  pausedCarriers: string[];
}

/**
 * One polling pass: every open Leg whose carrier poll interval has elapsed is checked once.
 * A 429 pauses that carrier (Carrier.pausedUntil) so free tiers are never hammered.
 */
export async function pollDueLegs(
  prisma: PrismaClient,
  options: {
    adapterFor: (carrier: { code: string; adapter: string }) => CarrierAdapter;
    now?: Date;
    limit?: number;
  },
): Promise<PollReport> {
  const now = options.now ?? new Date();
  const report: PollReport = {
    checked: 0,
    newEvents: 0,
    handoffs: 0,
    failures: [],
    pausedCarriers: [],
  };

  const legs = await prisma.leg.findMany({
    where: {
      endedAt: null,
      shipment: { status: OPEN },
      carrier: {
        enabled: true,
        adapter: { not: "manual" },
        OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
      },
    },
    include: { carrier: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
  });
  const due = legs
    .filter(
      (leg) =>
        !leg.lastCheckedAt ||
        now.getTime() - leg.lastCheckedAt.getTime() >= leg.carrier.pollIntervalMinutes * 60_000,
    )
    .slice(0, options.limit ?? 500);

  const adapters = new Map<string, CarrierAdapter>();
  for (const leg of due) {
    if (report.pausedCarriers.includes(leg.carrierCode)) continue;
    const adapter = adapters.get(leg.carrierCode) ?? options.adapterFor(leg.carrier);
    adapters.set(leg.carrierCode, adapter);
    report.checked++;
    try {
      const events = await adapter.fetchEvents(leg.trackingNumber);
      const result = await ingestLegEvents(
        prisma,
        { legId: leg.id, events, handoff: adapter.detectHandoff?.(events) },
        now,
      );
      report.newEvents += result.newEvents;
      if (result.handedOff) report.handoffs++;
    } catch (error) {
      if (error instanceof RateLimitedError) {
        const pausedUntil = new Date(
          now.getTime() +
            (error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : DEFAULT_PAUSE_MS),
        );
        await prisma.carrier.update({ where: { code: leg.carrierCode }, data: { pausedUntil } });
        report.pausedCarriers.push(leg.carrierCode);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      await prisma.leg.update({
        where: { id: leg.id },
        data: { lastCheckedAt: now, lastCheckError: message.slice(0, 500) },
      });
      report.failures.push({ legId: leg.id, carrierCode: leg.carrierCode, error: message });
    }
  }
  return report;
}

/** Time passing alone can make a Shipment stuck, so every open Shipment is re-evaluated each run. */
export async function refreshOpenShipments(prisma: PrismaClient, now = new Date()) {
  const open = await prisma.shipment.findMany({ where: { status: OPEN }, select: { id: true } });
  let changed = 0;
  for (const { id } of open) {
    if ((await refresh(prisma, id, now, WORKER_ACTOR)).changed) changed++;
  }
  return { open: open.length, changed };
}
