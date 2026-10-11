/**
 * Seeds ~50 fake orders following a 4PX -> Sagawa journey, plus eight weeks of delivered history
 * (DEMO-2xxxx) so the overview's typical times and trends have something to learn from.
 * P3: everything here is invented. Order numbers use the DEMO- prefix so fake data is obvious.
 * Timestamps are relative to "now" so stuck shipments stay stuck whenever you reseed.
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { normalise } from "@handoff/carriers";
import { createPrismaClient } from "./client";
import { refreshShipment } from "./repositories/shipment";
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
/** Finished journeys over the last eight weeks, for typical times and trends. */
const HISTORY_COUNT = 120;

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
  /** Typical hours since the previous step, as [min, max]. */
  gap: [number, number];
}

// The happy-path journey. Shipments stop part-way along it depending on their scenario.
// Events are normalised (and classified into journey stages) by packages/carriers, exactly as
// live events will be.
const JOURNEY: Step[] = [
  {
    leg: 1,
    rawStatus: "INFO_RECEIVED",
    rawMessage: "Shipment information received",
    location: "Shenzhen, CN",
    gap: [0, 0],
  },
  {
    leg: 1,
    rawStatus: "PICKED_UP",
    rawMessage: "Parcel received at 4PX Shenzhen sorting centre",
    location: "Shenzhen, CN",
    gap: [6, 30],
  },
  {
    leg: 1,
    rawStatus: "DEPARTED",
    rawMessage: "Departed from sorting centre",
    location: "Shenzhen, CN",
    gap: [4, 14],
  },
  {
    leg: 1,
    rawStatus: "FLIGHT_DEPARTED",
    rawMessage: "Departed from origin airport",
    location: "Shenzhen Bao'an Airport, CN",
    gap: [10, 34],
  },
  {
    leg: 1,
    rawStatus: "ARRIVED_DEST",
    rawMessage: "Arrived at destination airport",
    location: "Kansai Airport, JP",
    gap: [4, 7],
  },
  {
    leg: 1,
    rawStatus: "CUSTOMS_CLEARED",
    rawMessage: "Import customs clearance completed",
    location: "Osaka, JP",
    gap: [5, 28],
  },
  {
    leg: 1,
    rawStatus: "HANDOVER",
    rawMessage: "Handed over to last-mile carrier: Sagawa",
    location: "Osaka, JP",
    gap: [2, 10],
  },
  // Sagawa's transit scans normalise to IN_TRANSIT; the Shipment stays HANDED_OFF (ADR-0002).
  {
    leg: 2,
    rawStatus: "集荷",
    rawMessage: "荷物を受け付けました",
    location: "大阪営業所",
    gap: [2, 18],
  },
  {
    leg: 2,
    rawStatus: "輸送中",
    rawMessage: "輸送中です",
    location: "東京中継センター",
    gap: [6, 14],
  },
  {
    leg: 2,
    rawStatus: "配達中",
    rawMessage: "配達中です",
    location: "東京営業所",
    gap: [10, 30],
  },
  {
    leg: 2,
    rawStatus: "配達完了",
    rawMessage: "配達が完了しました",
    location: "東京営業所",
    gap: [1, 6],
  },
];
const HANDOFF_STEP = 6;
const between = ([min, max]: [number, number]) => min + random() * (max - min);

interface Scenario {
  name: string;
  count: number;
  /** Index into JOURNEY of the last event that has happened. */
  lastStep: number;
  /** How long ago the last event happened. */
  quietFor: () => number;
  /** What the domain should derive. The seed fails if it does not, which keeps fixtures honest. */
  status: ShipmentStatus;
  stuck?: boolean;
  tail?: Step[];
}

const recent = () => random() * 20 * HOUR;

