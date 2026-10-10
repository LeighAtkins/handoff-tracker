import { describe, expect, it } from "vitest";
import { createFakeAdapter, defaultFixture, type FakeFixture } from "./fake";
import { normalise } from "./normaliser";

const anchor = new Date("2026-10-01T00:00:00Z");
const at = (hours: number) => () => new Date(anchor.getTime() + hours * 3600_000);

const fixture: FakeFixture = {
  journeys: [
    {
      carrierCode: "4PX",
      trackingNumber: "T1",
      events: [
        {
          offsetHours: 0,
          rawStatus: "PICKED_UP",
          rawMessage: "Parcel picked up",
          location: "Shenzhen",
        },
        {
          offsetHours: 10,
          rawStatus: "HANDOVER",
          rawMessage: "Handed over to last-mile carrier: Sagawa (9001)",
          location: null,
        },
      ],
    },
  ],
};

describe("fake adapter", () => {
  it("only returns events whose time has come", async () => {
    const early = createFakeAdapter("4PX", { fixture, anchor, now: at(5) });
    const late = createFakeAdapter("4PX", { fixture, anchor, now: at(11) });
    expect(await early.fetchEvents("T1")).toHaveLength(1);
    expect(await late.fetchEvents("T1")).toHaveLength(2);
  });

  it("returns nothing for unknown tracking numbers or other carriers", async () => {
    expect(await createFakeAdapter("4PX", { fixture, anchor }).fetchEvents("nope")).toEqual([]);
    expect(await createFakeAdapter("SAGAWA", { fixture, anchor }).fetchEvents("T1")).toEqual([]);
  });

  it("detects the next carrier from the handover message", async () => {
    const adapter = createFakeAdapter("4PX", { fixture, anchor, now: at(11) });
    const events = await adapter.fetchEvents("T1");
    expect(adapter.detectHandoff?.(events)).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "9001",
    });
    expect(adapter.detectHandoff?.(events.slice(0, 1))).toBeNull();
  });

  it("anchors to three days before today by default", async () => {
    const now = new Date("2026-10-10T15:00:00Z");
    const adapter = createFakeAdapter("4PX", { fixture, now: () => now });
    const [first] = await adapter.fetchEvents("T1");
    expect(first?.occurredAt).toEqual(new Date("2026-10-07T00:00:00Z"));
  });

  it("ships a default fixture whose messages all normalise", () => {
    for (const journey of defaultFixture.journeys) {
      for (const event of journey.events) {
        expect(
          normalise(journey.carrierCode, event),
          `${journey.trackingNumber}: ${event.rawMessage}`,
        ).not.toBeNull();
      }
    }
  });

  it("uses the real clock by default", async () => {
    expect(Array.isArray(await createFakeAdapter("4PX").fetchEvents("4PXDEMO0001CN"))).toBe(true);
  });
});
