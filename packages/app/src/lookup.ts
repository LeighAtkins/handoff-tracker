import {
  classifyStage,
  createSampleClient,
  isSampleNumber,
  normalise,
  trackingProviders,
  type AggregatorClient,
  type AggregatorResult,
  type AttributedEvent,
  type DetectedHandoff,
  type ShipmentFacts,
} from "@handoff/carriers";
import {
  derivedStatus,
  type JourneyEvent,
  type JourneyInput,
  type ShipmentState,
  type Stage,
} from "@handoff/domain";
import type { LookupState, Prisma, PrismaClient } from "@handoff/db";
import { writeAudit, type Actor } from "./audit";

export type LookupOutcome = LookupState | "NO_PROVIDER";

export interface LookupResult {
  trackingNumber: string;
  /** Who answered: 4PX, SHIP24, 17TRACK, AFTERSHIP or SAMPLE. */
  provider: string | null;
  state: LookupOutcome;
  fetchedAt: Date | null;
  error: string | null;
  events: AttributedEvent[];
  handoff: DetectedHandoff | null;
  facts: ShipmentFacts | null;
  fromCache: boolean;
  /** The tracked Shipment that already uses this number, if any. */
  shipment: { id: string; orderNumber: string } | null;
}

/** How long a stored answer is reused before asking the provider again, by outcome. */
export const FRESH_MINUTES: Record<LookupState, number> = {
  READY: 15,
  PENDING: 1,
  NOT_FOUND: 10,
  ERROR: 1,
};

/** Spaces and hyphens are common when numbers are copied from emails; anything else is rejected. */
export function normaliseTrackingNumber(input: string): string | null {
  const value = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{6,40}$/.test(value) ? value : null;
}

/** Which carrier a number belongs to. 12-digit numbers are Sagawa's on the routes we use (ADR-0003). */
export function carrierForNumber(trackingNumber: string): string {
  return /^\d{12}$/.test(trackingNumber) ? "SAGAWA" : "4PX";
}

interface Candidate {
  name: string;
  client: AggregatorClient;
}

/**
 * Looks up any tracking number, live, without importing it: sample numbers from the sample
 * journeys, real ones from 4PX's own API first, then the aggregators, in that order. The answer
 * is stored so a reload within FRESH_MINUTES costs no API call.
 */
export async function lookupTracking(
  prisma: PrismaClient,
  input: { trackingNumber: string; actor: Actor; refresh?: boolean },
  options: { candidates?: Candidate[]; now?: Date } = {},
): Promise<LookupResult> {
  const now = options.now ?? new Date();
  const trackingNumber = input.trackingNumber;
  const shipment = await trackedShipment(prisma, trackingNumber);
  const candidates = options.candidates ?? defaultCandidates(trackingNumber);
  const empty = {
    trackingNumber,
    events: [],
    handoff: null,
    facts: null,
    fromCache: false,
    shipment,
  };
  if (!candidates.length) {
    return { ...empty, provider: null, state: "NO_PROVIDER", fetchedAt: null, error: null };
  }

  const stored = await prisma.trackingLookup.findUnique({ where: { trackingNumber } });
  const fresh =
    stored &&
    now.getTime() - stored.fetchedAt.getTime() < FRESH_MINUTES[stored.state] * 60_000 &&
    candidates.some((c) => c.name === stored.provider);
  if (stored && fresh && !input.refresh) {
    await prisma.trackingLookup.update({
      where: { trackingNumber },
      data: { lookedUpAt: now, lookedUpBy: input.actor },
    });
    return { ...fromStored(stored), fromCache: true, shipment };
  }

  const answer = await askProviders(candidates, trackingNumber);
  const row = {
    provider: answer.provider,
    state: answer.state,
    result: toJson(answer.result),
    error: answer.error,
    fetchedAt: now,
    lookedUpBy: input.actor,
    lookedUpAt: now,
  };
  await prisma.$transaction(async (tx) => {
    await tx.trackingLookup.upsert({
      where: { trackingNumber },
      create: { trackingNumber, ...row },
      update: row,
    });
    await writeAudit(tx, {
      entityType: "Lookup",
      entityId: trackingNumber,
      action: "TRACKING_LOOKED_UP",
      actor: input.actor,
      after: {
        provider: answer.provider,
        state: answer.state,
        events: answer.result?.events.length ?? 0,
      },
    });
  });
  return {
    ...empty,
    provider: answer.provider,
    state: answer.state,
    fetchedAt: now,
    error: answer.error,
    events: answer.result?.events ?? [],
    handoff: answer.result?.handoff ?? null,
    facts: answer.result?.facts ?? null,
  };
}