const SCENARIOS: Scenario[] = [
  { name: "label created", count: 4, lastStep: 0, quietFor: recent, status: "PENDING" },
  { name: "picked up", count: 5, lastStep: 1, quietFor: recent, status: "SHIPPED" },
  { name: "in the air", count: 3, lastStep: 3, quietFor: recent, status: "IN_TRANSIT" },
  { name: "in Japan, clearing", count: 4, lastStep: 5, quietFor: recent, status: "IN_TRANSIT" },
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
  { name: "moving with Sagawa", count: 4, lastStep: 8, quietFor: recent, status: "HANDED_OFF" },
  {
    name: "out for delivery",
    count: 5,
    lastStep: 9,
    quietFor: () => random() * 8 * HOUR,
    status: "OUT_FOR_DELIVERY",
  },
  {
    name: "delivered",
    count: 11,
    lastStep: 10,
    quietFor: () => 1 * DAY + random() * 10 * DAY,
    status: "DELIVERED",
  },
  {
    name: "customs hold",
    count: 2,
    lastStep: 4,
    quietFor: () => 2 * DAY,
    status: "EXCEPTION",
    tail: [
      {
        leg: 1,
        rawStatus: "CUSTOMS_HOLD",
        rawMessage: "Held by customs: inspection required",
        location: "Osaka, JP",
        gap: [6, 20],
      },
    ],
  },
  {
    name: "address problem",
    count: 2,
    lastStep: 8,
    quietFor: () => 1 * DAY,
    status: "EXCEPTION",
    tail: [
      {
        leg: 2,
        rawStatus: "持戻",
        rawMessage: "住所不明のため持ち戻りました",
        location: "東京営業所",
        gap: [10, 30],
      },
    ],
  },
  {
    name: "returned",
    count: 2,
    lastStep: 8,
    quietFor: () => 3 * DAY,
    status: "RETURNED",
    tail: [
      {
        leg: 2,
        rawStatus: "持戻",
        rawMessage: "住所不明のため持ち戻りました",
        location: "東京営業所",
        gap: [10, 30],
      },
      {
        leg: 2,
        rawStatus: "返送",
        rawMessage: "差出人へ返送しました",
        location: "大阪営業所",
        gap: [24, 72],
      },
    ],
  },
];

/** Hours since the previous step, with the occasional slow customs check or late Sagawa pickup. */
function historyGap(step: Step, index: number): number {
  const base = between(step.gap);
  if (index === 5 && random() < 0.12) return base + 36 + random() * 60; // customs inspection
  if (index === 7 && random() < 0.18) return base + 20 + random() * 70; // Sagawa slow to scan
  if (index === 1 && random() < 0.1) return base + 24 + random() * 24; // pickup waited a day
  return base;
}

async function createJourney(input: {
  orderNumber: string;
  steps: Step[];
  times: number[];
  status: ShipmentStatus;
  stuck: boolean;
  now: number;
}) {
  const { steps, times } = input;
  const at = (s: number) => new Date(times[s]!);
  const handover = steps.findIndex((s) => s.rawStatus === "HANDOVER");
  const reachedLeg2 = handover >= 0;
  const handoffAt = at(Math.max(handover, 0));
  const lastAt = times.at(-1)!;
  const source: EventSource = "FAKE";

  const order = await prisma.order.create({
    data: {
      sourceSystem: "shopify",
      sourceOrderNumber: input.orderNumber,
      customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      destinationCountry: "JP",
      destinationPostcode: `${digits(3)}-${digits(4)}`,
      createdAt: new Date(times[0]! - 2 * HOUR),
    },
  });
  const shipment = await prisma.shipment.create({
    data: { orderId: order.id, createdAt: order.createdAt },
  });
  // 4PX numbers are "4PX" + 13 digits + "CN"; Sagawa's are 12 digits.
  const leg1 = await prisma.leg.create({
    data: {
      shipmentId: shipment.id,
      sequence: 1,
      carrierCode: "4PX",
      trackingNumber: `4PX300${digits(10)}CN`,
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
            input.status === "DELIVERED" || input.status === "RETURNED" ? new Date(lastAt) : null,
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
      normalisedStatus: normalise(step.leg === 2 ? "SAGAWA" : "4PX", step),
      source,
    })),
  });

  const { after } = await refreshShipment(prisma, shipment.id, new Date(input.now));
  if (after.status !== input.status || (after.stuckSince !== null) !== input.stuck) {
    throw new Error(
      `${input.orderNumber} expected ${input.status}${input.stuck ? " (stuck)" : ""}, ` +
        `domain derived ${after.status}${after.stuckSince ? " (stuck)" : ""}`,
    );
  }
}

const CUSTOMS_HOLD: Step = {
  leg: 1,
  rawStatus: "CUSTOMS_HOLD",
  rawMessage: "Held by customs: inspection required",
  location: "Osaka, JP",
  gap: [4, 12],
};
const ABSENT: Step = {
  leg: 2,
  rawStatus: "持戻",
  rawMessage: "ご不在のため持ち戻りました",
  location: "東京営業所",
  gap: [1, 4],
};
const REDELIVERY: Step = {
  leg: 2,
  rawStatus: "配達中",
  rawMessage: "配達中です",
  location: "東京営業所",
  gap: [18, 30],
};

/**
 * Eight weeks of finished journeys. Each one follows JOURNEY with realistic variation: some
 * customs inspections, some slow Sagawa pickups, some missed deliveries, and a few returns.
 */
