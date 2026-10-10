import { DomainError } from "@handoff/domain";
import type { PrismaClient } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

/** Shows a customer's details to one person, and records that they looked. */
export async function revealCustomer(
  prisma: PrismaClient,
  input: { orderId: string; reason?: string },
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new DomainError("Order not found");
    await writeAudit(tx, {
      entityType: "Order",
      entityId: order.id,
      action: "CUSTOMER_REVEALED",
      actor,
      after: {
        fields: ["customerName", "destinationPostcode"],
        reason: input.reason?.trim() || undefined,
      },
    });
    return { customerName: order.customerName, destinationPostcode: order.destinationPostcode };
  });
}
