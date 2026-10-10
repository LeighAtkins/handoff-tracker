import {
  applyEvent,
  applyOverride,
  clearOverride as clearOverrideRule,
  DomainError,
  markResolved as markResolvedRule,
  recordHandoff as recordHandoffRule,
  type Status,
} from "@handoff/domain";
import { loadShipment, refreshShipment, type PrismaClient, type Prisma } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

type Tx = Prisma.TransactionClient;

async function mustLoad(tx: Tx, shipmentId: string) {
  const loaded = await loadShipment(tx, shipmentId);
  if (!loaded) throw new DomainError("Shipment not found");
  return loaded;
}

function statusChange(refreshed: Awaited<ReturnType<typeof refreshShipment>>) {
  return refreshed.before.status === refreshed.after.status
    ? undefined
    : { from: refreshed.before.status, to: refreshed.after.status };
}

export interface ManualEventInput {
  shipmentId: string;
  legSequence: number;
  occurredAt: Date;
  message: string;
  location: string | null;
  /** What the operator says this means. Null records the event without changing status. */
  status: Status | null;
}

/** An operator checked a carrier themselves (e.g. no API, or phoned them) and records what they saw. */
export async function addManualEvent(
  prisma: PrismaClient,
  input: ManualEventInput,
  actor: Actor,
  now = new Date(),
) {
  const message = input.message.trim();
  if (!message) throw new DomainError("Describe what the carrier said");
  if (input.occurredAt > now) throw new DomainError("A tracking event cannot be in the future");

  return prisma.$transaction(async (tx) => {
    const { row, state } = await mustLoad(tx, input.shipmentId);
    const event = {
      legSequence: input.legSequence,
      occurredAt: input.occurredAt,
      rawMessage: message,
      normalisedStatus: input.status,
    };
    if (applyEvent(state, event) === state) throw new DomainError("That event is already recorded");

    const leg = row.legs.find((l) => l.sequence === input.legSequence)!;
    await tx.trackingEvent.create({
      data: {
        legId: leg.id,
        occurredAt: input.occurredAt,
        rawStatus: "MANUAL",
        rawMessage: message,
        location: input.location?.trim() || null,
        normalisedStatus: input.status,
        source: "MANUAL",
      },
    });
    const refreshed = await refreshShipment(tx, input.shipmentId, now);
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: input.shipmentId,
      action: "MANUAL_EVENT_ADDED",
      actor,
      after: {
        leg: `${leg.sequence} ${leg.carrierCode}`,
        occurredAt: input.occurredAt,
        message,
        status: input.status,
        statusChange: statusChange(refreshed),
      },
    });
    return refreshed.after;
  });
}

export async function addNote(
  prisma: PrismaClient,
  input: { shipmentId: string; text: string },
  actor: Actor,
) {
  const text = input.text.trim();
  if (!text) throw new DomainError("A note cannot be empty");
  if (text.length > 2000) throw new DomainError("Keep notes under 2000 characters");
  return prisma.$transaction(async (tx) => {
    await mustLoad(tx, input.shipmentId);
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: input.shipmentId,
      action: "NOTE_ADDED",
      actor,
      after: { text },
    });
  });
}

export async function overrideStatus(
  prisma: PrismaClient,
  input: { shipmentId: string; status: Status; reason: string },
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const { row, state } = await mustLoad(tx, input.shipmentId);
    const next = applyOverride(state, {
      status: input.status,
      reason: input.reason,
      by: actor,
      at: now,
    });
    await tx.shipment.update({
      where: { id: input.shipmentId },
      data: {
        overrideStatus: next.override!.status,
        overrideReason: next.override!.reason,
        overrideBy: actor,
        overrideAt: now,
      },
    });
    const refreshed = await refreshShipment(tx, input.shipmentId, now);
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: input.shipmentId,
      action: "STATUS_OVERRIDDEN",
      actor,
      before: { status: row.status, override: state.override },
      after: { status: refreshed.after.status, reason: next.override!.reason },
    });
    return refreshed.after;
  });
}

export async function clearOverride(
  prisma: PrismaClient,
  input: { shipmentId: string },
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const { state } = await mustLoad(tx, input.shipmentId);
    clearOverrideRule(state);
    await tx.shipment.update({
      where: { id: input.shipmentId },
      data: { overrideStatus: null, overrideReason: null, overrideBy: null, overrideAt: null },
    });
    const refreshed = await refreshShipment(tx, input.shipmentId, now);
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: input.shipmentId,
      action: "OVERRIDE_CLEARED",
      actor,
      before: { status: refreshed.before.status, override: state.override },
      after: { status: refreshed.after.status },
    });
    return refreshed.after;
  });
}

/** An operator has dealt with a stuck Shipment, e.g. chased the carrier. */
export async function markResolved(
  prisma: PrismaClient,
  input: { shipmentId: string },
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const { row, state } = await mustLoad(tx, input.shipmentId);
    markResolvedRule(state, now);
    await tx.shipment.update({ where: { id: input.shipmentId }, data: { stuckResolvedAt: now } });
    const refreshed = await refreshShipment(tx, input.shipmentId, now);
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: input.shipmentId,
      action: "STUCK_RESOLVED",
      actor,
      before: { stuckSince: row.stuckSince },
      after: { stuckSince: refreshed.after.stuckSince },
    });
    return refreshed.after;
  });
}

export interface HandoffInput {
  shipmentId: string;
  carrierCode: string;
  trackingNumber: string;
  at: Date;
  source: "CARRIER_EVENT" | "MANUAL" | "IMPORT";
}

/** Opens Leg n+1 with the next carrier's tracking number and records the Handoff. */
export async function recordHandoff(
  prisma: PrismaClient,
  input: HandoffInput,
  actor: Actor,
  now = new Date(),
) {
  return prisma.$transaction((tx) => recordHandoffInTx(tx, input, actor, now));
}

export async function recordHandoffInTx(tx: Tx, input: HandoffInput, actor: Actor, now: Date) {
  if (input.at > now) throw new DomainError("A Handoff cannot be in the future");
  const carrier = await tx.carrier.findUnique({ where: { code: input.carrierCode } });
  if (!carrier) throw new DomainError(`Unknown carrier ${input.carrierCode}`);

  const { row, state } = await mustLoad(tx, input.shipmentId);
  const next = recordHandoffRule(state, input);
  const fromLeg = row.legs.at(-1)!;
  const toState = next.legs.at(-1)!;

  await tx.leg.update({ where: { id: fromLeg.id }, data: { endedAt: input.at } });
  const toLeg = await tx.leg.create({
    data: {
      shipmentId: input.shipmentId,
      sequence: toState.sequence,
      carrierCode: toState.carrierCode,
      trackingNumber: toState.trackingNumber,
      startedAt: toState.startedAt,
    },
  });
  await tx.handoff.create({
    data: {
      shipmentId: input.shipmentId,
      fromLegId: fromLeg.id,
      toLegId: toLeg.id,
      detectedAt: input.at,
      source: input.source,
    },
  });
  const refreshed = await refreshShipment(tx, input.shipmentId, now);
  await writeAudit(tx, {
    entityType: "Shipment",
    entityId: input.shipmentId,
    action: "HANDOFF_RECORDED",
    actor,
    after: {
      from: `${fromLeg.carrierCode} ${fromLeg.trackingNumber}`,
      to: `${toLeg.carrierCode} ${toLeg.trackingNumber}`,
      at: input.at,
      source: input.source,
      statusChange: statusChange(refreshed),
    },
  });
  return refreshed.after;
}
