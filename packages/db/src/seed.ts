/**
 * Seeds ~50 fake orders following a 4PX -> Sagawa journey.
 * P3: everything here is invented. Order numbers use the DEMO- prefix so fake data is obvious.
 * Timestamps are relative to "now" so stuck shipments stay stuck whenever you reseed.
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createPrismaClient } from "./client";
import type { EventSource, ShipmentStatus } from "./generated/prisma/client";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const prisma = createPrismaClient();

// Deterministic PRNG (mulberry32) so every seed produces the same data.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261010);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 10)).join("");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const FIRST_NAMES = [
  "Aiko",
  "Kenji",
  "Yui",
  "Haruto",
  "Mei",
  "Sota",
  "Rin",
  "Daiki",
  "Sakura",
  "Ren",
];
const LAST_NAMES = [
  "Tanaka",
  "Suzuki",
  "Sato",
  "Takahashi",
  "Watanabe",
  "Ito",
  "Nakamura",
  "Kobayashi",
];

interface Step {
  leg: 1 | 2;
  rawStatus: string;
  rawMessage: string;
  location: string;
  status: ShipmentStatus;
}

// The happy-path journey. Shipments stop part-way along it depending on their scenario.
const JOURNEY: Step[] = [
  {
    leg: 1,
    rawStatus: "INFO_RECEIVED",
    rawMessage: "Shipment information received",
    location: "Shenzhen, CN",
    status: "PENDING",
  },
  {
    leg: 1,
    rawStatus: "PICKED_UP",
    rawMessage: "Parcel picked up",
    location: "Shenzhen, CN",
    status: "SHIPPED",
  },
  {
    leg: 1,
    rawStatus: "DEPARTED",
    rawMessage: "Departed from sorting centre",
    location: "Shenzhen, CN",
    status: "IN_TRANSIT",
  },
  {
    leg: 1,
    rawStatus: "ARRIVED_DEST",
    rawMessage: "Arrived at destination country",
    location: "Osaka, JP",
    status: "IN_TRANSIT",
  },
  {
    leg: 1,
    rawStatus: "HANDOVER",
    rawMessage: "Handed over to last-mile carrier: Sagawa",
    location: "Osaka, JP",
    status: "HANDED_OFF",
  },
  // Open question for ADR-0002: should last-mile transit scans normalise to IN_TRANSIT or stay HANDED_OFF?
  {
    leg: 2,
    rawStatus: "集荷",
    rawMessage: "荷物を受け付けました",
    location: "大阪営業所",
    status: "IN_TRANSIT",
  },
  {
    leg: 2,
    rawStatus: "輸送中",
    rawMessage: "輸送中です",
    location: "東京中継センター",
    status: "IN_TRANSIT",
  },
  {
    leg: 2,
    rawStatus: "配達中",
    rawMessage: "配達中です",
    location: "東京営業所",
    status: "OUT_FOR_DELIVERY",
  },
  {
    leg: 2,
    rawStatus: "配達完了",
    rawMessage: "配達が完了しました",
    location: "東京営業所",
    status: "DELIVERED",
  },
];
const HANDOFF_STEP = 4;

interface Scenario {
  name: string;
  count: number;
  /** Index into JOURNEY of the last event that has happened. */
  lastStep: number;
  /** How long ago the last event happened. */
  quietFor: () => number;
  status: ShipmentStatus;
  stuck?: boolean;
  tail?: Step[];
}

const recent = () => random() * 20 * HOUR;

const SCENARIOS: Scenario[] = [
  { name: "label created", count: 4, lastStep: 0, quietFor: recent, status: "PENDING" },
  { name: "picked up", count: 5, lastStep: 1, quietFor: recent, status: "SHIPPED" },
  { name: "in transit with 4PX", count: 7, lastStep: 3, quietFor: recent, status: "IN_TRANSIT" },
  {
    name: "stuck with 4PX",
    count: 1,
    lastStep: 2,
    quietFor: () => 4 * DAY + random() * DAY,
    status: "IN_TRANSIT",
    stuck: true,
  },
  {
    name: "just handed off",
    count: 4,
    lastStep: HANDOFF_STEP,
    quietFor: recent,
    status: "HANDED_OFF",
  },
  {
    // The case this app exists for: 4PX says handed over, Sagawa never picks it up.
    name: "quiet after handoff",
    count: 3,
    lastStep: HANDOFF_STEP,
    quietFor: () => 6 * DAY + random() * 3 * DAY,
    status: "HANDED_OFF",
    stuck: true,
  },
  { name: "moving with Sagawa", count: 4, lastStep: 6, quietFor: recent, status: "HANDED_OFF" },
  {
    name: "out for delivery",
    count: 5,
    lastStep: 7,
    quietFor: () => random() * 8 * HOUR,
    status: "OUT_FOR_DELIVERY",
  },
  {
    name: "delivered",
    count: 11,
    lastStep: 8,
    quietFor: () => 1 * DAY + random() * 10 * DAY,
    status: "DELIVERED",
  },
  {
    name: "customs hold",
    count: 2,
    lastStep: 3,
    quietFor: () => 2 * DAY,
    status: "EXCEPTION",
    tail: [
      {
        leg: 1,
        rawStatus: "CUSTOMS_HOLD",
        rawMessage: "Held by customs: inspection required",
        location: "Osaka, JP",
        status: "EXCEPTION",
      },
    ],
  },
  {
    name: "address problem",
    count: 2,
    lastStep: 6,
    quietFor: () => 1 * DAY,
    status: "EXCEPTION",
    tail: [
      {
        leg: 2,
        rawStatus: "持戻",
        rawMessage: "住所不明のため持ち戻りました",
        location: "東京営業所",
        status: "EXCEPTION",
      },
    ],
  },
  {
    name: "returned",
    count: 2,
    lastStep: 6,
    quietFor: () => 3 * DAY,
    status: "RETURNED",
    tail: [
      {
        leg: 2,
        rawStatus: "持戻",
        rawMessage: "住所不明のため持ち戻りました",
        location: "東京営業所",
        status: "EXCEPTION",
      },
      {
        leg: 2,
        rawStatus: "返送",
        rawMessage: "差出人へ返送しました",
        location: "大阪営業所",
        status: "RETURNED",
      },
    ],
  },
];

