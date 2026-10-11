import { classifyStage } from "@handoff/carriers";
import {
  analyseJourney,
  buildBenchmarks,
  currentStatus,
  journeyInsights,
  stuckDeadline,
  stuckSince,
  type Benchmarks,
  type Insight,
  type JourneyAnalysis,
  type JourneyInput,
  type ShipmentState,
} from "@handoff/domain";
import {
  shipmentAggregateInclude,
  toShipmentState,
  type PrismaClient,
  type ShipmentAggregateRow,
} from "@handoff/db";

/** A journey ready to show: milestones and timings, plus what staff should know about it. */
export interface JourneyView {
  input: JourneyInput;
  analysis: JourneyAnalysis;
  insights: Insight[];
  stuckSince: Date | null;
  stuckDeadline: Date | null;
}

/** A tracked Shipment as a journey. Stages are classified on read, so mapping fixes apply to old events too. */
export function journeyInputFromShipment(row: ShipmentAggregateRow): JourneyInput {
  const state = toShipmentState(row);
  return {
    legs: row.legs.map((leg) => ({
      sequence: leg.sequence,
      carrierCode: leg.carrierCode,
      trackingNumber: leg.trackingNumber,
    })),
    handoffs: state.handoffs.map((h) => ({ toSequence: h.toSequence, at: h.detectedAt })),
    events: row.legs.flatMap((leg) =>
      leg.events.map((event) => ({
        at: event.occurredAt,
        legSequence: leg.sequence,
        carrierCode: leg.carrierCode,
        stage: classifyStage(leg.carrierCode, event, leg.sequence),
        message: event.rawMessage,
        location: event.location,
      })),
    ),
    status: currentStatus(state),
  };
}

export function viewJourney(
  input: JourneyInput,
  state: ShipmentState,
  context: { benchmarks: Benchmarks; now: Date },
): JourneyView {
  const analysis = analyseJourney(input, context.now);
  const since = stuckSince(state, context.now);
  const deadline = stuckDeadline(state);
  return {
    input,
    analysis,
    insights: journeyInsights(analysis, { ...context, stuckSince: since, stuckDeadline: deadline }),
    stuckSince: since,
    stuckDeadline: deadline,
  };
}

export function shipmentJourney(
  row: ShipmentAggregateRow,
  context: { benchmarks: Benchmarks; now: Date },
): JourneyView {
  return viewJourney(journeyInputFromShipment(row), toShipmentState(row), context);
}

/**
 * Typical time per segment and door to door, learnt from every Shipment tracked here. This is the
 * "usual" that insights and delivery estimates compare against.
 */
export async function loadBenchmarks(prisma: PrismaClient, now = new Date()): Promise<Benchmarks> {
  const rows = await prisma.shipment.findMany({ include: shipmentAggregateInclude });
  return buildBenchmarks(rows.map((row) => analyseJourney(journeyInputFromShipment(row), now)));
}
