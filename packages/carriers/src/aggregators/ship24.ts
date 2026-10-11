import { z } from "zod";
import {
  carrierCodeFromAggregator,
  localOffsetFor,
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
            originCountryCode: z.string().nullish(),
            destinationCountryCode: z.string().nullish(),
            delivery: z
              .looseObject({
                estimatedDeliveryDate: z.string().nullish(),
                courierEstimatedDeliveryDate: z
                  .looseObject({ from: z.string().nullish(), to: z.string().nullish() })
                  .nullish(),
                service: z.string().nullish(),
              })
              .nullish(),
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

/**
 * Ship24's occurrenceDatetime is the carrier's local time, with an offset or "Z" when known.
 * Without one, `fallbackOffset` (the carrier's usual zone, see localOffsetFor) is assumed.
 * `datetime` and `utcOffset` are deprecated (2022-12) but still read when present.
 */
export function ship24Time(
  event: { occurrenceDatetime: string; datetime?: string | null; utcOffset?: string | null },
  fallbackOffset = "Z",
): Date {
  if (event.datetime && /[zZ]|[+-]\d{2}:?\d{2}$/.test(event.datetime))
    return new Date(event.datetime);
  const local = event.occurrenceDatetime;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return new Date(local);
  // A date with no time is a local day; noon keeps it on the right date in any zone.
  const withTime = /T\d/.test(local) ? local : `${local}T12:00:00`;
  return new Date(`${withTime}${event.utcOffset ?? fallbackOffset}`);
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
      const events: AttributedEvent[] = (tracking?.events ?? []).map((e) => {
        const eventCarrier = carrierCodeFromAggregator(e.courierCode);
        return {
          occurredAt: ship24Time(e, localOffsetFor(eventCarrier ?? carrierCode, e.location)),
          rawStatus: e.statusCode || e.statusMilestone || "",
          rawMessage: e.status ?? "",
          location: e.location ?? null,
          carrierCode: eventCarrier,
          trackingNumber: e.eventTrackingNumber ?? null,
        };
      });

      // A handoff shows up as a later courier reporting under its own tracking number.
      const next = nextCarrierAfter(events, carrierCode);
      const handoff =
        next?.trackingNumber && next.trackingNumber !== trackingNumber
          ? { nextCarrierCode: next.carrierCode, nextTrackingNumber: next.trackingNumber }
          : null;
      const shipment = tracking?.shipment;
      const estimate = shipment?.delivery?.courierEstimatedDeliveryDate;
      const estimated =
        estimate?.from || estimate?.to
          ? { from: estimate.from ?? null, to: estimate.to ?? null }
          : shipment?.delivery?.estimatedDeliveryDate
            ? { from: shipment.delivery.estimatedDeliveryDate, to: null }
            : null;
      return {
        events,
        handoff,
        facts: {
          originCountry: shipment?.originCountryCode || null,
          destinationCountry: shipment?.destinationCountryCode || null,
          lastMile: handoff
            ? { carrierCode: handoff.nextCarrierCode, trackingNumber: handoff.nextTrackingNumber }
            : null,
          estimatedDelivery: estimated
            ? {
                from: estimated.from ? new Date(estimated.from) : null,
                to: estimated.to ? new Date(estimated.to) : null,
                source: "Ship24",
              }
            : null,
          service: shipment?.delivery?.service || null,
        },
      };
    },
  };
}