function defaultCandidates(trackingNumber: string): Candidate[] {
  if (isSampleNumber(trackingNumber)) return [{ name: "SAMPLE", client: createSampleClient() }];
  return trackingProviders()
    .filter((p) => p.configured)
    .map((p) => ({ name: p.name, client: p.client }));
}

/**
 * Asks each provider in turn until one has events. A provider that is still fetching (17TRACK
 * after registering, a brand-new Ship24 tracker) makes the lookup PENDING unless a later one
 * already knows the number.
 */
async function askProviders(candidates: Candidate[], trackingNumber: string) {
  const carrierCode = carrierForNumber(trackingNumber);
  let pending: { provider: string; result: AggregatorResult } | null = null;
  let notFound: string | null = null;
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const result = await candidate.client.track(trackingNumber, carrierCode);
      if (result.state === "NOT_FOUND") {
        notFound ??= candidate.name;
      } else if (result.state === "PENDING" || result.events.length === 0) {
        pending ??= { provider: candidate.name, result };
      } else {
        return { provider: candidate.name, state: "READY" as const, result, error: null };
      }
    } catch (error) {
      errors.push(`${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (pending) return { ...pending, state: "PENDING" as const, error: null };
  if (notFound)
    return { provider: notFound, state: "NOT_FOUND" as const, result: null, error: null };
  return {
    provider: candidates[0]!.name,
    state: "ERROR" as const,
    result: null,
    error: errors.join("; ").slice(0, 1000),
  };
}

async function trackedShipment(prisma: PrismaClient, trackingNumber: string) {
  const leg = await prisma.leg.findFirst({
    where: { trackingNumber },
    include: { shipment: { include: { order: true } } },
    orderBy: { startedAt: "desc" },
  });
  return leg ? { id: leg.shipmentId, orderNumber: leg.shipment.order.sourceOrderNumber } : null;
}

/** Dates become ISO strings in JSON; this reverses it when reading a stored lookup back. */
interface StoredResult {
  events: (Omit<AttributedEvent, "occurredAt"> & { occurredAt: string })[];
  handoff: DetectedHandoff | null;
  facts:
    | (Omit<ShipmentFacts, "estimatedDelivery"> & {
        estimatedDelivery?: { from: string | null; to: string | null; source: string } | null;
      })
    | null;
}

function toJson(result: AggregatorResult | null): Prisma.InputJsonValue | undefined {
  if (!result) return undefined;
  return JSON.parse(
    JSON.stringify({ events: result.events, handoff: result.handoff, facts: result.facts ?? null }),
  ) as Prisma.InputJsonValue;
}

function fromStored(row: {
  trackingNumber: string;
  provider: string;
  state: LookupState;
  result: Prisma.JsonValue;
  error: string | null;
  fetchedAt: Date;
}): Omit<LookupResult, "fromCache" | "shipment"> {
  const result = row.result as StoredResult | null;
  const date = (value: string | null | undefined) => (value ? new Date(value) : null);
  const estimate = result?.facts?.estimatedDelivery;
  return {
    trackingNumber: row.trackingNumber,
    provider: row.provider,
    state: row.state,
    fetchedAt: row.fetchedAt,
    error: row.error,
    events: (result?.events ?? []).map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
    handoff: result?.handoff ?? null,
    facts: result?.facts
      ? {
          ...result.facts,
          estimatedDelivery: estimate
            ? { from: date(estimate.from), to: date(estimate.to), source: estimate.source }
            : null,
        }
      : null,
  };
}

/** Stages the last-mile carrier is responsible for, even when 4PX is the one reporting them. */
const LAST_MILE_STAGES: ReadonlySet<Stage> = new Set([
  "LAST_MILE_ACCEPTED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "DELIVERY_FAILED",
  "ADDRESS_PROBLEM",
  "AWAITING_PICKUP",
]);

/**
 * A looked-up journey in the same shape as a tracked Shipment, so the same analysis, insights
 * and screens apply. Leg 2 exists once the provider shows the last-mile carrier at work: its own
 * events, or 4PX's reports of what the last-mile carrier did after the handover.
 */
export function lookupJourney(
  result: LookupResult,
  now: Date,
): { input: JourneyInput; state: ShipmentState } {
  const firstCarrier = carrierForNumber(result.trackingNumber);
  const sorted = [...result.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const stageOf = (e: AttributedEvent, leg: number) =>
    classifyStage(e.carrierCode ?? firstCarrier, e, leg);
  const handedOverAt = sorted.find((e) => stageOf(e, 1) === "HANDED_OFF")?.occurredAt ?? null;

  const otherCarrier = sorted.find((e) => e.carrierCode && e.carrierCode !== firstCarrier);
  const lastMileCarrier = result.handoff?.nextCarrierCode ?? otherCarrier?.carrierCode ?? null;
  const lastMileNumber =
    result.handoff?.nextTrackingNumber ??
    otherCarrier?.trackingNumber ??
    (result.facts?.lastMile?.carrierCode === lastMileCarrier
      ? result.facts?.lastMile?.trackingNumber
      : null) ??
    result.trackingNumber;

  const events: (JourneyEvent & { status: ReturnType<typeof normalise> })[] = sorted.map((e) => {
    const reportedBy = e.carrierCode ?? firstCarrier;
    const byLastMile = Boolean(lastMileCarrier) && reportedBy === lastMileCarrier;
    const firstLegStage = stageOf(e, 1);
    // 4PX keeps reporting after the handover (FPX_O_RR, FPX_D_SD, FPX_S_OK): that is Sagawa's work.
    const onLastMile =
      byLastMile ||
      (Boolean(lastMileCarrier) &&
        handedOverAt !== null &&
        e.occurredAt >= handedOverAt &&
        firstLegStage !== null &&
        LAST_MILE_STAGES.has(firstLegStage));
    const legSequence = onLastMile ? 2 : 1;
    return {
      at: e.occurredAt,
      legSequence,
      carrierCode: onLastMile ? lastMileCarrier! : firstCarrier,
      stage: byLastMile ? stageOf(e, 2) : firstLegStage,
      message: e.rawMessage,
      location: e.location,
      status: normalise(reportedBy, e),
    };
  });

  const legs = [
    { sequence: 1, carrierCode: firstCarrier, trackingNumber: result.trackingNumber },
    ...(lastMileCarrier
      ? [{ sequence: 2, carrierCode: lastMileCarrier, trackingNumber: lastMileNumber }]
      : []),
  ];
  const firstLastMileAt = events.find((e) => e.legSequence === 2)?.at ?? null;
  const handoffAt = handedOverAt ?? firstLastMileAt;
  const handoffs = lastMileCarrier && handoffAt ? [{ toSequence: 2, at: handoffAt }] : [];
  const createdAt = events[0]?.at ?? result.fetchedAt ?? now;

  const state: ShipmentState = {
    createdAt,
    legs: legs.map((leg) => ({
      ...leg,
      startedAt: leg.sequence === 1 ? createdAt : (handoffAt ?? createdAt),
      endedAt: leg.sequence === 1 && handoffAt ? handoffAt : null,
    })),
    handoffs: handoffs.map((h) => ({
      fromSequence: 1,
      toSequence: 2,
      detectedAt: h.at,
      source: "CARRIER_EVENT" as const,
    })),
    events: events.map((e) => ({
      legSequence: e.legSequence,
      occurredAt: e.at,
      rawMessage: e.message,
      normalisedStatus: e.status,
    })),
    override: null,
    stuckResolvedAt: null,
  };
  return {
    input: {
      legs,
      handoffs,
      events: events.map((e) => ({
        at: e.at,
        legSequence: e.legSequence,
        carrierCode: e.carrierCode,
        stage: e.stage,
        message: e.message,
        location: e.location,
      })),
      status: derivedStatus(state),
    },
    state,
  };
}

/** The most recent lookups, newest first, for the lookup page. */
export async function recentLookups(prisma: PrismaClient, take = 8) {
  return prisma.trackingLookup.findMany({
    orderBy: { lookedUpAt: "desc" },
    take,
    select: {
      trackingNumber: true,
      provider: true,
      state: true,
      lookedUpAt: true,
      lookedUpBy: true,
    },
  });
}
