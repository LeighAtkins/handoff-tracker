import type { Status } from "@handoff/domain";
import type { RawTrackingEvent } from "./adapter";

/** Matches against rawStatus (exact, case-insensitive) or rawMessage (regex). First match wins. */
export type MappingRule =
  { rawStatus: string; status: Status } | { message: RegExp; status: Status };

export type MappingTable = Record<string, MappingRule[]>;

/**
 * Fallback for carriers without their own table. Order matters: more specific phrases first,
 * e.g. "out for delivery" must win over "delivery".
 */
const GENERIC: MappingRule[] = [
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
    { rawStatus: "INFO_RECEIVED", status: "PENDING" },
    { rawStatus: "PICKED_UP", status: "SHIPPED" },
    { rawStatus: "DEPARTED", status: "IN_TRANSIT" },
    { rawStatus: "ARRIVED_DEST", status: "IN_TRANSIT" },
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
      if ("rawStatus" in rule) {
        if (rule.rawStatus.toLowerCase() === event.rawStatus.toLowerCase()) return rule.status;
      } else if (rule.message.test(event.rawMessage) || rule.message.test(event.rawStatus)) {
        return rule.status;
      }
    }
    return null;
  };
}

export const normalise = createNormaliser();
