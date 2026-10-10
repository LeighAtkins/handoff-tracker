import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  applyEvent,
  applyOverride,
  clearOverride,
  createShipment,
  currentLeg,
  currentStatus,
  daysQuiet,
  derivedStatus,
  isStuck,
  lastEventAt,
  markResolved,
  recordHandoff,
  stuckSince,
  type EventState,
  type ShipmentState,
} from "./shipment";
import type { Status } from "./status";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-10-01T00:00:00Z");
const day = (n: number) => new Date(t0.getTime() + n * DAY);

function event(
  legSequence: number,
  at: Date,
  status: Status | null,
  rawMessage = String(status),
): EventState {
  return { legSequence, occurredAt: at, rawMessage, normalisedStatus: status };
}

function fourPx(): ShipmentState {
  return createShipment({ createdAt: t0, carrierCode: "4PX", trackingNumber: "4PX123CN" });
}

/** 4PX picks up and moves the parcel, then hands it to Sagawa on day 3. */
function handedOff(): ShipmentState {
  let s = fourPx();
  s = applyEvent(s, event(1, day(0), "SHIPPED"));
  s = applyEvent(s, event(1, day(1), "IN_TRANSIT"));
  s = applyEvent(s, event(1, day(3), "HANDED_OFF"));
  return recordHandoff(s, {
    carrierCode: "SAGAWA",
    trackingNumber: "900011112222",
    at: day(3),
    source: "CARRIER_EVENT",
  });
}

describe("createShipment", () => {
  it("starts with one open Leg and PENDING status", () => {
    const s = fourPx();
    expect(s.legs).toEqual([
      { sequence: 1, carrierCode: "4PX", trackingNumber: "4PX123CN", startedAt: t0, endedAt: null },
    ]);
    expect(currentStatus(s)).toBe("PENDING");
    expect(lastEventAt(s)).toBeNull();
  });
});

describe("currentLeg", () => {
  it("rejects a Shipment with no Legs", () => {
    expect(() => currentLeg({ ...fourPx(), legs: [] })).toThrow(DomainError);
  });
});

describe("applyEvent", () => {
  it("derives status from the latest normalised event", () => {
    let s = fourPx();
    s = applyEvent(s, event(1, day(0), "SHIPPED"));
    expect(currentStatus(s)).toBe("SHIPPED");
    s = applyEvent(s, event(1, day(1), "IN_TRANSIT"));
    expect(currentStatus(s)).toBe("IN_TRANSIT");
    expect(lastEventAt(s)).toEqual(day(1));
  });

  it("is idempotent for the same event", () => {
    const once = applyEvent(fourPx(), event(1, day(0), "SHIPPED"));
    const twice = applyEvent(once, event(1, day(0), "SHIPPED"));
    expect(twice).toBe(once);
    expect(twice.events).toHaveLength(1);
  });

  it("keeps two different messages at the same moment", () => {
    let s = applyEvent(fourPx(), event(1, day(0), "SHIPPED", "picked up"));
    s = applyEvent(s, event(1, day(0), "SHIPPED", "scanned"));
    expect(s.events).toHaveLength(2);
  });

  it("rejects events for a Leg the Shipment does not have", () => {
    expect(() => applyEvent(fourPx(), event(2, day(0), "SHIPPED"))).toThrow(DomainError);
  });

  it("records unrecognised events without changing status", () => {
    let s = applyEvent(fourPx(), event(1, day(0), "SHIPPED"));
    s = applyEvent(s, event(1, day(1), null, "Mystery scan"));
    expect(currentStatus(s)).toBe("SHIPPED");
    expect(lastEventAt(s)).toEqual(day(1));
  });

  it("places late-arriving events in time order", () => {
    let s = fourPx();
    s = applyEvent(s, event(1, day(1), "EXCEPTION"));
    s = applyEvent(s, event(1, day(2), "IN_TRANSIT"));
    // An older event arriving late must not re-open the cleared exception.
    s = applyEvent(s, event(1, day(0), "SHIPPED"));
    expect(derivedStatus(s)).toBe("IN_TRANSIT");
  });
});

