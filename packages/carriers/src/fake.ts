import { z } from "zod";
import type { CarrierAdapter, DetectedHandoff, RawTrackingEvent } from "./adapter";
import fixtureJson from "../fixtures/fake-journeys.json" with { type: "json" };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const FixtureSchema = z.object({
  journeys: z.array(
    z.object({
      carrierCode: z.string(),
      trackingNumber: z.string(),
      events: z.array(
        z.object({
          offsetHours: z.number(),
          rawStatus: z.string(),
          rawMessage: z.string(),
          location: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export type FakeFixture = z.infer<typeof FixtureSchema>;

export const defaultFixture: FakeFixture = FixtureSchema.parse(fixtureJson);

export interface FakeAdapterOptions {
  fixture?: FakeFixture;
  now?: () => Date;
  /**
   * Fixture offsets are relative to this moment. Defaults to midnight UTC three days ago,
   * so the demo journeys are always part-way through whenever you look.
   */
  anchor?: Date;
}

function defaultAnchor(now: Date): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - 3 * DAY_MS);
}

/** Matches the fixture's handover message, e.g. "Handed over to last-mile carrier: Sagawa (900000000101)". */
const HANDOVER = /handed over to last-mile carrier:\s*(\w+)\s*\((\w+)\)/i;

/**
 * Deterministic fake carrier driven by a JSON fixture. Only events whose time has come are
 * returned, so repeated polling reveals a journey step by step, including quiet periods.
 */
export function createFakeAdapter(code: string, options: FakeAdapterOptions = {}): CarrierAdapter {
  const fixture = options.fixture ?? defaultFixture;
  const now = options.now ?? (() => new Date());

  return {
    code,
    async fetchEvents(trackingNumber) {
      const current = now();
      const anchor = options.anchor ?? defaultAnchor(current);
      const journey = fixture.journeys.find(
        (j) => j.carrierCode === code && j.trackingNumber === trackingNumber,
      );
      if (!journey) return [];
      return journey.events
        .map((e): RawTrackingEvent => ({
          occurredAt: new Date(anchor.getTime() + e.offsetHours * HOUR_MS),
          rawStatus: e.rawStatus,
          rawMessage: e.rawMessage,
          location: e.location,
        }))
        .filter((e) => e.occurredAt <= current);
    },
    detectHandoff(events): DetectedHandoff | null {
      for (const event of [...events].reverse()) {
        const match = HANDOVER.exec(event.rawMessage);
        if (match)
          return { nextCarrierCode: match[1]!.toUpperCase(), nextTrackingNumber: match[2]! };
      }
      return null;
    },
  };
}
