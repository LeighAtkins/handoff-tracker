import type { CarrierAdapter, DetectedHandoff, RawTrackingEvent } from "../adapter";

/** One event as an aggregator reports it, attributed to the carrier that produced it. */
export interface AttributedEvent extends RawTrackingEvent {
  /** Our carrier code (4PX, SAGAWA, ...), or null when the aggregator does not say. */
  carrierCode: string | null;
  /** The tracking number the event belongs to, when the aggregator says it differs. */
  trackingNumber: string | null;
}

/** What a provider says about the parcel beyond its events. Shown on the lookup page. */
export interface ShipmentFacts {
  originCountry?: string | null;
  destinationCountry?: string | null;
  /** The last-mile carrier and its number, which some providers know before the handover. */
  lastMile?: { carrierCode: string; trackingNumber: string } | null;
  /** The provider's own delivery estimate, if it gives one. */
  estimatedDelivery?: { from: Date | null; to: Date | null; source: string } | null;
  weightKg?: number | null;
  service?: string | null;
}

export interface AggregatorResult {
  events: AttributedEvent[];
  /** The next carrier and its tracking number, if the aggregator knows about a handoff. */
  handoff: DetectedHandoff | null;
  /**
   * PENDING: the provider accepted the number but has no results yet (register-then-poll).
   * NOT_FOUND: the provider does not know the number. Absent means READY.
   */
  state?: "READY" | "PENDING" | "NOT_FOUND";
  facts?: ShipmentFacts;
}

export interface AggregatorClient {
  name: string;
  track(trackingNumber: string, carrierCode: string): Promise<AggregatorResult>;
}

/** Aggregators name carriers their own way; this maps their codes and names to ours. */
export function carrierCodeFromAggregator(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/4px|递四方/i.test(value)) return "4PX";
  if (/sagawa|佐川/i.test(value)) return "SAGAWA";
  if (/yamato|taqbin|ヤマト/i.test(value)) return "YAMATO";
  if (/japan.?post|jp.?post|日本郵便/i.test(value)) return "JAPANPOST";
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Carriers in Japan report Japan time; 4PX and other Chinese carriers report China time. Used when
 * an aggregator gives a local time with no offset, so the handoff gap is not off by 8-9 hours.
 */
export function localOffsetFor(carrierCode: string | null, location?: string | null): string {
  if (carrierCode && ["SAGAWA", "YAMATO", "JAPANPOST"].includes(carrierCode)) return "+09:00";
  if (location && /japan|\bjp\b|osaka|tokyo|narita|kansai|haneda|nagoya|fukuoka/i.test(location))
    return "+09:00";
  return carrierCode === "4PX" ? "+08:00" : "Z";
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