async function main() {
  await prisma.$transaction([
    prisma.auditEntry.deleteMany(),
    prisma.order.deleteMany(), // cascades to shipments, legs, handoffs, events
    prisma.carrier.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await prisma.carrier.createMany({
    data: [
      { code: "4PX", name: "4PX Express", adapter: "fake", pollIntervalMinutes: 240 },
      { code: "SAGAWA", name: "Sagawa Express", adapter: "fake", pollIntervalMinutes: 240 },
    ],
  });

  await prisma.user.createMany({
    data: [
      { email: "admin@example.com", role: "ADMIN" },
      { email: "operator@example.com", role: "OPERATOR" },
      { email: "viewer@example.com", role: "VIEWER" },
    ],
  });

  const now = Date.now();
  let orderNumber = 10001;

  for (const scenario of SCENARIOS) {
    for (let i = 0; i < scenario.count; i++) {
      const steps = [...JOURNEY.slice(0, scenario.lastStep + 1), ...(scenario.tail ?? [])];
      const lastAt = now - scenario.quietFor();
      // Space earlier events 8-30 hours apart, working backwards from the last one.
      const times: number[] = [lastAt];
      for (let s = steps.length - 2; s >= 0; s--)
        times.unshift(times[0]! - (8 + random() * 22) * HOUR);
      const at = (s: number) => new Date(times[s]!);

      const reachedLeg2 = steps.some((s) => s.leg === 2) || scenario.lastStep >= HANDOFF_STEP;
      const handoffAt = at(Math.min(HANDOFF_STEP, steps.length - 1));
      const source: EventSource = "FAKE";

      const order = await prisma.order.create({
        data: {
          sourceSystem: "shopify",
          sourceOrderNumber: `DEMO-${orderNumber++}`,
          customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          destinationCountry: "JP",
          destinationPostcode: `${digits(3)}-${digits(4)}`,
          createdAt: new Date(times[0]! - 2 * HOUR),
        },
      });

      const shipment = await prisma.shipment.create({
        data: {
          orderId: order.id,
          status: scenario.status,
          lastEventAt: new Date(lastAt),
          stuckSince: scenario.stuck ? new Date(lastAt) : null,
          createdAt: order.createdAt,
        },
      });

      const leg1 = await prisma.leg.create({
        data: {
          shipmentId: shipment.id,
          sequence: 1,
          carrierCode: "4PX",
          trackingNumber: `4PX3000${digits(10)}CN`,
          startedAt: at(0),
          endedAt: reachedLeg2 ? handoffAt : null,
        },
      });

      const leg2 = reachedLeg2
        ? await prisma.leg.create({
            data: {
              shipmentId: shipment.id,
              sequence: 2,
              carrierCode: "SAGAWA",
              trackingNumber: `9${digits(11)}`,
              startedAt: handoffAt,
              endedAt:
                scenario.status === "DELIVERED" || scenario.status === "RETURNED"
                  ? new Date(lastAt)
                  : null,
            },
          })
        : null;

      if (leg2) {
        await prisma.handoff.create({
          data: {
            shipmentId: shipment.id,
            fromLegId: leg1.id,
            toLegId: leg2.id,
            detectedAt: handoffAt,
            source: "CARRIER_EVENT",
          },
        });
      }

      await prisma.trackingEvent.createMany({
        data: steps.map((step, s) => ({
          legId: step.leg === 2 && leg2 ? leg2.id : leg1.id,
          occurredAt: at(s),
          rawStatus: step.rawStatus,
          rawMessage: step.rawMessage,
          location: step.location,
          normalisedStatus: step.status,
          source,
        })),
      });
    }
  }

  await prisma.auditEntry.create({
    data: {
      entityType: "System",
      entityId: "seed",
      action: "SEED",
      actor: "system:seed",
      after: { orders: orderNumber - 10001 },
    },
  });

  const [orders, stuck] = await Promise.all([
    prisma.order.count(),
    prisma.shipment.count({ where: { stuckSince: { not: null } } }),
  ]);
  console.log(`Seeded ${orders} fake orders (${stuck} stuck).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
