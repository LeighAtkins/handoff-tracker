import type { CarrierAdapter, DetectedHandoff, RawTrackingEvent } from "../adapter";

/** One event as an aggregator reports it, attributed to the carrier that produced it. */
export interface AttributedEvent extends RawTrackingEvent {
  /** Our carrier code (4PX, SAGAWA, ...), or null when the aggregator does not say. */
  carrierCode: string | null;
  /** The tracking number the event belongs to, when the aggregator says it differs. */
  trackingNumber: string | null;
}

export interface AggregatorResult {
  events: AttributedEvent[];
  /** The next carrier and its tracking number, if the aggregator knows about a handoff. */
  handoff: DetectedHandoff | null;
}

export interface AggregatorClient {
  name: string;
  track(trackingNumber: string, carrierCode: string): Promise<AggregatorResult>;
}

/** Aggregators name carriers their own way; this maps their codes and names to ours. */
export function carrierCodeFromAggregator(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/4px/i.test(value)) return "4PX";
  if (/sagawa|佐川/i.test(value)) return "SAGAWA";
  if (/yamato|ヤマト/i.test(value)) return "YAMATO";
  if (/japan.?post|jp.?post|日本郵便/i.test(value)) return "JAPANPOST";
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * The carrier that took over from `carrierCode`: one whose events continue after ours ended.
 * Aggregators list the whole journey, so a carrier reporting *before* ours is the previous Leg.
 */
export function nextCarrierAfter(
  events: AttributedEvent[],
  carrierCode: string,
): { carrierCode: string; trackingNumber: string | null } | null {
  const ours = events
    .filter((e) => e.carrierCode === carrierCode)
    .map((e) => e.occurredAt.getTime());
  const ourLatest = ours.length ? Math.max(...ours) : -Infinity;
  const later = events
    .filter(
      (e) => e.carrierCode && e.carrierCode !== carrierCode && e.occurredAt.getTime() >= ourLatest,
    )
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const next = later[0];
  return next ? { carrierCode: next.carrierCode!, trackingNumber: next.trackingNumber } : null;
}

/**
 * Wraps an aggregator as a CarrierAdapter for one of our carriers. Aggregators often return the
 * whole journey (4PX and Sagawa together) for either tracking number, so only events attributed
 * to this adapter's carrier (or unattributed ones) are kept for the Leg being polled.
 *
 * detectHandoff only receives the events, so the aggregator's handoff hint for each fetched
 * array is remembered in a WeakMap keyed by that array.
 */
export function createAggregatorAdapter(code: string, client: AggregatorClient): CarrierAdapter {
  const handoffs = new WeakMap<RawTrackingEvent[], DetectedHandoff | null>();
  return {
    code,
    async fetchEvents(trackingNumber) {
      const result = await client.track(trackingNumber, code);
      const events: RawTrackingEvent[] = result.events
        .filter((e) =>
          e.carrierCode
            ? e.carrierCode === code
            : e.trackingNumber === null || e.trackingNumber === trackingNumber,
        )
        .map(({ occurredAt, rawStatus, rawMessage, location }) => ({
          occurredAt,
          rawStatus,
          rawMessage,
          location,
        }));
      const handoff =
        result.handoff && result.handoff.nextCarrierCode !== code ? result.handoff : null;
      handoffs.set(events, handoff);
      return events;
    },
    detectHandoff(events) {
      return handoffs.get(events) ?? null;
    },
  };
}
