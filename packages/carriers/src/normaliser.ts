import type { Status } from "@handoff/domain";
import type { RawTrackingEvent } from "./adapter";
import { fourPxStatus } from "./fourpx/codes";

/**
 * Matches against rawStatus (exact, case-insensitive), rawMessage (regex), or a code family
 * (a function returning undefined for codes that are not its own). First match wins.
 */
export type MappingRule =
  | { rawStatus: string; status: Status }
  | { message: RegExp; status: Status }
  | { codes: (rawStatus: string) => Status | null | undefined };

/**
 * 17TRACK sub-statuses ("InTransit_CustomsReleased") and AfterShip subtags ("AttemptFail_002"):
 * the part before the underscore is the main status, with a few sub-statuses that matter.
 */
const SUB_STATUS =
  /^(InfoReceived|Pending|InTransit|AvailableForPickup|OutForDelivery|DeliveryFailure|AttemptFail|Delivered|Exception|Expired|NotFound)_(\w+)$/;
const MAIN_STATUS: Record<string, Status | null> = {
  InfoReceived: "PENDING",
  Pending: "PENDING",
  InTransit: "IN_TRANSIT",
  AvailableForPickup: "OUT_FOR_DELIVERY",
  OutForDelivery: "OUT_FOR_DELIVERY",
  DeliveryFailure: "EXCEPTION",
  AttemptFail: "EXCEPTION",
  Delivered: "DELIVERED",
  Exception: "EXCEPTION",
  Expired: null,
  NotFound: null,
};
const SPECIAL_SUB_STATUS: Record<string, Status> = {
  InTransit_PickedUp: "SHIPPED",
  InTransit_002: "SHIPPED", // AfterShip: accepted by the carrier
  InTransit_CustomsRequiringInformation: "EXCEPTION",
  Exception_Returning: "RETURNED",
  Exception_Returned: "RETURNED",
  Exception_010: "RETURNED", // AfterShip: returning to sender
  Exception_011: "RETURNED", // AfterShip: returned to sender
  Exception_Delayed: "IN_TRANSIT",
};

/** Ship24 status codes and AfterShip's handover event codes. */
const AGGREGATOR_CODES: Record<string, Status> = {
  data_order_created: "PENDING",
  data_order_cancelled: "EXCEPTION",
  transit_origin_country_departure: "IN_TRANSIT",
  destination_arrival: "IN_TRANSIT",
  customs_received: "IN_TRANSIT",
  customs_cleared: "IN_TRANSIT",
  customs_exception: "EXCEPTION",
  customs_rejected: "EXCEPTION",
  delivery_available_for_pickup: "OUT_FOR_DELIVERY",
  delivery_out_for_delivery: "OUT_FOR_DELIVERY",
  delivery_attempted: "EXCEPTION",
  delivery_refused: "EXCEPTION",
  delivery_exception: "EXCEPTION",
  delivery_delivered: "DELIVERED",
  exception_return: "RETURNED",
  exception_lost: "EXCEPTION",
  exception_discarded: "EXCEPTION",
  handed_over_to_last_mile_carrier: "HANDED_OFF",
  received_by_last_mile_carrier: "IN_TRANSIT",
};

export function aggregatorCode(rawStatus: string): Status | null | undefined {
  const exact = AGGREGATOR_CODES[rawStatus];
  if (exact) return exact;
  const match = SUB_STATUS.exec(rawStatus);
  if (!match) return undefined;
  return SPECIAL_SUB_STATUS[rawStatus] ?? MAIN_STATUS[match[1]!];
}

export type MappingTable = Record<string, MappingRule[]>;

/**
 * Fallback for carriers without their own table. Order matters: more specific phrases first,
 * e.g. "out for delivery" must win over "delivery".
 */
