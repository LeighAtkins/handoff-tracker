import { DomainError } from "@handoff/domain";
import type { PrismaClient } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

export const DOCUMENT_TYPES = ["slip", "label"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Documents context: reads an Order and its Shipment to print a packing slip or parcel label.
 * It never writes to Orders or Tracking. Printing shows the customer's name, so it is audited
 * the same way as a reveal.
 */
export async function loadDocument(
  prisma: PrismaClient,
  input: { shipmentId: string; type: DocumentType },
  actor: Actor,
) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: { order: true, legs: { orderBy: { sequence: "asc" }, include: { carrier: true } } },
  });
  if (!shipment) throw new DomainError("Shipment not found");
  await writeAudit(prisma, {
    entityType: "Order",
    entityId: shipment.orderId,
    action: "DOCUMENT_PRINTED",
    actor,
    after: { document: input.type, shipmentId: shipment.id },
  });
  const current = shipment.legs.at(-1)!;
  return {
    orderNumber: shipment.order.sourceOrderNumber,
    sourceSystem: shipment.order.sourceSystem,
    customerName: shipment.order.customerName,
    destination: {
      country: shipment.order.destinationCountry,
      postcode: shipment.order.destinationPostcode,
    },
    legs: shipment.legs.map((leg) => ({
      sequence: leg.sequence,
      carrier: leg.carrier.name,
      carrierCode: leg.carrierCode,
      trackingNumber: leg.trackingNumber,
    })),
    current: { carrier: current.carrier.name, trackingNumber: current.trackingNumber },
  };
}
