/**
 * Anti-corruption layer between carriers/aggregators and the Tracking context.
 * Adapters only translate: they never touch the database or decide status transitions.
 */
export interface RawTrackingEvent {
  occurredAt: Date;
  rawStatus: string;
  rawMessage: string;
  location: string | null;
}

export interface DetectedHandoff {
  nextCarrierCode: string;
  nextTrackingNumber: string;
}

export interface CarrierAdapter {
  code: string;
  fetchEvents(trackingNumber: string): Promise<RawTrackingEvent[]>;
  /** Optional: some carriers/aggregators report the next carrier's tracking number. */
  detectHandoff?(events: RawTrackingEvent[]): DetectedHandoff | null;
}

/** Thrown when a carrier or aggregator asks us to slow down (HTTP 429). */
export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  constructor(
    readonly carrierCode: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(
      `${carrierCode} rate limited${retryAfterSeconds ? `; retry after ${retryAfterSeconds}s` : ""}`,
    );
  }
}
