import { DomainError } from "./errors";
import { isTerminal, transition, type Status } from "./status";

export type HandoffSource = "CARRIER_EVENT" | "MANUAL" | "IMPORT";

export interface LegState {
  sequence: number;
  carrierCode: string;
  trackingNumber: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface HandoffState {
  fromSequence: number;
  toSequence: number;
  detectedAt: Date;
  source: HandoffSource;
}

export interface EventState {
  legSequence: number;
  occurredAt: Date;
  rawMessage: string;
  /** Null when the carrier message is not recognised yet. Such events never change status. */
  normalisedStatus: Status | null;
}

export interface ManualOverride {
  status: Status;
  reason: string;
  by: string;
  at: Date;
}

/** The Shipment aggregate as plain data. Legs, Handoffs and TrackingEvents only change through it. */
export interface ShipmentState {
  createdAt: Date;
  legs: LegState[];
  handoffs: HandoffState[];
  events: EventState[];
  override: ManualOverride | null;
  stuckResolvedAt: Date | null;
}

export interface StuckRules {
  /** Days without a new event before a Shipment counts as stuck. */
  quietDays: number;
  /** Used instead of quietDays while the receiving carrier has not reported anything since a Handoff. */
  quietDaysAfterHandoff: number;
}

export const DEFAULT_STUCK_RULES: StuckRules = { quietDays: 3, quietDaysAfterHandoff: 5 };

const DAY_MS = 24 * 60 * 60 * 1000;

export function createShipment(input: {
  createdAt: Date;
  carrierCode: string;
  trackingNumber: string;
}): ShipmentState {
  return {
    createdAt: input.createdAt,
    legs: [
      {
        sequence: 1,
        carrierCode: input.carrierCode,
        trackingNumber: input.trackingNumber,
        startedAt: input.createdAt,
        endedAt: null,
      },
    ],
    handoffs: [],
    events: [],
    override: null,
    stuckResolvedAt: null,
  };
}

export function currentLeg(state: ShipmentState): LegState {
  const leg = state.legs.at(-1);
  if (!leg) throw new DomainError("A Shipment always has at least one Leg");
  return leg;
}

export function lastEventAt(state: ShipmentState): Date | null {
  let latest: Date | null = null;
  for (const event of state.events) {
    if (!latest || event.occurredAt > latest) latest = event.occurredAt;
  }
  return latest;
}

/**
 * Status implied by the carrier history alone, ignoring any manual override.
 * Events are replayed in time order so late-arriving events land in the right place.
 * A Handoff counts as a HANDED_OFF report at the moment it was detected.
 */
export function derivedStatus(state: ShipmentState): Status {
  const reports: { at: Date; status: Status }[] = [];
  for (const event of state.events) {
    if (event.normalisedStatus)
      reports.push({ at: event.occurredAt, status: event.normalisedStatus });
  }
  for (const handoff of state.handoffs)
    reports.push({ at: handoff.detectedAt, status: "HANDED_OFF" });
  reports.sort((a, b) => a.at.getTime() - b.at.getTime());
  return reports.reduce<Status>((status, report) => transition(status, report.status), "PENDING");
}

/** The status staff see: the manual override if one is active, otherwise the derived status. */
export function currentStatus(state: ShipmentState): Status {
  return state.override?.status ?? derivedStatus(state);
}

function sameEvent(a: EventState, b: EventState): boolean {
  return (
    a.legSequence === b.legSequence &&
    a.occurredAt.getTime() === b.occurredAt.getTime() &&
    a.rawMessage === b.rawMessage
  );
}

/** Adds a TrackingEvent. Re-applying an event already in the history is a no-op, so polling is idempotent. */
export function applyEvent(state: ShipmentState, event: EventState): ShipmentState {
  if (!state.legs.some((leg) => leg.sequence === event.legSequence)) {
    throw new DomainError(`Shipment has no Leg ${event.legSequence}`);
  }
  if (state.events.some((existing) => sameEvent(existing, event))) return state;
  return { ...state, events: [...state.events, event] };
}

export function applyOverride(state: ShipmentState, override: ManualOverride): ShipmentState {
  if (!override.reason.trim()) throw new DomainError("A manual status override needs a reason");
  if (!override.by.trim()) throw new DomainError("A manual status override needs an actor");
  return { ...state, override: { ...override, reason: override.reason.trim() } };
}

export function clearOverride(state: ShipmentState): ShipmentState {
  if (!state.override) throw new DomainError("There is no manual override to clear");
  return { ...state, override: null };
}

/**
 * Passes responsibility from the current Leg's carrier to a new Leg n+1.
 * Closes the current Leg and records an explicit Handoff connecting the two.
 */
export function recordHandoff(
  state: ShipmentState,
  input: { carrierCode: string; trackingNumber: string; at: Date; source: HandoffSource },
): ShipmentState {
  const from = currentLeg(state);
  if (isTerminal(currentStatus(state))) {
    throw new DomainError("Cannot hand off a Shipment that is already delivered or returned");
  }
  if (!input.trackingNumber.trim())
    throw new DomainError("A Handoff needs the new tracking number");
  if (
    state.legs.some(
      (leg) => leg.carrierCode === input.carrierCode && leg.trackingNumber === input.trackingNumber,
    )
  ) {
    throw new DomainError(
      `${input.carrierCode} ${input.trackingNumber} is already a Leg of this Shipment`,
    );
  }
  if (input.at < from.startedAt) {
    throw new DomainError("A Handoff cannot happen before the current Leg started");
  }

  const to: LegState = {
    sequence: from.sequence + 1,
    carrierCode: input.carrierCode,
    trackingNumber: input.trackingNumber.trim(),
    startedAt: input.at,
    endedAt: null,
  };
  return {
    ...state,
    legs: [...state.legs.slice(0, -1), { ...from, endedAt: input.at }, to],
    handoffs: [
      ...state.handoffs,
      {
        fromSequence: from.sequence,
        toSequence: to.sequence,
        detectedAt: input.at,
        source: input.source,
      },
    ],
  };
}

/**
 * When the current quiet period started, and which threshold applies to it.
 * Straight after a Handoff the receiving carrier often lags, so the longer threshold applies
 * until the new Leg reports its first event.
 */
function quietPeriod(state: ShipmentState, rules: StuckRules): { since: Date; days: number } {
  const lastEvent = lastEventAt(state);
  const handoff = state.handoffs.at(-1);
  if (handoff) {
    const newLegHasReported = state.events.some(
      (event) => event.legSequence === handoff.toSequence && event.occurredAt >= handoff.detectedAt,
    );
    if (!newLegHasReported) {
      const since = lastEvent && lastEvent > handoff.detectedAt ? lastEvent : handoff.detectedAt;
      return { since, days: rules.quietDaysAfterHandoff };
    }
  }
  return { since: lastEvent ?? state.createdAt, days: rules.quietDays };
}

/**
 * The moment the Shipment became stuck, or null if it is not stuck.
 * Delivered and returned Shipments are never stuck. Marking a stuck Shipment resolved clears it
 * until a new event starts a fresh quiet period that runs past the threshold again.
 */
export function stuckSince(
  state: ShipmentState,
  now: Date,
  rules: StuckRules = DEFAULT_STUCK_RULES,
): Date | null {
  const since = stuckDeadline(state, rules);
  if (!since || now < since) return null;
  if (state.stuckResolvedAt && state.stuckResolvedAt >= since) return null;
  return since;
}

/**
 * When the current quiet period runs past its threshold, i.e. when the Shipment will count as
 * stuck if nothing new arrives. Null for delivered and returned Shipments.
 */
export function stuckDeadline(
  state: ShipmentState,
  rules: StuckRules = DEFAULT_STUCK_RULES,
): Date | null {
  if (isTerminal(currentStatus(state))) return null;
  const quiet = quietPeriod(state, rules);
  return new Date(quiet.since.getTime() + quiet.days * DAY_MS);
}

export function isStuck(
  state: ShipmentState,
  now: Date,
  rules: StuckRules = DEFAULT_STUCK_RULES,
): boolean {
  return stuckSince(state, now, rules) !== null;
}

/** Whole days since the last event (or since the Shipment was created, if nothing has arrived yet). */
export function daysQuiet(state: ShipmentState, now: Date): number {
  const since = lastEventAt(state) ?? state.createdAt;
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

/** An operator has dealt with a stuck Shipment, e.g. chased the carrier. */
export function markResolved(
  state: ShipmentState,
  at: Date,
  rules: StuckRules = DEFAULT_STUCK_RULES,
): ShipmentState {
  if (!isStuck(state, at, rules))
    throw new DomainError("Only a stuck Shipment can be marked resolved");
  return { ...state, stuckResolvedAt: at };
}
