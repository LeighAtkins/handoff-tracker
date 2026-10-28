import { beforeEach, describe, expect, it } from "vitest";
import { orderNumberFrom, trackingForOrders, trackingUrl } from "../src/order-tracking";
import { ingestLegEvents } from "../src/tracking";
import { day, prisma, resetDatabase, t0 } from "./helpers";

beforeEach(resetDatabase);

async function order(number: string, carrierCode: string, trackingNumber: string) {
  await prisma.carrier.upsert({
    where: { code: carrierCode },
    create: { code: carrierCode, name: carrierCode, adapter: "manual" },
    update: {},
  });
  const created = await prisma.order.create({
    data: {
      sourceSystem: "NOMS",
      sourceOrderNumber: number,
      customerName: number,
      destinationCountry: "US",
      destinationPostcode: "-",
      shipments: {
        create: {
          createdAt: t0,
          status: "SHIPPED",
          legs: { create: { sequence: 1, carrierCode, trackingNumber, startedAt: t0 } },
        },
      },
    },
    include: { shipments: { include: { legs: true } } },
  });
  return created.shipments[0]!.legs[0]!.id;
}

describe("orderNumberFrom", () => {
  it("accepts Shopify numbers with or without # and CW numbers", () => {
    expect(orderNumberFrom("126362")).toBe("#126362");
    expect(orderNumberFrom("#126362")).toBe("#126362");
    expect(orderNumberFrom("%23126362")).toBe("#126362");
    expect(orderNumberFrom("cw-339312")).toBe("CW-339312");
    expect(orderNumberFrom("robert'); drop")).toBeNull();
  });
});

describe("trackingUrl", () => {
  it("links carriers with a public page and leaves others null", () => {
    expect(trackingUrl("4PX", "4PX1CN")).toBe("https://track.4px.com/#/result/0/4PX1CN");
    expect(trackingUrl("USPS", "9400")).toContain("tLabels=9400");
    expect(trackingUrl("SPEEDX", "SPX1")).toBeNull();
  });
});

describe("trackingForOrders", () => {
  it("gives the latest scan, the last-mile carrier and the check time, without personal data", async () => {
    const legId = await order("#126001", "4PX", "4PX111CN");
    await ingestLegEvents(
      prisma,
      {
        legId,
        events: [
          { occurredAt: day(1), rawStatus: "FPX_C_SPLS", rawMessage: "Picked up", location: "SZ" },
          {
            occurredAt: day(4),
            rawStatus: "FPX_I_DRR",
            rawMessage: "Arrived in destination country",
            location: "LAX",
          },
        ],
        facts: {
          lastMile: { carrierCode: "USPS", trackingNumber: "9400111" },
          estimatedDelivery: { from: day(8), to: null, source: "4PX" },
        },
      },
      day(5),
    );

    const [tracking] = await trackingForOrders(prisma, ["#126001"], day(5));
    expect(tracking).toMatchObject({
      order: "#126001",
      shipments: [
        {
          carrier: "4PX",
          tracking_number: "4PX111CN",
          last_mile_carrier: "USPS",
          last_mile_tracking_number: "9400111",
          last_mile_tracking_url: expect.stringContaining("9400111"),
          last_event: { message: "Arrived in destination country", location: "LAX" },
          eta: day(8).toISOString(),
          stuck: null,
          checked_at: day(5).toISOString(),
        },
      ],
    });
    expect(JSON.stringify(tracking)).not.toMatch(/customer|postcode|address/i);
  });

  it("splits a last-mile number stored on a 4PX parcel into 4PX's number and the last mile", async () => {
    const legId = await order("#126003", "4PX", "GFUS0108");
    await ingestLegEvents(prisma, {
      legId,
      events: [
        { occurredAt: day(1), rawStatus: "FPX_C_SPLS", rawMessage: "Picked up", location: null },
      ],
      facts: {
        lastMile: { carrierCode: "GOFO", trackingNumber: "GFUS0108" },
        fourPxNumber: "4PX300CN",
        lastMileContact: { name: "GOFO", website: "https://www.gofo.com", details: null },
      },
    });
    const [tracking] = await trackingForOrders(prisma, ["#126003"], day(1));
    expect(tracking!.shipments[0]).toMatchObject({
      tracking_number: "4PX300CN",
      last_mile_carrier: "GOFO",
      last_mile_tracking_number: "GFUS0108",
      last_mile_tracking_url: "https://www.gofo.com",
    });
  });

  it("reads SF's awaiting pickup as not collected yet, and leaves out unknown orders", async () => {
    const legId = await order("#126002", "SFEXPRESS", "SF5142210675662");
    await ingestLegEvents(prisma, {
      legId,
      events: [
        {
          occurredAt: day(2),
          rawStatus: "Awaiting Pickup",
          rawMessage: "Awaiting pickup by SF: not collected yet",
          location: null,
        },
      ],
    });
    const result = await trackingForOrders(prisma, ["#126002", "#999999"], day(2));
    expect(result).toHaveLength(1);
    expect(result[0]!.shipments[0]).toMatchObject({
      carrier: "SF Express",
      status: "label_created",
    });
  });
});
