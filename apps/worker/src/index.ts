/**
 * Polling worker. Phase 3 fills this in: for each open shipment whose carrier poll interval
 * has elapsed, fetch events through a CarrierAdapter, apply them through packages/domain,
 * and update stuckSince. For now it only proves it can reach the database.
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createPrismaClient } from "@handoff/db";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const prisma = createPrismaClient();

try {
  const open = await prisma.shipment.count({
    where: { status: { notIn: ["DELIVERED", "RETURNED"] } },
  });
  console.log(`worker: ${open} open shipments (polling not implemented yet)`);
} finally {
  await prisma.$disconnect();
}
