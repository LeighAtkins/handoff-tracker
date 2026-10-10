import { z } from "zod";
import {
  carrierCodeFromAggregator,
  nextCarrierAfter,
  type AggregatorClient,
  type AttributedEvent,
} from "./aggregator";
import { requestJson, requireKey, type FetchLike } from "./http";

/** Response shape from POST /public/v1/trackers/track (https://docs.ship24.com). Unknown fields are ignored. */
const Ship24Response = z.looseObject({
  data: z.looseObject({
    trackings: z.array(
      z.looseObject({
        shipment: z
          .looseObject({
            statusMilestone: z.string().nullish(),
            trackingNumbers: z.array(z.looseObject({ tn: z.string() })).nullish(),
          })
          .nullish(),
        events: z
          .array(
            z.looseObject({
              status: z.string().nullish(),
              occurrenceDatetime: z.string(),
              datetime: z.string().nullish(),
              utcOffset: z.string().nullish(),
              location: z.string().nullish(),
              courierCode: z.string().nullish(),
              eventTrackingNumber: z.string().nullish(),
              statusCode: z.string().nullish(),
              statusMilestone: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    ),
  }),
});

/** Ship24 gives local wall-clock time plus, when known, a UTC offset or a full ISO datetime. */
export function ship24Time(event: {
  occurrenceDatetime: string;
  datetime?: string | null;
  utcOffset?: string | null;
}): Date {
  if (event.datetime && /[zZ]|[+-]\d{2}:?\d{2}$/.test(event.datetime))
    return new Date(event.datetime);
  const local = event.occurrenceDatetime;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return new Date(local);
  return new Date(`${local}${event.utcOffset ?? "Z"}`);
}

export function createShip24Client(
  options: { apiKey?: string; fetch?: FetchLike; baseUrl?: string } = {},
): AggregatorClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.ship24.com";
  return {
    name: "SHIP24",
    async track(trackingNumber, carrierCode) {
      const json = await requestJson("SHIP24", fetchImpl, `${baseUrl}/public/v1/trackers/track`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${requireKey("SHIP24_API_KEY", options.apiKey)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ trackingNumber }),
      });
      const tracking = Ship24Response.parse(json).data.trackings[0];
      const events: AttributedEvent[] = (tracking?.events ?? []).map((e) => ({
        occurredAt: ship24Time(e),
        rawStatus: e.statusCode || e.statusMilestone || "",
        rawMessage: e.status ?? "",
        location: e.location ?? null,
        carrierCode: carrierCodeFromAggregator(e.courierCode),
        trackingNumber: e.eventTrackingNumber ?? null,
      }));

      // A handoff shows up as a later courier reporting under its own tracking number.
      const next = nextCarrierAfter(events, carrierCode);
      return {
        events,
        handoff:
          next?.trackingNumber && next.trackingNumber !== trackingNumber
            ? { nextCarrierCode: next.carrierCode, nextTrackingNumber: next.trackingNumber }
            : null,
      };
    },
  };
}
