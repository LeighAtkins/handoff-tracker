import type { Stage } from "@handoff/domain";
import type { RawTrackingEvent } from "./adapter";
import { fourPxStage } from "./fourpx/codes";

/**
 * Classifies carrier events into journey stages (milestones and problems, see
 * packages/domain/src/journey.ts), the same way the normaliser maps them to statuses. Most events
 * carry no stage ("in transit", "arrived at hub"), and that is fine: stages only mark the points
 * worth timing and the problems worth acting on.
 */
export type StageRule =
  | { rawStatus: string; stage: Stage }
  | { message: RegExp; stage: Stage }
  /** For code families too large to list. Returns undefined for codes that are not its own. */
  | { codes: (rawStatus: string) => Stage | null | undefined };

const code = (rawStatus: string, stage: Stage): StageRule => ({ rawStatus, stage });

/** Our fake carrier's codes. Real 4PX business link codes are classified in fourpx/codes.ts. */
const FAKE_FOURPX_CODES: StageRule[] = [
  code("INFO_RECEIVED", "LABEL_CREATED"),
  code("PICKED_UP", "PICKED_UP"),
  code("FLIGHT_DEPARTED", "DEPARTED_ORIGIN"),
  code("ARRIVED_DEST", "ARRIVED_DESTINATION"),
  code("CUSTOMS_CLEARED", "CUSTOMS_CLEARED"),
  code("CUSTOMS_HOLD", "CUSTOMS_HOLD"),
  code("HANDOVER", "HANDED_OFF"),
];

/**
 * Status codes the aggregators attach to events (17TRACK sub_status and stage, Ship24 statusCode
 * and statusMilestone, AfterShip subtag and checkpoint event codes). Exact matches; codes whose
 * meaning the docs leave unclear are left to the wording rules instead.
 */
const AGGREGATOR_CODES: StageRule[] = [
  // 17TRACK sub_status
  code("InfoReceived", "LABEL_CREATED"),
  code("InTransit_PickedUp", "PICKED_UP"),
  code("InTransit_Departure", "DEPARTED_ORIGIN"),
  code("InTransit_Arrival", "ARRIVED_DESTINATION"),
  code("InTransit_CustomsReleased", "CUSTOMS_CLEARED"),
  code("InTransit_CustomsRequiringInformation", "CUSTOMS_HOLD"),
  code("DeliveryFailure_InvalidAddress", "ADDRESS_PROBLEM"),
  code("Exception_Returning", "RETURNING"),
  code("Exception_Returned", "RETURNED"),
  code("Exception_Delayed", "DELAYED"),
  // 17TRACK milestone stages
  code("PickedUp", "PICKED_UP"),
  code("Departure", "DEPARTED_ORIGIN"),
  code("Arrival", "ARRIVED_DESTINATION"),
  code("AvailableForPickup", "AWAITING_PICKUP"),
  code("OutForDelivery", "OUT_FOR_DELIVERY"),
  code("Delivered", "DELIVERED"),
  code("Returning", "RETURNING"),
  code("Returned", "RETURNED"),
  // Ship24 statusCode
  code("data_order_created", "LABEL_CREATED"),
  code("data_order_cancelled", "EXCEPTION"),
  code("transit_handover", "PICKED_UP"),
  code("transit_origin_country_departure", "DEPARTED_ORIGIN"),
  code("destination_arrival", "ARRIVED_DESTINATION"),
  code("customs_cleared", "CUSTOMS_CLEARED"),
  code("customs_exception", "CUSTOMS_HOLD"),
  code("customs_rejected", "CUSTOMS_HOLD"),
  code("delivery_available_for_pickup", "AWAITING_PICKUP"),
  code("delivery_out_for_delivery", "OUT_FOR_DELIVERY"),
  code("delivery_attempted", "DELIVERY_FAILED"),
  code("delivery_refused", "DELIVERY_FAILED"),
  code("delivery_exception", "EXCEPTION"),
  code("delivery_delivered", "DELIVERED"),
  code("exception_return", "RETURNING"),
  code("exception_lost", "EXCEPTION"),
  code("exception_discarded", "EXCEPTION"),
  // Ship24 statusMilestone
  code("info_received", "LABEL_CREATED"),
  code("out_for_delivery", "OUT_FOR_DELIVERY"),
  code("available_for_pickup", "AWAITING_PICKUP"),
  code("failed_attempt", "DELIVERY_FAILED"),
  code("delivered", "DELIVERED"),
  // AfterShip subtags and checkpoint event codes
  code("InfoReceived_001", "LABEL_CREATED"),
  code("InTransit_002", "PICKED_UP"),
  code("InTransit_004", "ARRIVED_DESTINATION"),
  code("InTransit_011", "CUSTOMS_CLEARED"),
  code("Exception_010", "RETURNING"),
  code("Exception_011", "RETURNED"),
  code("handed_over_to_last_mile_carrier", "HANDED_OFF"),
  code("received_by_last_mile_carrier", "LAST_MILE_ACCEPTED"),
];

/** 17TRACK and AfterShip sub-status families not listed above. */
const AGGREGATOR_FAMILIES: [RegExp, Stage][] = [
  [/^(DeliveryFailure_[A-Za-z]+|AttemptFail_\d{3})$/, "DELIVERY_FAILED"],
  [/^(OutForDelivery)_(\w+)$/, "OUT_FOR_DELIVERY"],
  [/^(AvailableForPickup)_(\w+)$/, "AWAITING_PICKUP"],
  [/^(Delivered)_(\w+)$/, "DELIVERED"],
  [/^Exception_\w+$/, "EXCEPTION"],
];
const aggregatorFamilies: StageRule = {
  codes: (rawStatus) => AGGREGATOR_FAMILIES.find(([family]) => family.test(rawStatus))?.[1],
};