describe("recordHandoff", () => {
  it("closes Leg n, opens Leg n+1 and connects them with a Handoff", () => {
    const s = handedOff();
    expect(s.legs.map((l) => [l.sequence, l.carrierCode, l.endedAt])).toEqual([
      [1, "4PX", day(3)],
      [2, "SAGAWA", null],
    ]);
    expect(s.handoffs).toEqual([
      { fromSequence: 1, toSequence: 2, detectedAt: day(3), source: "CARRIER_EVENT" },
    ]);
    expect(currentLeg(s).trackingNumber).toBe("900011112222");
  });

  it("moves status to HANDED_OFF even without a carrier event saying so", () => {
    let s = applyEvent(fourPx(), event(1, day(1), "IN_TRANSIT"));
    s = recordHandoff(s, {
      carrierCode: "SAGAWA",
      trackingNumber: "9001",
      at: day(2),
      source: "MANUAL",
    });
    expect(currentStatus(s)).toBe("HANDED_OFF");
  });

  it("keeps HANDED_OFF when the new carrier reports in-transit scans", () => {
    let s = handedOff();
    s = applyEvent(s, event(2, day(4), "IN_TRANSIT"));
    expect(currentStatus(s)).toBe("HANDED_OFF");
    s = applyEvent(s, event(2, day(5), "OUT_FOR_DELIVERY"));
    expect(currentStatus(s)).toBe("OUT_FOR_DELIVERY");
  });

  it("supports a chain of handoffs", () => {
    const s = recordHandoff(handedOff(), {
      carrierCode: "YAMATO",
      trackingNumber: "Y1",
      at: day(6),
      source: "MANUAL",
    });
    expect(s.legs.map((l) => l.sequence)).toEqual([1, 2, 3]);
    expect(s.handoffs.at(-1)).toMatchObject({ fromSequence: 2, toSequence: 3 });
  });

  it("rejects a duplicate Leg", () => {
    expect(() =>
      recordHandoff(handedOff(), {
        carrierCode: "SAGAWA",
        trackingNumber: "900011112222",
        at: day(4),
        source: "MANUAL",
      }),
    ).toThrow(/already a Leg/);
  });

  it("rejects a blank tracking number", () => {
    expect(() =>
      recordHandoff(fourPx(), {
        carrierCode: "SAGAWA",
        trackingNumber: " ",
        at: day(1),
        source: "MANUAL",
      }),
    ).toThrow(DomainError);
  });

  it("rejects a Handoff before the current Leg started", () => {
    expect(() =>
      recordHandoff(handedOff(), {
        carrierCode: "YAMATO",
        trackingNumber: "Y1",
        at: day(2),
        source: "MANUAL",
      }),
    ).toThrow(/before the current Leg/);
  });

  it("rejects handing off a delivered Shipment", () => {
    const s = applyEvent(fourPx(), event(1, day(1), "DELIVERED"));
    expect(() =>
      recordHandoff(s, {
        carrierCode: "SAGAWA",
        trackingNumber: "9",
        at: day(2),
        source: "MANUAL",
      }),
    ).toThrow(/delivered or returned/);
  });
});

describe("manual override", () => {
  const override = {
    status: "DELIVERED" as const,
    reason: "Customer confirmed by email",
    by: "op@example.com",
    at: day(4),
  };

  it("replaces the derived status while active", () => {
    const s = applyOverride(handedOff(), override);
    expect(currentStatus(s)).toBe("DELIVERED");
    expect(derivedStatus(s)).toBe("HANDED_OFF");
  });

  it("may move status backwards, because correcting carriers is its purpose", () => {
    const delivered = applyEvent(fourPx(), event(1, day(1), "DELIVERED"));
    const s = applyOverride(delivered, { ...override, status: "EXCEPTION" });
    expect(currentStatus(s)).toBe("EXCEPTION");
  });

  it("trims the reason", () => {
    expect(applyOverride(fourPx(), { ...override, reason: "  checked  " }).override?.reason).toBe(
      "checked",
    );
  });

  it("requires a reason", () => {
    expect(() => applyOverride(fourPx(), { ...override, reason: "   " })).toThrow(/needs a reason/);
  });

  it("requires an actor", () => {
    expect(() => applyOverride(fourPx(), { ...override, by: "" })).toThrow(/needs an actor/);
  });

  it("falls back to the derived status once cleared", () => {
    const s = clearOverride(applyOverride(handedOff(), override));
    expect(currentStatus(s)).toBe("HANDED_OFF");
  });

  it("cannot clear an override that does not exist", () => {
    expect(() => clearOverride(fourPx())).toThrow(DomainError);
  });
});

