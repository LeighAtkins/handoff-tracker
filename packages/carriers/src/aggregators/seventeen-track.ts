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
      const response = TrackInfoResponse.parse(
        await post("/gettrackinfo", [{ number: trackingNumber }]),
      );
      const accepted = response.data.accepted?.find((a) => a.number === trackingNumber);
      if (!accepted) {
        await post("/register", [{ number: trackingNumber }]);
        return { events: [], handoff: null };
      }

      const providers = accepted.track_info?.tracking?.providers ?? [];
      const events: AttributedEvent[] = providers.flatMap((p) =>
        (p.events ?? []).map((e) => ({
          occurredAt: new Date(e.time_utc ?? e.time_iso ?? 0),
          rawStatus: e.stage || e.sub_status || "",
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
