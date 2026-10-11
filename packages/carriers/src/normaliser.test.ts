import { describe, expect, it } from "vitest";
import { createNormaliser, normalise } from "./normaliser";

const ev = (rawStatus: string, rawMessage = "") => ({ rawStatus, rawMessage });

describe("normalise", () => {
  it("maps 4PX status codes", () => {
    expect(normalise("4PX", ev("PICKED_UP"))).toBe("SHIPPED");
    expect(normalise("4PX", ev("handover"))).toBe("HANDED_OFF");
    expect(normalise("4PX", ev("CUSTOMS_HOLD"))).toBe("EXCEPTION");
  });

  it("falls back to message text for 4PX", () => {
    expect(normalise("4PX", ev("X", "Customs clearance completed"))).toBe("IN_TRANSIT");
    expect(normalise("4PX", ev("X", "Out for delivery"))).toBe("OUT_FOR_DELIVERY");
  });

  it.each([
    ["荷物を受け付けました", "IN_TRANSIT"],
    ["輸送中です", "IN_TRANSIT"],
    ["配達中です", "OUT_FOR_DELIVERY"],
    ["配達が完了しました", "DELIVERED"],
    ["住所不明のため持ち戻りました", "EXCEPTION"],
    ["差出人へ返送しました", "RETURNED"],
  ])("maps Sagawa message %s to %s", (message, status) => {
    expect(normalise("SAGAWA", ev("", message))).toBe(status);
  });

  it("uses generic English rules for unknown carriers", () => {
    expect(normalise("YAMATO", ev("", "Delivered to front door"))).toBe("DELIVERED");
    expect(normalise("YAMATO", ev("", "Returned to sender"))).toBe("RETURNED");
    expect(normalise("YAMATO", ev("", "Label created"))).toBe("PENDING");
  });

  it("maps 4PX Open Platform codes before any wording", () => {
    expect(normalise("4PX", ev("FPX_D_STPP", "In transit"))).toBe("HANDED_OFF");
    expect(normalise("4PX", ev("FPX_I_HCCI"))).toBe("EXCEPTION");
    expect(normalise("4PX", ev("FPX_M_TDBW", "Transport delay"))).toBe("IN_TRANSIT");
    // A code 4PX added after this table was written is reported as unrecognised.
    expect(normalise("4PX", ev("FPX_Z_NEW", "Delivered"))).toBeNull();
  });

  it.each([
    ["InTransit_PickedUp", "SHIPPED"],
    ["InTransit_CustomsReleased", "IN_TRANSIT"],
    ["InTransit_CustomsRequiringInformation", "EXCEPTION"],
    ["DeliveryFailure_NoBody", "EXCEPTION"],
    ["AvailableForPickup_Other", "OUT_FOR_DELIVERY"],
    ["Exception_Returning", "RETURNED"],
    ["Exception_Delayed", "IN_TRANSIT"],
    ["Exception_Lost", "EXCEPTION"],
    ["Expired_Other", null],
    ["InTransit_002", "SHIPPED"],
    ["AttemptFail_001", "EXCEPTION"],
    ["Exception_010", "RETURNED"],
    ["Delivered_003", "DELIVERED"],
    ["delivery_delivered", "DELIVERED"],
    ["customs_rejected", "EXCEPTION"],
    ["exception_return", "RETURNED"],
  ])("maps the aggregator sub-status %s to %s", (code, status) => {
    expect(normalise("YAMATO", ev(code))).toBe(status);
  });

  it("returns null for messages it does not recognise", () => {
    expect(normalise("4PX", ev("ZZZ", "Something new"))).toBeNull();
  });

  it("accepts a custom table", () => {
    const custom = createNormaliser({ X: [{ rawStatus: "ok", status: "DELIVERED" }] });
    expect(custom("X", ev("OK"))).toBe("DELIVERED");
  });
});
