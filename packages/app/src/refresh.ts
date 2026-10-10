import { refreshShipment, type Prisma } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

type Tx = Pick<Prisma.TransactionClient, "shipment" | "auditEntry">;

/**
 * Recomputes a Shipment's derived columns and records stuck transitions in the audit log.
 * BECAME_STUCK / NO_LONGER_STUCK are what the trial metrics count, since stuckSince itself only
 * holds the current state.
 */
export async function refresh(tx: Tx, shipmentId: string, now: Date, actor: Actor) {
  const refreshed = await refreshShipment(tx, shipmentId, now);
  const { before, after } = refreshed;
  if (!before.stuckSince && after.stuckSince) {
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: shipmentId,
      action: "BECAME_STUCK",
      actor,
      after: { stuckSince: after.stuckSince, status: after.status },
    });
  } else if (before.stuckSince && !after.stuckSince) {
    await writeAudit(tx, {
      entityType: "Shipment",
      entityId: shipmentId,
      action: "NO_LONGER_STUCK",
      actor,
      before: { stuckSince: before.stuckSince },
      after: { status: after.status },
    });
  }
  return refreshed;
}