const GENERIC: MappingRule[] = [
  // Precise aggregator codes come before wording, which would read "Exception_Returning" as an
  // exception rather than a return.
  { codes: aggregatorCode },
  { message: /return(ed)? to sender|returned/i, status: "RETURNED" },
  {
    message:
      /exception|held by customs|customs hold|failed|undeliverable|address (unknown|problem)/i,
    status: "EXCEPTION",
  },
  { message: /out for delivery/i, status: "OUT_FOR_DELIVERY" },
  { message: /delivered/i, status: "DELIVERED" },
  { message: /handed over|transferred to|handover/i, status: "HANDED_OFF" },
  {
    message: /arrived|departed|in transit|customs (cleared|clearance)|processed/i,
    status: "IN_TRANSIT",
  },
  { message: /picked up|collected|accepted/i, status: "SHIPPED" },
  { message: /information received|label created|pre-?advice/i, status: "PENDING" },
  // Aggregator status codes (Ship24 milestones, 17TRACK stages, AfterShip tags), used when the
  // message text itself is not recognised.
  ...(
    [
      ["info_received", "PENDING"],
      ["InfoReceived", "PENDING"],
      ["pending", "PENDING"],
      ["PickedUp", "SHIPPED"],
      ["transit_handover", "SHIPPED"],
      ["in_transit", "IN_TRANSIT"],
      ["InTransit", "IN_TRANSIT"],
      ["Departure", "IN_TRANSIT"],
      ["Arrival", "IN_TRANSIT"],
      ["out_for_delivery", "OUT_FOR_DELIVERY"],
      ["OutForDelivery", "OUT_FOR_DELIVERY"],
      ["available_for_pickup", "OUT_FOR_DELIVERY"],
      ["AvailableForPickup", "OUT_FOR_DELIVERY"],
      ["delivered", "DELIVERED"],
      ["failed_attempt", "EXCEPTION"],
      ["AttemptFail", "EXCEPTION"],
      ["DeliveryFailure", "EXCEPTION"],
      ["exception", "EXCEPTION"],
      ["Returning", "RETURNED"],
      ["Returned", "RETURNED"],
    ] as const
  ).map(([rawStatus, status]) => ({ rawStatus, status })),
];

export const DEFAULT_MAPPINGS: MappingTable = {
  "4PX": [
    // 4PX Open Platform business link codes (FPX_D_STPP, ...), see fourpx/codes.ts.
    { codes: fourPxStatus },
    // Our fake carrier's codes.
    { rawStatus: "INFO_RECEIVED", status: "PENDING" },
    { rawStatus: "PICKED_UP", status: "SHIPPED" },
    { rawStatus: "DEPARTED", status: "IN_TRANSIT" },
    { rawStatus: "FLIGHT_DEPARTED", status: "IN_TRANSIT" },
    { rawStatus: "ARRIVED_DEST", status: "IN_TRANSIT" },
    { rawStatus: "CUSTOMS_CLEARED", status: "IN_TRANSIT" },
    { rawStatus: "HANDOVER", status: "HANDED_OFF" },
    { rawStatus: "CUSTOMS_HOLD", status: "EXCEPTION" },
    ...GENERIC,
  ],
  // Sagawa reports in Japanese. Problems (持戻: brought back) are checked before transit words.
  SAGAWA: [
    { message: /返送|差出人/, status: "RETURNED" },
    { message: /持戻|住所不明|不在|調査中/, status: "EXCEPTION" },
    { message: /配達(が)?完了|お届け済|配達済/, status: "DELIVERED" },
    { message: /配達中|配達に出/, status: "OUT_FOR_DELIVERY" },
    { message: /輸送中|中継|到着|発送|受け付け|受付|集荷/, status: "IN_TRANSIT" },
    { rawStatus: "集荷", status: "IN_TRANSIT" },
    ...GENERIC,
  ],
};

export function createNormaliser(table: MappingTable = DEFAULT_MAPPINGS) {
  return function normalise(
    carrierCode: string,
    event: Pick<RawTrackingEvent, "rawStatus" | "rawMessage">,
  ): Status | null {
    const rules = table[carrierCode] ?? GENERIC;
    for (const rule of rules) {
      if ("codes" in rule) {
        const status = rule.codes(event.rawStatus);
        if (status !== undefined) return status;
      } else if ("rawStatus" in rule) {
        if (rule.rawStatus.toLowerCase() === event.rawStatus.toLowerCase()) return rule.status;
      } else if (rule.message.test(event.rawMessage) || rule.message.test(event.rawStatus)) {
        return rule.status;
      }
    }
    return null;
  };
}

export const normalise = createNormaliser();
