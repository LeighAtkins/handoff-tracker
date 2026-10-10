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

  it("returns null for messages it does not recognise", () => {
    expect(normalise("4PX", ev("ZZZ", "Something new"))).toBeNull();
  });

  it("accepts a custom table", () => {
    const custom = createNormaliser({ X: [{ rawStatus: "ok", status: "DELIVERED" }] });
    expect(custom("X", ev("OK"))).toBe("DELIVERED");
  });
});
