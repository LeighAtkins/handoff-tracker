import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { revealCustomer } from "../src";
import { createShipment, prisma, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("revealCustomer", () => {
  it("returns the details and records who looked", async () => {
    const shipmentId = await createShipment();
    const { orderId } = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(await revealCustomer(prisma, { orderId }, "viewer@example.com")).toEqual({
      customerName: "Test Customer",
      destinationPostcode: "100-0001",
    });
    const entry = await prisma.auditEntry.findFirstOrThrow({ where: { entityId: orderId } });
    expect(entry).toMatchObject({
      entityType: "Order",
      action: "CUSTOMER_REVEALED",
      actor: "viewer@example.com",
    });
    // The audit log records that someone looked, never the details themselves.
    expect(JSON.stringify(entry.after)).not.toContain("Test Customer");
  });

  it("rejects unknown orders", async () => {
    await expect(revealCustomer(prisma, { orderId: "nope" }, "x")).rejects.toThrow(
      "Order not found",
    );
  });
});
