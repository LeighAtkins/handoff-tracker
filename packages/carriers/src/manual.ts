import type { CarrierAdapter, RawTrackingEvent } from "./adapter";

/**
 * For carriers with no API (P2: no scraping). There is nothing to fetch: an operator checks the
 * carrier themselves and records what they saw as a TrackingEvent with source=MANUAL.
 */
export function createManualAdapter(code: string): CarrierAdapter {
  return {
    code,
    async fetchEvents() {
      return [];
    },
  };
}

export function manualEvent(input: {
  occurredAt: Date;
  message: string;
  location?: string | null;
}): RawTrackingEvent {
  return {
    occurredAt: input.occurredAt,
    rawStatus: "MANUAL",
    rawMessage: input.message.trim(),
    location: input.location?.trim() || null,
  };
}
