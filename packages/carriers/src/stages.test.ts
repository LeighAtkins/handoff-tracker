import { describe, expect, it } from "vitest";
import { classifyStage, createStageClassifier } from "./stages";

const ev = (rawStatus: string, rawMessage = "") => ({ rawStatus, rawMessage });

describe("classifyStage", () => {
  it("reads our fake carrier's codes and 4PX's business link codes", () => {
    expect(classifyStage("4PX", ev("INFO_RECEIVED"))).toBe("LABEL_CREATED");
    expect(classifyStage("4PX", ev("FLIGHT_DEPARTED"))).toBe("DEPARTED_ORIGIN");
    expect(classifyStage("4PX", ev("HANDOVER"))).toBe("HANDED_OFF");
    expect(classifyStage("4PX", ev("FPX_D_STPP", "In transit"))).toBe("HANDED_OFF");
    expect(classifyStage("4PX", ev("FPX_I_HCCI"))).toBe("CUSTOMS_HOLD");
  });

  it("trusts a known 4PX code over its wording", () => {
    // FPX_I_PTCW's English says "released", but it means "taken to the bonded warehouse".
    expect(classifyStage("4PX", ev("FPX_I_PTCW", "Released by custom house"))).toBeNull();
    expect(classifyStage("4PX", ev("FPX_M_HA", "Hand over to airline."))).toBeNull();
  });

  it.each([
    ["InTransit_CustomsReleased", "CUSTOMS_CLEARED"],
    ["InTransit_CustomsRequiringInformation", "CUSTOMS_HOLD"],
    ["Exception_Delayed", "DELAYED"],
    ["DeliveryFailure_NoBody", "DELIVERY_FAILED"],
    ["DeliveryFailure_InvalidAddress", "ADDRESS_PROBLEM"],
    ["AvailableForPickup_Other", "AWAITING_PICKUP"],
    ["Delivered_Other", "DELIVERED"],
    ["Exception_Lost", "EXCEPTION"],
    ["Departure", "DEPARTED_ORIGIN"],
    ["transit_origin_country_departure", "DEPARTED_ORIGIN"],
    ["destination_arrival", "ARRIVED_DESTINATION"],
    ["customs_exception", "CUSTOMS_HOLD"],
    ["delivery_attempted", "DELIVERY_FAILED"],
    ["InTransit_004", "ARRIVED_DESTINATION"],
    ["AttemptFail_002", "DELIVERY_FAILED"],
    ["OutForDelivery_003", "OUT_FOR_DELIVERY"],
    ["Exception_011", "RETURNED"],
    ["Exception_013", "EXCEPTION"],
    ["handed_over_to_last_mile_carrier", "HANDED_OFF"],
  ])("maps the aggregator code %s to %s", (code, stage) => {
    expect(classifyStage("4PX", ev(code))).toBe(stage);
  });

  it("leaves aggregator codes with unclear meaning to the wording", () => {
    expect(classifyStage("4PX", ev("InTransit_007", "Departure scan"))).toBeNull();
    expect(classifyStage("4PX", ev("InTransit_005", "Customs clearance completed"))).toBe(
      "CUSTOMS_CLEARED",
    );
  });

  it.each([
    ["Returned to sender", "RETURNED"],
    ["Return to sender in progress", "RETURNING"],
    ["Held by customs: inspection required", "CUSTOMS_HOLD"],
    ["Incorrect address, please contact the recipient", "ADDRESS_PROBLEM"],
    ["Delivery attempted, recipient not available", "DELIVERY_FAILED"],
    ["Ready for pickup at the post office", "AWAITING_PICKUP"],
    ["Out for delivery", "OUT_FOR_DELIVERY"],
    ["Delivered, signed for by the customer", "DELIVERED"],
    ["Handed over to last-mile carrier: Sagawa", "HANDED_OFF"],
    ["Import customs clearance completed", "CUSTOMS_CLEARED"],
    ["Arrived at destination airport", "ARRIVED_DESTINATION"],
    ["Departure from the original airport", "DEPARTED_ORIGIN"],
    ["Parcel received at 4PX Shenzhen sorting centre", "PICKED_UP"],
    ["Shipment information received", "LABEL_CREATED"],
  ])("reads English wording: %s", (message, stage) => {
    expect(classifyStage("4PX", ev("", message))).toBe(stage);
  });

  it("does not take export clearance or hub scans for milestones", () => {
    expect(classifyStage("4PX", ev("", "Export customs clearance completed"))).toBeNull();
    expect(classifyStage("4PX", ev("", "Departed from sorting centre"))).toBeNull();
    expect(classifyStage("4PX", ev("", "Arrived at hub"))).toBeNull();
  });

  it.each([
    ["荷物を受け付けました", "LAST_MILE_ACCEPTED"],
    ["輸送中です", null],
    ["配達中です", "OUT_FOR_DELIVERY"],
    ["配達が完了しました", "DELIVERED"],
    ["ご不在のため持ち戻りました", "DELIVERY_FAILED"],
    ["住所不明のため持ち戻りました", "ADDRESS_PROBLEM"],
    ["営業所でお預かりしております", "AWAITING_PICKUP"],
    ["差出人へ返送中です", "RETURNING"],
    ["差出人へ返送しました", "RETURNED"],
    ["調査中です", "EXCEPTION"],
  ])("reads Sagawa's Japanese: %s", (message, stage) => {
    expect(classifyStage("SAGAWA", ev("", message), 2)).toBe(stage);
  });

  it("treats a first scan on the last-mile leg as the last-mile carrier accepting it", () => {
    expect(classifyStage("YAMATO", ev("", "Picked up"), 2)).toBe("LAST_MILE_ACCEPTED");
    expect(classifyStage("YAMATO", ev("", "Picked up"), 1)).toBe("PICKED_UP");
    expect(classifyStage("YAMATO", ev("", "Delivered"), 2)).toBe("DELIVERED");
  });

  it("returns null for anything it does not recognise", () => {
    expect(classifyStage("YAMATO", ev("ZZZ", "Something new"))).toBeNull();
  });

  it("accepts a custom table", () => {
    const custom = createStageClassifier({ X: [{ rawStatus: "ok", stage: "DELIVERED" }] });
    expect(custom("X", ev("OK"))).toBe("DELIVERED");
    expect(custom("X", ev("no"))).toBeNull();
  });
});