async function seedHistory(now: number, count: number) {
  for (let i = 0; i < count; i++) {
    const roll = random();
    const returned = roll < 0.03;
    const missed = !returned && roll < 0.12;
    const held = random() < 0.08;
    const steps: Step[] = [];
    for (const [index, step] of JOURNEY.entries()) {
      if (index === 5 && held) steps.push(CUSTOMS_HOLD);
      if (returned && index === 9) {
        steps.push(SCENARIOS.at(-1)!.tail![0]!, SCENARIOS.at(-1)!.tail![1]!);
        break;
      }
      if (missed && index === 10) steps.push(ABSENT, REDELIVERY);
      steps.push(step);
    }
    const times: number[] = [];
    let at = now - (10 + random() * 46) * DAY;
    for (const [index, step] of steps.entries()) {
      const journeyIndex = JOURNEY.indexOf(step);
      let gap = journeyIndex >= 0 ? historyGap(step, journeyIndex) : between(step.gap);
      // After a customs hold, clearance takes a day or more.
      if (held && journeyIndex === 5) gap += 24 + random() * 48;
      at += index === 0 ? 0 : gap * HOUR;
      times.push(at);
    }
    // Keep every history parcel finished before today.
    const overshoot = times.at(-1)! - (now - 12 * HOUR);
    const shifted = overshoot > 0 ? times.map((t) => t - overshoot) : times;
    await createJourney({
      orderNumber: `DEMO-${20001 + i}`,
      steps,
      times: shifted,
      status: returned ? "RETURNED" : "DELIVERED",
      stuck: false,
      now,
    });
  }
}

async function main() {
  await prisma.$transaction([
    prisma.auditEntry.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.trackingLookup.deleteMany(),
    prisma.order.deleteMany(), // cascades to shipments, legs, handoffs, events
    prisma.carrier.deleteMany(),
  ]);

  await prisma.carrier.createMany({
    data: [
      { code: "4PX", name: "4PX Express", adapter: "fake", pollIntervalMinutes: 240 },
      { code: "SAGAWA", name: "Sagawa Express", adapter: "fake", pollIntervalMinutes: 240 },
    ],
  });

  // Users are upserted, not recreated, so existing sessions survive a reseed.
  for (const [email, role] of [
    ["admin@example.com", "ADMIN"],
    ["operator@example.com", "OPERATOR"],
    ["viewer@example.com", "VIEWER"],
  ] as const) {
    await prisma.user.upsert({ where: { email }, create: { email, role }, update: { role } });
  }

  const now = Date.now();
  let orderNumber = 10001;

  for (const scenario of SCENARIOS) {
    for (let i = 0; i < scenario.count; i++) {
      const steps = [...JOURNEY.slice(0, scenario.lastStep + 1), ...(scenario.tail ?? [])];
      const lastAt = now - scenario.quietFor();
      // Work backwards from the last event using each step's typical gap.
      const times: number[] = [lastAt];
      for (let s = steps.length - 1; s > 0; s--)
        times.unshift(times[0]! - between(steps[s]!.gap) * HOUR);
      await createJourney({
        orderNumber: `DEMO-${orderNumber++}`,
        steps,
        times,
        status: scenario.status,
        stuck: Boolean(scenario.stuck),
        now,
      });
    }
  }

  // Live demo: shipments whose tracking numbers are in the fake carrier's fixture. They start with
  // no events (so they count as stuck until checked); run `pnpm worker` to watch the worker fill
  // them in, including the Sagawa handoff.
  for (const [i, trackingNumber] of [
    "4PXDEMO0001CN",
    "4PXDEMO0002CN",
    "4PXDEMO0003CN",
    "4PXDEMO0004CN",
  ].entries()) {
    const startedAt = new Date(now - 8 * DAY);
    const order = await prisma.order.create({
      data: {
        sourceSystem: "shopify",
        sourceOrderNumber: `DEMO-LIVE-${i + 1}`,
        customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        destinationCountry: "JP",
        destinationPostcode: `${digits(3)}-${digits(4)}`,
        createdAt: startedAt,
        shipments: {
          create: {
            createdAt: startedAt,
            legs: { create: { sequence: 1, carrierCode: "4PX", trackingNumber, startedAt } },
          },
        },
      },
      include: { shipments: true },
    });
    await refreshShipment(prisma, order.shipments[0]!.id, new Date(now));
    orderNumber++;
  }

  await seedHistory(now, HISTORY_COUNT);

  await prisma.auditEntry.create({
    data: {
      entityType: "System",
      entityId: "seed",
      action: "SEED",
      actor: "system:seed",
      after: { orders: orderNumber - 10001, history: HISTORY_COUNT },
    },
  });

  const [orders, stuck] = await Promise.all([
    prisma.order.count(),
    prisma.shipment.count({ where: { stuckSince: { not: null } } }),
  ]);
  console.log(`Seeded ${orders} fake orders (${stuck} stuck, ${HISTORY_COUNT} finished history).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
