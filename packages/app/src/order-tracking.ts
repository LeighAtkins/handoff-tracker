import { classifyStage, type ShipmentFacts } from "@handoff/carriers";
import { DEFAULT_STUCK_RULES } from "@handoff/domain";
import type { PrismaClient, ShipmentStatus } from "@handoff/db";

/**
 * Tracking per order for other local tools (Inbox Brain's Flow drafts customer replies with it).
 * A stable, read-only contract: it carries no names, addresses or phone numbers, and its shape
 * does not follow the database schema.
 */
export interface OrderTracking {
  order: string;
  shipments: ShipmentTracking[];
}

export type TrackingStatus =
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "awaiting_pickup"
  | "delivered"
  | "exception"
  | "returned";

export interface ShipmentTracking {
  carrier: string;
  tracking_number: string;
  /** A public page a customer can open. Null when the carrier has none we can link to. */
  tracking_url: string | null;
  last_mile_carrier: string | null;
  last_mile_tracking_number: string | null;
  last_mile_tracking_url: string | null;
  status: TrackingStatus;
  delivered_at: string | null;
  /** Never set: no source we use shows who signed publicly. Kept for the contract. */
  signed_by: null;
  last_event: { at: string; message: string; location: string | null } | null;
  eta: string | null;
  stuck: { since: string; reason: string } | null;
  /** When a source last answered for this parcel. Null if never checked. */
  checked_at: string | null;
}

const CARRIER_NAMES: Record<string, string> = {
  "4PX": "4PX",
  SAGAWA: "Sagawa Express",
  TAKESEND: "UPS (via Takesend)",
  SFEXPRESS: "SF Express",
  FEDEX: "FedEx",
  YAMATO: "Yamato Transport",
  JAPANPOST: "Japan Post",
};

