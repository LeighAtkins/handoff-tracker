import type { Prisma } from "@handoff/db";

/** A user email, or "system:<component>" for automated changes, e.g. "system:worker". */
export type Actor = string;

export interface AuditInput {
  entityType: "Shipment" | "Order" | "Import" | "System";
  entityId: string;
  action: string;
  actor: Actor;
  before?: unknown;
  after?: unknown;
}

type Tx = Pick<Prisma.TransactionClient, "auditEntry">;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

/** The one way anything writes to the append-only audit log. Call it inside the same transaction as the change. */
export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditEntry.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actor: input.actor,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  });
}
