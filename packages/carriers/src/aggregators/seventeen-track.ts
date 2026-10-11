import { z } from "zod";
import {
  carrierCodeFromAggregator,
  nextCarrierAfter,
  type AggregatorClient,
  type AttributedEvent,
  type ShipmentFacts,
} from "./aggregator";
import { requestJson, requireKey, type FetchLike } from "./http";

const Event = z.looseObject({
  time_iso: z.string().nullish(),
  time_utc: z.string().nullish(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  stage: z.string().nullish(),
  sub_status: z.string().nullish(),
});

const Country = z.looseObject({ country: z.string().nullish() }).nullish();

/** Response shape from POST /track/v2.4/gettrackinfo (https://api.17track.net/en/doc?version=v2.4). */
const TrackInfoResponse = z.looseObject({
  code: z.number(),
  data: z.looseObject({
    accepted: z
      .array(
        z.looseObject({
          number: z.string(),
          track_info: z
            .looseObject({
              shipping_info: z
                .looseObject({ shipper_address: Country, recipient_address: Country })
                .nullish(),
              time_metrics: z
                .looseObject({
                  estimated_delivery_date: z
                    .looseObject({
                      source: z.string().nullish(),
                      from: z.string().nullish(),
                      to: z.string().nullish(),
                    })
                    .nullish(),
                })
                .nullish(),
              // local_* name the last-mile carrier and its own tracking number.
              misc_info: z
                .looseObject({
                  service_type: z.string().nullish(),
                  weight_kg: z.union([z.number(), z.string()]).nullish(),
                  local_number: z.string().nullish(),
                  local_provider: z.string().nullish(),
                  local_key: z.number().nullish(),
                })
                .nullish(),
              tracking: z
                .looseObject({
                  providers: z
                    .array(
                      z.looseObject({
                        provider: z
                          .looseObject({ key: z.number().nullish(), name: z.string().nullish() })
                          .nullish(),
                        events: z.array(Event).nullish(),
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
/** Keys are stable where provider names ("Sagawa (佐川急便)") are not. */
const CARRIERS_BY_KEY: Record<number, string> = {
  190094: "4PX",
  100040: "SAGAWA",
  100041: "SAGAWA", // SGH Global (Sagawa Global)
  100062: "YAMATO",
  10021: "JAPANPOST",
};

const carrierFor = (key: number | null | undefined, name: string | null | undefined) =>
  (key ? CARRIERS_BY_KEY[key] : undefined) ?? carrierCodeFromAggregator(name);

const date = (value: string | null | undefined) => (value ? new Date(value) : null);

/**
 * 17TRACK is register-then-poll: a number must be registered once, after which 17TRACK tracks it
 * in the background. An unregistered number is registered and reported as pending.
 * It returns origin and destination carriers as separate providers under the same number, and
 * names the last-mile carrier's own number in misc_info.local_number when it knows it.
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
        return { events: [], handoff: null, state: "PENDING" };
      }

      const info = accepted.track_info;
      const providers = info?.tracking?.providers ?? [];
      const events: AttributedEvent[] = providers.flatMap((p) =>
        (p.events ?? []).map((e) => ({
          occurredAt: new Date(e.time_utc ?? e.time_iso ?? 0),
          // Sub-statuses such as "InTransit_CustomsReleased" say more than the stage alone.
          rawStatus: e.sub_status || e.stage || "",
          rawMessage: e.description ?? "",
          location: e.location ?? null,
          carrierCode: carrierFor(p.provider?.key, p.provider?.name),
          trackingNumber: null,
        })),
      );

      const misc = info?.misc_info;
      const localCarrier = carrierFor(misc?.local_key, misc?.local_provider);
      const lastMile =
        misc?.local_number && localCarrier && localCarrier !== carrierCode
          ? { carrierCode: localCarrier, trackingNumber: misc.local_number }
          : null;
      const estimate = info?.time_metrics?.estimated_delivery_date;
      const weight = Number(misc?.weight_kg);
      const facts: ShipmentFacts = {
        originCountry: info?.shipping_info?.shipper_address?.country || null,
        destinationCountry: info?.shipping_info?.recipient_address?.country || null,
        lastMile,
        estimatedDelivery:
          estimate?.from || estimate?.to
            ? {
                from: date(estimate.from),
                to: date(estimate.to),
                source: estimate.source ?? "17TRACK",
              }
            : null,
        weightKg: Number.isFinite(weight) && weight > 0 ? weight : null,
        service: misc?.service_type || null,
      };

      // A handoff needs evidence that the next carrier has reported. Its own number, when 17TRACK
      // knows it, is what staff need; otherwise 17TRACK follows both carriers under ours.
      const next = nextCarrierAfter(events, carrierCode);
      return {
        events,
        handoff: next
          ? {
              nextCarrierCode: next.carrierCode,
              nextTrackingNumber:
                lastMile?.carrierCode === next.carrierCode
                  ? lastMile.trackingNumber
                  : trackingNumber,
            }
          : null,
        facts,
      };
    },
  };
}
