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