/**
 * English wording, for carriers and aggregators that only send text. Order matters: problems and
 * later milestones come first, so "returned to sender" never reads as "delivered".
 */
const ENGLISH: StageRule[] = [
  { message: /returned to (the )?(sender|shipper)|delivered to (the )?sender/i, stage: "RETURNED" },
  { message: /return(ing|ed)? to (the )?(sender|shipper)|being returned/i, stage: "RETURNING" },
  {
    message: /held by customs|customs (hold|inspection|detention)|detained by customs/i,
    stage: "CUSTOMS_HOLD",
  },
  {
    message:
      /address (unknown|problem|incorrect|incomplete)|(incorrect|wrong|insufficient) address/i,
    stage: "ADDRESS_PROBLEM",
  },
  {
    message:
      /delivery attempt|attempted delivery|not at home|recipient (was )?(not available|absent)|unable to deliver|delivery (failed|unsuccessful)|failed delivery/i,
    stage: "DELIVERY_FAILED",
  },
  {
    message:
      /available for (pick ?up|collection)|ready for (pick ?up|collection)|awaiting collection/i,
    stage: "AWAITING_PICKUP",
  },
  { message: /out for delivery|with (the )?delivery (driver|courier)/i, stage: "OUT_FOR_DELIVERY" },
  { message: /\bdelivered\b|delivery (completed|successful)|signed for/i, stage: "DELIVERED" },
  {
    message:
      /hand(ed)? ?over to (the )?(last[- ]mile|local|destination|delivery)|transferred to (the )?(last[- ]mile|local|destination) (carrier|courier)|handed to (sagawa|yamato|japan post)/i,
    stage: "HANDED_OFF",
  },
  {
    message:
      /(?<!export )customs (clearance )?(completed|released|cleared)|cleared (import )?customs|released (by|from) customs/i,
    stage: "CUSTOMS_CLEARED",
  },
  {
    message:
      /arriv\w* (at|in) (the )?destination|arriv\w* in japan|arriv\w* at (the )?(kansai|narita|haneda|osaka|tokyo)/i,
    stage: "ARRIVED_DESTINATION",
  },
  {
    message:
      /depart\w* (from )?(the )?(origin|country of origin)|(flight|aircraft) (has )?departed|left (the )?(origin|country of origin)/i,
    stage: "DEPARTED_ORIGIN",
  },
  {
    message:
      /picked up|parcel (received|collected)|received (at|by) (the )?(4px |origin )?(facility|warehouse|sorting cent(re|er))|arrived at (the )?4px/i,
    stage: "PICKED_UP",
  },
  {
    message: /information received|label created|pre-?advice|order (created|information)/i,
    stage: "LABEL_CREATED",
  },
];

/** Sagawa reports in Japanese. Address problems are checked before 持戻 (brought back), which both use. */
const SAGAWA: StageRule[] = [
  { message: /返送中/, stage: "RETURNING" },
  { message: /返送|差出人へ/, stage: "RETURNED" },
  { message: /住所不明|宛所不明|転居/, stage: "ADDRESS_PROBLEM" },
  { message: /不在|持戻|持ち戻/, stage: "DELIVERY_FAILED" },
  { message: /調査中/, stage: "EXCEPTION" },
  { message: /保管中|お預かり|営業所止め/, stage: "AWAITING_PICKUP" },
  { message: /配達(が)?完了|お届け済|配達済/, stage: "DELIVERED" },
  { message: /配達中|配達に出/, stage: "OUT_FOR_DELIVERY" },
  { message: /集荷|受け付け|受付|引受/, stage: "LAST_MILE_ACCEPTED" },
];

export type StageTable = Record<string, StageRule[]>;

const AGGREGATORS = [...AGGREGATOR_CODES, aggregatorFamilies];

export const DEFAULT_STAGE_TABLE: StageTable = {
  "4PX": [{ codes: fourPxStage }, ...FAKE_FOURPX_CODES, ...AGGREGATORS, ...ENGLISH],
  SAGAWA: [...SAGAWA, ...AGGREGATORS, ...ENGLISH],
};
const FALLBACK = [...AGGREGATORS, ...ENGLISH];

/** On the last-mile Leg, a "first scan" stage means the receiving carrier has accepted the parcel. */
const LAST_MILE_ACCEPTANCE: ReadonlySet<Stage> = new Set([
  "LABEL_CREATED",
  "PICKED_UP",
  "DEPARTED_ORIGIN",
  "ARRIVED_DESTINATION",
  "HANDED_OFF",
]);

export function createStageClassifier(table: StageTable = DEFAULT_STAGE_TABLE) {
  return function classifyStage(
    carrierCode: string,
    event: Pick<RawTrackingEvent, "rawStatus" | "rawMessage">,
    legSequence = 1,
  ): Stage | null {
    const stage = firstMatch(table[carrierCode] ?? FALLBACK, event);
    return stage && legSequence > 1 && LAST_MILE_ACCEPTANCE.has(stage)
      ? "LAST_MILE_ACCEPTED"
      : stage;
  };
}

function firstMatch(
  rules: StageRule[],
  event: Pick<RawTrackingEvent, "rawStatus" | "rawMessage">,
): Stage | null {
  const status = event.rawStatus.toLowerCase();
  for (const rule of rules) {
    if ("codes" in rule) {
      const stage = rule.codes(event.rawStatus);
      if (stage !== undefined) return stage;
    } else if ("rawStatus" in rule) {
      if (rule.rawStatus.toLowerCase() === status) return rule.stage;
    } else if (rule.message.test(event.rawMessage) || rule.message.test(event.rawStatus)) {
      return rule.stage;
    }
  }
  return null;
}

export const classifyStage = createStageClassifier();
