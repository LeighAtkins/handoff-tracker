import { describe, expect, it } from "vitest";
import { createSampleClient, isSampleNumber, SAMPLE_NUMBERS } from "./sample";
import { classifyStage } from "./stages";

const now = new Date("2026-10-10T00:00:00Z");
const client = createSampleClient({ now: () => now });

describe("sample lookups", () => {
  it("lists each sample number with the scenario it shows", () => {
    expect(SAMPLE_NUMBERS.map((s) => s.scenario)).toEqual([
      "delivered",
      "stalled-after-handoff",
      "customs-hold",
      "delivery-failed",
      "in-flight",
    ]);
    expect(isSampleNumber("4pxdemo1001cn")).toBe(true);
    expect(isSampleNumber("4PX3002711212113CN")).toBe(false);
  });

  it("replays a journey relative to now, across both carriers", async () => {
    const result = await client.track("4PXDEMO1001CN", "4PX");
    expect(result.events[0]).toEqual({
      occurredAt: new Date("2026-10-02T22:00:00Z"),
      rawStatus: "FPX_L_RPIF",
      rawMessage: "Shipment information received",
      location: "Shenzhen, CN",
      carrierCode: "4PX",
      trackingNumber: "4PXDEMO1001CN",
    });
    expect(result.events.at(-1)).toMatchObject({
      carrierCode: "SAGAWA",
      trackingNumber: "900000101001",
    });
    expect(result.handoff).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900000101001",
    });
    expect(result.facts).toMatchObject({ destinationCountry: "JP", weightKg: 2.4 });
  });

  it("knows the last-mile number before the handover without reporting a handoff", async () => {
    const result = await client.track("4PXDEMO1005CN", "4PX");
    expect(result.handoff).toBeNull();
    expect(result.facts?.lastMile).toEqual({
      carrierCode: "SAGAWA",
      trackingNumber: "900000101005",
    });
  });

  it("has no last-mile carrier for a parcel still held in customs", async () => {
    const result = await client.track("4PXDEMO1003CN", "4PX");
    expect(result.handoff).toBeNull();
    expect(classifyStage("4PX", result.events.at(-1)!)).toBe("CUSTOMS_HOLD");
    expect(result.events.every((e) => e.trackingNumber === "4PXDEMO1003CN")).toBe(true);
  });

  it("never invents a journey for a real number", async () => {
    expect(await client.track("4PX3002711212113CN", "4PX")).toEqual({
      events: [],
      handoff: null,
      state: "NOT_FOUND",
    });
  });

  it("uses the real clock by default", async () => {
    const result = await createSampleClient().track("4PXDEMO1005CN", "4PX");
    expect(result.events.at(-1)!.occurredAt.getTime()).toBeLessThan(Date.now());
  });
});
