import { createPrismaClient, refreshShipment, type PrismaClient } from "@handoff/db";
import type { Status } from "@handoff/domain";
import { testDatabaseUrl } from "./db-url";

export const prisma: PrismaClient = createPrismaClient(testDatabaseUrl());

export const DAY = 24 * 60 * 60 * 1000;
export const t0 = new Date("2026-10-01T00:00:00Z");
export const day = (n: number) => new Date(t0.getTime() + n * DAY);

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditEntry", "TrackingEvent", "Handoff", "Leg", "Shipment", "Order", "Carrier", "User", "ImportBatch" CASCADE',
  );
  await prisma.carrier.createMany({
    data: [
      { code: "4PX", name: "4PX Express", adapter: "fake" },
      { code: "SAGAWA", name: "Sagawa Express", adapter: "fake" },
    ],
  });
}

/** A 4PX shipment with the given events on Leg 1, already refreshed. */
export async function createShipment(
  events: { at: Date; status: Status | null; message?: string }[] = [],
) {
  const order = await prisma.order.create({
    data: {
      sourceSystem: "test",
      sourceOrderNumber: `T-${Math.random().toString(36).slice(2, 8)}`,
      customerName: "Test Customer",
      destinationCountry: "JP",
      destinationPostcode: "100-0001",
      createdAt: t0,
    },
  });
  const shipment = await prisma.shipment.create({
    data: {
      orderId: order.id,
      createdAt: t0,
      legs: {
        create: {
          sequence: 1,
          carrierCode: "4PX",
          trackingNumber: `4PX${Math.random().toString().slice(2, 10)}CN`,
          startedAt: t0,
          events: {
            create: events.map((e) => ({
              occurredAt: e.at,
              rawStatus: e.status ?? "?",
              rawMessage: e.message ?? String(e.status),
              normalisedStatus: e.status,
              source: "FAKE" as const,
            })),
          },
        },
      },
    },
  });
  const latest = Math.max(t0.getTime(), ...events.map((e) => e.at.getTime()));
  await refreshShipment(prisma, shipment.id, new Date(latest));
  return shipment.id;
}

export async function auditFor(shipmentId: string) {
  return prisma.auditEntry.findMany({ where: { entityId: shipmentId }, orderBy: { at: "asc" } });
}
