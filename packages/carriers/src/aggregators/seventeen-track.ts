import { z } from "zod";
import {
  carrierCodeFromAggregator,
  nextCarrierAfter,
  type AggregatorClient,
  type AttributedEvent,
} from "./aggregator";
import { requestJson, requireKey, type FetchLike } from "./http";

/** Response shape from POST /track/v2.4/gettrackinfo (https://api.17track.net/en/doc). */
const TrackInfoResponse = z.looseObject({
  code: z.number(),
  data: z.looseObject({
    accepted: z
      .array(
        z.looseObject({
          number: z.string(),
          track_info: z
            .looseObject({
              tracking: z
                .looseObject({
                  providers: z
                    .array(
                      z.looseObject({
                        provider: z
                          .looseObject({ key: z.number().nullish(), name: z.string().nullish() })
                          .nullish(),
                        events: z
                          .array(
                            z.looseObject({
                              time_iso: z.string().nullish(),
                              time_utc: z.string().nullish(),
                              description: z.string().nullish(),
                              location: z.string().nullish(),
                              stage: z.string().nullish(),
                              sub_status: z.string().nullish(),
                            }),
                          )
                          .nullish(),
                      }),
                    )
                    .nullish(),
                })
                .nullish(),
            })
            .nullish(),
        }),
      )
      .nullish(),
    rejected: z.array(z.looseObject({ number: z.string() })).nullish(),
  }),
});

const RegisterResponse = z.looseObject({
  data: z.looseObject({
    rejected: z
      .array(
        z.looseObject({
          number: z.string(),
          error: z
            .looseObject({ code: z.number().nullish(), message: z.string().nullish() })
            .nullish(),
        }),
      )
      .nullish(),
  }),
});

const ALREADY_REGISTERED = -18019901;

/**
 * 17TRACK carrier keys (https://res.17track.net/asset/carrier/info/apicarrier.all.json). Auto-detection
 * fails for 4PX's 12-digit numbers, so the key is always sent when known.
 */
const CARRIER_KEYS: Record<string, number> = { "4PX": 190094, SAGAWA: 100040 };

/**
 * 17TRACK is register-then-poll: a number must be registered once, after which 17TRACK tracks it
 * in the background. An unregistered number is registered and reported as "no events yet".
 * It returns origin and destination carriers as separate providers under the same number.
 */
export function createSeventeenTrackClient(
  options: { apiKey?: string; fetch?: FetchLike; baseUrl?: string } = {},
): AggregatorClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.17track.net/track/v2.4";
  const post = (path: string, body: unknown) =>
    requestJson("17TRACK", fetchImpl, `${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "17token": requireKey("SEVENTEEN_TRACK_API_KEY", options.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  return {
    name: "17TRACK",
    async track(trackingNumber, carrierCode) {
      const item = { number: trackingNumber, carrier: CARRIER_KEYS[carrierCode] };
      const response = TrackInfoResponse.parse(await post("/gettrackinfo", [item]));
      const accepted = response.data.accepted?.find((a) => a.number === trackingNumber);
      if (!accepted) {
        const registered = RegisterResponse.parse(await post("/register", [item]));
        const rejected = registered.data.rejected?.find((r) => r.number === trackingNumber);
        // Already registered (-18019901) but no events yet is the normal "wait" state.
        if (rejected && rejected.error?.code !== ALREADY_REGISTERED)
          throw new Error(`17TRACK rejected registration: ${rejected.error?.message ?? "unknown"}`);
        return { events: [], handoff: null };
      }

      const providers = accepted.track_info?.tracking?.providers ?? [];
      const events: AttributedEvent[] = providers.flatMap((p) =>
        (p.events ?? []).map((e) => ({
          occurredAt: new Date(e.time_utc ?? e.time_iso ?? 0),
          // Sub-statuses such as "InTransit_CustomsProcessing" keep only the main status.
          rawStatus: e.stage || e.sub_status?.split("_")[0] || "",
          rawMessage: e.description ?? "",
          location: e.location ?? null,
          carrierCode: carrierCodeFromAggregator(p.provider?.name),
          trackingNumber: null,
        })),
      );
      const next = nextCarrierAfter(events, carrierCode);
      // 17TRACK follows both carriers under the original number, so Leg n+1 reuses it.
      return {
        events,
        handoff: next
          ? { nextCarrierCode: next.carrierCode, nextTrackingNumber: trackingNumber }
          : null,
      };
    },
  };
}
