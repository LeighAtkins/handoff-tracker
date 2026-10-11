import { z } from "zod";
import type { AggregatorClient, AggregatorResult, AttributedEvent } from "./aggregators/aggregator";
import { fourPxStage } from "./fourpx/codes";
import fixtureJson from "../fixtures/sample-lookups.json" with { type: "json" };

const HOUR_MS = 60 * 60 * 1000;

const SampleSchema = z.object({
  samples: z.array(
    z.object({
      trackingNumber: z.string(),
      scenario: z.string(),
      lastMile: z.object({ carrierCode: z.string(), trackingNumber: z.string() }).nullable(),
      facts: z.object({
        originCountry: z.string(),
        destinationCountry: z.string(),
        weightKg: z.number(),
      }),
      events: z.array(
        z.object({
          offsetHours: z.number(),
          carrierCode: z.string(),
          rawStatus: z.string(),
          rawMessage: z.string(),
          location: z.string().nullable(),
        }),
      ),
    }),
  ),
});

export type SampleFixture = z.infer<typeof SampleSchema>;

export const sampleFixture: SampleFixture = SampleSchema.parse(fixtureJson);

/** The sample tracking numbers, with the scenario each one shows. */
export const SAMPLE_NUMBERS = sampleFixture.samples.map((s) => ({
  trackingNumber: s.trackingNumber,
  scenario: s.scenario,
}));

/**
 * Invented journeys for the lookup page, written with real 4PX business link codes and Sagawa's
 * own wording, so the page can be shown before any API key is set. Times are relative to now.
 * It only knows its own DEMO numbers: anything else is NOT_FOUND, never made up.
 */
export function createSampleClient(
  options: { fixture?: SampleFixture; now?: () => Date } = {},
): AggregatorClient {
  const fixture = options.fixture ?? sampleFixture;
  const now = options.now ?? (() => new Date());
  return {
    name: "SAMPLE",
    async track(trackingNumber): Promise<AggregatorResult> {
      const sample = fixture.samples.find(
        (s) => s.trackingNumber.toUpperCase() === trackingNumber.toUpperCase(),
      );
      if (!sample) return { events: [], handoff: null, state: "NOT_FOUND" };
      const at = now().getTime();
      const events: AttributedEvent[] = sample.events.map((e) => ({
        occurredAt: new Date(at + e.offsetHours * HOUR_MS),
        rawStatus: e.rawStatus,
        rawMessage: e.rawMessage,
        location: e.location,
        carrierCode: e.carrierCode,
        trackingNumber:
          e.carrierCode === "4PX"
            ? sample.trackingNumber
            : (sample.lastMile?.trackingNumber ?? null),
      }));
      const handedOver = events.some((e) => fourPxStage(e.rawStatus) === "HANDED_OFF");
      return {
        events,
        handoff:
          sample.lastMile && handedOver
            ? {
                nextCarrierCode: sample.lastMile.carrierCode,
                nextTrackingNumber: sample.lastMile.trackingNumber,
              }
            : null,
        facts: { ...sample.facts, lastMile: sample.lastMile },
      };
    },
  };
}

export function isSampleNumber(trackingNumber: string): boolean {
  return SAMPLE_NUMBERS.some((s) => s.trackingNumber === trackingNumber.toUpperCase());
}
