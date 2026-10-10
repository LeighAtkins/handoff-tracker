import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { refreshShipment } from "@handoff/db";
import { DomainError } from "@handoff/domain";
import {
  addManualEvent,
  addNote,
  clearOverride,
  markResolved,
  overrideStatus,
  recordHandoff,
} from "../src";
import { auditFor, createShipment, day, prisma, resetDatabase } from "./helpers";

const actor = "operator@example.com";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("addManualEvent", () => {
  it("records a MANUAL event, updates status and audits it", async () => {
    const id = await createShipment([{ at: day(0), status: "SHIPPED" }]);
    const after = await addManualEvent(
      prisma,
      {
        shipmentId: id,
        legSequence: 1,
        occurredAt: day(1),
        message: " Phoned 4PX: left Shenzhen ",
        location: "Shenzhen",
        status: "IN_TRANSIT",
      },
      actor,
      day(2),
    );
    expect(after.status).toBe("IN_TRANSIT");

    const event = await prisma.trackingEvent.findFirstOrThrow({ where: { source: "MANUAL" } });
    expect(event.rawMessage).toBe("Phoned 4PX: left Shenzhen");
    const [entry] = await auditFor(id);
    expect(entry).toMatchObject({ action: "MANUAL_EVENT_ADDED", actor });
    expect(entry?.after).toMatchObject({ statusChange: { from: "SHIPPED", to: "IN_TRANSIT" } });
  });

  it("rejects duplicates, future events, empty messages and unknown legs", async () => {
    const id = await createShipment();
    const input = {
      shipmentId: id,
      legSequence: 1,
      occurredAt: day(1),
      message: "seen",
      location: null,
      status: null,
    };
    await addManualEvent(prisma, input, actor, day(2));
    await expect(addManualEvent(prisma, input, actor, day(2))).rejects.toThrow("already recorded");
    await expect(
      addManualEvent(prisma, { ...input, occurredAt: day(3) }, actor, day(2)),
    ).rejects.toThrow("future");
    await expect(
      addManualEvent(prisma, { ...input, message: "  " }, actor, day(2)),
    ).rejects.toThrow(DomainError);
    await expect(
      addManualEvent(prisma, { ...input, legSequence: 2, message: "x" }, actor, day(2)),
    ).rejects.toThrow("no Leg 2");
    expect(await auditFor(id)).toHaveLength(1);
  });

  it("rejects unknown shipments", async () => {
    await expect(
      addManualEvent(
        prisma,
        {
          shipmentId: "nope",
          legSequence: 1,
          occurredAt: day(0),
          message: "x",
          location: null,
          status: null,
        },
        actor,
        day(1),
      ),
    ).rejects.toThrow("Shipment not found");
  });
});

describe("overrideStatus / clearOverride", () => {
  it("overrides with a reason, then falls back to the derived status", async () => {
    const id = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    expect(
      (
        await overrideStatus(
          prisma,
          { shipmentId: id, status: "DELIVERED", reason: "Customer emailed a photo" },
          actor,
          day(1),
        )
      ).status,
    ).toBe("DELIVERED");
    const row = await prisma.shipment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      overrideStatus: "DELIVERED",
      overrideBy: actor,
      overrideReason: "Customer emailed a photo",
    });

    expect((await clearOverride(prisma, { shipmentId: id }, actor, day(2))).status).toBe(
      "IN_TRANSIT",
    );
    expect((await auditFor(id)).map((e) => e.action)).toEqual([
      "STATUS_OVERRIDDEN",
      "OVERRIDE_CLEARED",
    ]);
  });

  it("requires a reason and writes nothing without one", async () => {
    const id = await createShipment();
    await expect(
      overrideStatus(prisma, { shipmentId: id, status: "DELIVERED", reason: " " }, actor),
    ).rejects.toThrow("needs a reason");
    expect(await auditFor(id)).toHaveLength(0);
  });

  it("cannot clear a missing override", async () => {
    const id = await createShipment();
    await expect(clearOverride(prisma, { shipmentId: id }, actor)).rejects.toThrow(
      "no manual override",
    );
  });
});

describe("markResolved", () => {
  it("clears a stuck shipment and audits it", async () => {
    const id = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    await refreshShipment(prisma, id, day(5));
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id } })).stuckSince).not.toBeNull();

    const after = await markResolved(prisma, { shipmentId: id }, actor, day(5));
    expect(after.stuckSince).toBeNull();
    expect((await auditFor(id))[0]).toMatchObject({ action: "STUCK_RESOLVED" });
  });

  it("refuses when the shipment is not stuck", async () => {
    const id = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    await expect(markResolved(prisma, { shipmentId: id }, actor, day(1))).rejects.toThrow(
      "Only a stuck Shipment",
    );
  });
});

describe("recordHandoff", () => {
  it("closes Leg 1, opens Leg 2 and records the Handoff", async () => {
    const id = await createShipment([{ at: day(0), status: "IN_TRANSIT" }]);
    const after = await recordHandoff(
      prisma,
      {
        shipmentId: id,
        carrierCode: "SAGAWA",
        trackingNumber: "900011112222",
        at: day(1),
        source: "MANUAL",
      },
      actor,
      day(2),
    );
    expect(after.status).toBe("HANDED_OFF");

    const legs = await prisma.leg.findMany({
      where: { shipmentId: id },
      orderBy: { sequence: "asc" },
    });
    expect(legs.map((l) => [l.sequence, l.carrierCode, l.endedAt?.toISOString() ?? null])).toEqual([
      [1, "4PX", day(1).toISOString()],
      [2, "SAGAWA", null],
    ]);
    expect(await prisma.handoff.count({ where: { shipmentId: id, source: "MANUAL" } })).toBe(1);
    expect((await auditFor(id))[0]).toMatchObject({ action: "HANDOFF_RECORDED" });
  });

  it("rejects unknown carriers and future handoffs", async () => {
    const id = await createShipment();
    const input = {
      shipmentId: id,
      carrierCode: "NOPE",
      trackingNumber: "1",
      at: day(1),
      source: "MANUAL" as const,
    };
    await expect(recordHandoff(prisma, input, actor, day(2))).rejects.toThrow("Unknown carrier");
    await expect(
      recordHandoff(prisma, { ...input, carrierCode: "SAGAWA", at: day(3) }, actor, day(2)),
    ).rejects.toThrow("future");
  });
});

describe("addNote", () => {
  it("stores the note in the audit log", async () => {
    const id = await createShipment();
    await addNote(prisma, { shipmentId: id, text: "  Emailed Sagawa support  " }, actor);
    expect((await auditFor(id))[0]).toMatchObject({
      action: "NOTE_ADDED",
      after: { text: "Emailed Sagawa support" },
    });
  });

  it("rejects empty or huge notes", async () => {
    const id = await createShipment();
    await expect(addNote(prisma, { shipmentId: id, text: " " }, actor)).rejects.toThrow(
      "cannot be empty",
    );
    await expect(
      addNote(prisma, { shipmentId: id, text: "x".repeat(2001) }, actor),
    ).rejects.toThrow("2000");
  });
});