const carrierName = (code: string) =>
  CARRIER_NAMES[code] ??
  code
    .split("_")
    .map((w) => (w.length <= 4 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");

/** Public tracking pages, by carrier code (4PX names last-mile carriers in its own words). */
const TRACKING_URLS: [RegExp, (n: string) => string][] = [
  [/^4PX$/, (n) => `https://track.4px.com/#/result/0/${n}`],
  [/^SAGAWA$/, (n) => `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${n}`],
  [/^(TAKESEND|UPS)/, (n) => `https://www.ups.com/track?tracknum=${n}`],
  [/^FEDEX/, (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`],
  // SF's public page has no link that opens one waybill; the customer pastes the number.
  [/^SF/, () => "https://www.sf-international.com/my/en/support/querySupport/waybill"],
  [/^USPS/, (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`],
  [/DHL/, (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`],
  [/LA_POSTE|COLISSIMO/, (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`],
  [/ROYAL_MAIL/, (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`],
  [/EVRI|HERMES/, (n) => `https://www.evri.com/track/parcel/${n}`],
  [
    /CANADA_POST/,
    (n) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${n}`,
  ],
  [/AUSTRALIA_POST|AUSPOST/, (n) => `https://auspost.com.au/mypost/track/details/${n}`],
  [
    /^JAPANPOST$/,
    (n) =>
      `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${n}&locale=en`,
  ],
];

export function trackingUrl(carrierCode: string, trackingNumber: string): string | null {
  const match = TRACKING_URLS.find(([pattern]) => pattern.test(carrierCode));
  return match ? match[1](trackingNumber) : null;
}

/**
 * The stored order number for what a caller typed: "126362" and "#126362" are Shopify orders
 * (stored with "#"), "CW-339312" is a Comfort Works order. Null for anything else.
 */
export function orderNumberFrom(input: string): string | null {
  const value = decodeURIComponent(input).trim().toUpperCase();
  if (/^#?\d{4,8}$/.test(value)) return `#${value.replace("#", "")}`;
  if (/^CW-?\d{4,8}$/.test(value)) return `CW-${value.replace(/^CW-?/, "")}`;
  return null;
}

const STATUS: Record<ShipmentStatus, TrackingStatus> = {
  PENDING: "label_created",
  SHIPPED: "label_created",
  IN_TRANSIT: "in_transit",
  HANDED_OFF: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  EXCEPTION: "exception",
  RETURNED: "returned",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Tracking for several orders in two queries. Orders we do not have are left out. */
export async function trackingForOrders(
  prisma: PrismaClient,
  orderNumbers: string[],
  now = new Date(),
): Promise<OrderTracking[]> {
  const orders = await prisma.order.findMany({
    where: { sourceOrderNumber: { in: orderNumbers } },
    include: {
      shipments: {
        orderBy: { createdAt: "asc" },
        include: {
          legs: {
            orderBy: { sequence: "asc" },
            include: { events: { orderBy: { occurredAt: "desc" }, take: 1 } },
          },
        },
      },
    },
  });
  return orderNumbers.flatMap((number) => {
    const order = orders.find((o) => o.sourceOrderNumber === number);
    return order
      ? [{ order: number, shipments: order.shipments.map((s) => shipmentTracking(s, now)) }]
      : [];
  });
}

/** The stored fields this view reads, as loaded by trackingForOrders. */
interface ShipmentRow {
  status: ShipmentStatus;
  overrideStatus: ShipmentStatus | null;
  createdAt: Date;
  lastEventAt: Date | null;
  stuckSince: Date | null;
  legs: {
    sequence: number;
    carrierCode: string;
    trackingNumber: string;
    lastCheckedAt: Date | null;
    facts: unknown;
    /** The newest event only. */
    events: { occurredAt: Date; rawStatus: string; rawMessage: string; location: string | null }[];
  }[];
}

function shipmentTracking(shipment: ShipmentRow, now: Date): ShipmentTracking {
  const first = shipment.legs[0]!;
  const current = shipment.legs.at(-1)!;
  // Stored as JSON, so dates inside are ISO strings.
  const facts = (first.facts ?? null) as
    | (Omit<ShipmentFacts, "estimatedDelivery"> & {
        estimatedDelivery?: { from: string | null } | null;
      })
    | null;
  const lastMile =
    shipment.legs[1] ??
    (facts?.lastMile && facts.lastMile.carrierCode !== first.carrierCode
      ? { carrierCode: facts.lastMile.carrierCode, trackingNumber: facts.lastMile.trackingNumber }
      : null);
  // NOMS often holds the last-mile number on a 4PX parcel; 4PX's own number is then in the facts.
  const ownNumber =
    lastMile?.trackingNumber === first.trackingNumber
      ? (facts?.fourPxNumber ?? first.trackingNumber)
      : first.trackingNumber;

  // The newest event across legs.
  const latest = shipment.legs
    .flatMap((leg) => leg.events.map((e) => ({ ...e, leg })))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

  const stored = shipment.overrideStatus ?? shipment.status;
  let status = STATUS[stored];
  if (latest && status !== "delivered" && status !== "returned") {
    const stage = classifyStage(latest.leg.carrierCode, latest, latest.leg.sequence);
    // SF's "Awaiting Pickup" means SF has not collected it from us, not a pickup point.
    if (latest.leg.carrierCode === "SFEXPRESS" && /awaiting pick ?up/i.test(latest.rawStatus)) {
      status = "label_created";
    } else if (stage === "AWAITING_PICKUP") {
      status = "awaiting_pickup";
    }
  }

  const eta = status === "delivered" ? null : (facts?.estimatedDelivery?.from ?? null);
  const checked = shipment.legs
    .map((leg) => leg.lastCheckedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    carrier: carrierName(first.carrierCode),
    tracking_number: ownNumber,
    tracking_url: trackingUrl(first.carrierCode, ownNumber),
    last_mile_carrier: lastMile ? carrierName(lastMile.carrierCode) : null,
    last_mile_tracking_number: lastMile?.trackingNumber ?? null,
    last_mile_tracking_url: lastMile
      ? (trackingUrl(lastMile.carrierCode, lastMile.trackingNumber) ??
        facts?.lastMileContact?.website ??
        null)
      : null,
    status,
    delivered_at: status === "delivered" ? iso(latest?.occurredAt ?? shipment.lastEventAt) : null,
    signed_by: null,
    last_event: latest
      ? {
          at: latest.occurredAt.toISOString(),
          message: latest.rawMessage,
          location: latest.location,
        }
      : null,
    eta,
    stuck: shipment.stuckSince
      ? { since: shipment.stuckSince.toISOString(), reason: stuckReason(shipment, current, now) }
      : null,
    checked_at: iso(checked),
  };
}

function stuckReason(
  shipment: ShipmentRow,
  current: ShipmentRow["legs"][number],
  now: Date,
): string {
  const days = (from: Date) => Math.floor((now.getTime() - from.getTime()) / DAY_MS);
  if (!shipment.lastEventAt) {
    return `No carrier scan in the ${days(shipment.createdAt)} days since it shipped.`;
  }
  const quiet = days(shipment.lastEventAt);
  if (current.sequence > 1 && current.events.length === 0) {
    return `Handed to ${carrierName(current.carrierCode)} but no scan from them in ${quiet} days.`;
  }
  if (shipment.status === "OUT_FOR_DELIVERY") {
    return `Out for delivery for ${quiet} days (we expect delivery within ${DEFAULT_STUCK_RULES.quietDaysOutForDelivery ?? DEFAULT_STUCK_RULES.quietDays}).`;
  }
  return `No new scan in ${quiet} days.`;
}