describe("stuck detection", () => {
  it("flags a Shipment with no new event for 3 days", () => {
    const s = applyEvent(fourPx(), event(1, day(1), "IN_TRANSIT"));
    expect(isStuck(s, day(3.9))).toBe(false);
    expect(stuckSince(s, day(4))).toEqual(day(4));
    expect(isStuck(s, day(10))).toBe(true);
  });

  it("measures from creation when nothing has arrived yet", () => {
    expect(stuckSince(fourPx(), day(3))).toEqual(day(3));
  });

  it("waits 5 days after a Handoff for the receiving carrier", () => {
    const s = handedOff(); // handoff on day 3, Sagawa silent since
    expect(isStuck(s, day(7.9))).toBe(false);
    expect(stuckSince(s, day(8))).toEqual(day(8));
  });

  it("measures the handoff wait from the latest event on the old Leg", () => {
    const s = applyEvent(handedOff(), event(1, day(4), null, "4PX: departed hub"));
    expect(stuckSince(s, day(9))).toEqual(day(9));
  });

  it("returns to the 3-day rule once the new carrier reports", () => {
    const s = applyEvent(handedOff(), event(2, day(4), "IN_TRANSIT"));
    expect(isStuck(s, day(6.9))).toBe(false);
    expect(stuckSince(s, day(7))).toEqual(day(7));
  });

  it("uses custom rules", () => {
    const s = applyEvent(fourPx(), event(1, day(0), "IN_TRANSIT"));
    expect(isStuck(s, day(1), { quietDays: 1, quietDaysAfterHandoff: 2 })).toBe(true);
  });

  it("never flags delivered or returned Shipments", () => {
    const delivered = applyEvent(fourPx(), event(1, day(0), "DELIVERED"));
    const returned = applyEvent(fourPx(), event(1, day(0), "RETURNED"));
    expect(isStuck(delivered, day(30))).toBe(false);
    expect(isStuck(returned, day(30))).toBe(false);
  });

  it("respects an override to a terminal status", () => {
    const s = applyOverride(fourPx(), {
      status: "DELIVERED",
      reason: "signed for",
      by: "op",
      at: day(1),
    });
    expect(isStuck(s, day(30))).toBe(false);
  });

  it("counts whole days quiet", () => {
    const s = applyEvent(fourPx(), event(1, day(1), "IN_TRANSIT"));
    expect(daysQuiet(s, day(5.5))).toBe(4);
    expect(daysQuiet(fourPx(), day(2))).toBe(2);
    expect(daysQuiet(fourPx(), day(-1))).toBe(0);
  });
});

describe("markResolved", () => {
  it("clears stuck until a new quiet period passes the threshold", () => {
    let s = applyEvent(fourPx(), event(1, day(0), "IN_TRANSIT"));
    s = markResolved(s, day(4));
    expect(isStuck(s, day(20))).toBe(false);
    s = applyEvent(s, event(1, day(5), "IN_TRANSIT", "moved again"));
    expect(isStuck(s, day(7.9))).toBe(false);
    expect(isStuck(s, day(8))).toBe(true);
  });

  it("rejects resolving a Shipment that is not stuck", () => {
    expect(() => markResolved(fourPx(), day(1))).toThrow(/Only a stuck Shipment/);
  });
});
