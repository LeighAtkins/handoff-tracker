import {
  currentStatus,
  DEFAULT_STUCK_RULES,
  lastEventAt,
  stuckSince,
  type ShipmentState,
  type StuckRules,
} from "@handoff/domain";
import type { Prisma } from "../generated/prisma/client";

/** Everything needed to rebuild the Shipment aggregate. */
export const shipmentAggregateInclude = {
  legs: {
    orderBy: { sequence: "asc" },
    include: { events: { orderBy: { occurredAt: "asc" } }, carrier: true },
  },
  handoffs: { include: { fromLeg: true, toLeg: true } },
} satisfies Prisma.ShipmentInclude;

export type ShipmentAggregateRow = Prisma.ShipmentGetPayload<{
  include: typeof shipmentAggregateInclude;
}>;

/** Maps stored rows to the domain's plain-data Shipment. */
export function toShipmentState(row: ShipmentAggregateRow): ShipmentState {
  return {
    createdAt: row.createdAt,
    legs: row.legs.map((leg) => ({
      sequence: leg.sequence,
      carrierCode: leg.carrierCode,
      trackingNumber: leg.trackingNumber,
      startedAt: leg.startedAt,
      endedAt: leg.endedAt,
    })),
    handoffs: row.handoffs.map((h) => ({
      fromSequence: h.fromLeg.sequence,
      toSequence: h.toLeg.sequence,
      detectedAt: h.detectedAt,
      source: h.source,
    })),
    events: row.legs.flatMap((leg) =>
      leg.events.map((e) => ({
        legSequence: leg.sequence,
        occurredAt: e.occurredAt,
        rawMessage: e.rawMessage,
        normalisedStatus: e.normalisedStatus,
      })),
    ),
    override:
      row.overrideStatus && row.overrideReason && row.overrideBy && row.overrideAt
        ? {
            status: row.overrideStatus,
            reason: row.overrideReason,
            by: row.overrideBy,
            at: row.overrideAt,
          }
        : null,
    stuckResolvedAt: row.stuckResolvedAt,
  };
}

/** The denormalised columns kept on Shipment so lists can filter in SQL. Always computed by the domain. */
export function derivedColumns(
  state: ShipmentState,
  now: Date,
  rules: StuckRules = DEFAULT_STUCK_RULES,
) {
  return {
    status: currentStatus(state),
    lastEventAt: lastEventAt(state),
    stuckSince: stuckSince(state, now, rules),
  };
}

type Tx = Pick<Prisma.TransactionClient, "shipment">;

export async function loadShipment(tx: Tx, id: string) {
  const row = await tx.shipment.findUnique({ where: { id }, include: shipmentAggregateInclude });
  return row ? { row, state: toShipmentState(row) } : null;
}

/** Recomputes status, lastEventAt and stuckSince from the stored aggregate. Returns before/after. */
export async function refreshShipment(
  tx: Tx,
  id: string,
  now: Date,
  rules: StuckRules = DEFAULT_STUCK_RULES,
) {
  const loaded = await loadShipment(tx, id);
  if (!loaded) throw new Error(`Shipment ${id} not found`);
  const before = {
    status: loaded.row.status,
    lastEventAt: loaded.row.lastEventAt,
    stuckSince: loaded.row.stuckSince,
  };
  const after = derivedColumns(loaded.state, now, rules);
  const changed =
    before.status !== after.status ||
    before.lastEventAt?.getTime() !== after.lastEventAt?.getTime() ||
    before.stuckSince?.getTime() !== after.stuckSince?.getTime();
  if (changed) await tx.shipment.update({ where: { id }, data: after });
  return { before, after, changed, state: loaded.state };
}
