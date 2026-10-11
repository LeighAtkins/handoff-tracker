import { z } from "zod";
import {
  carrierCodeFromAggregator,
  type AggregatorClient,
  type AttributedEvent,
} from "./aggregator";
import { requestJson, requireKey, type FetchLike } from "./http";

const Estimate = z
  .looseObject({
    estimated_delivery_date: z.string().nullish(),
    estimated_delivery_date_min: z.string().nullish(),
    estimated_delivery_date_max: z.string().nullish(),
  })
  .nullish();

const Tracking = z.looseObject({
  slug: z.string().nullish(),
  origin_country_region: z.string().nullish(),
  destination_country_region: z.string().nullish(),
  shipment_weight: z
    .looseObject({ value: z.number().nullish(), unit: z.string().nullish() })
    .nullish(),
  courier_estimated_delivery_date: Estimate,
  aftership_estimated_delivery_date: Estimate,
  checkpoints: z
    .array(
      z.looseObject({
        checkpoint_time: z.string(),
        message: z.string().nullish(),
        location: z.string().nullish(),
        city: z.string().nullish(),
        country_region: z.string().nullish(),
        tag: z.string().nullish(),
        subtag: z.string().nullish(),
        slug: z.string().nullish(),
        events: z.array(z.looseObject({ code: z.string().nullish() })).nullish(),
      }),
    )
    .nullish(),
  // Replaced next_couriers in API version 2025-01.
  last_mile: z
    .looseObject({ slug: z.string().nullish(), tracking_number: z.string().nullish() })
    .nullish(),
});

const ListResponse = z.looseObject({ data: z.looseObject({ trackings: z.array(Tracking) }) });
const CreateResponse = z.looseObject({ data: Tracking });

/** Checkpoint event codes that mark the handover; more specific than the checkpoint's subtag. */
const HANDOVER_CODES = new Set([
  "handed_over_to_last_mile_carrier",
  "received_by_last_mile_carrier",
]);

const date = (value: string | null | undefined) => (value ? new Date(value) : null);

/**
 * AfterShip (tracking API 2025-07, https://www.aftership.com/docs/tracking). A number must be
 * created as a tracking once; later polls read it back. last_mile names the last-mile carrier.
 */
export function createAfterShipClient(
  options: { apiKey?: string; fetch?: FetchLike; baseUrl?: string } = {},
): AggregatorClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.aftership.com/tracking/2025-07";
  const headers = () => ({
    "as-api-key": requireKey("AFTERSHIP_API_KEY", options.apiKey),
    "content-type": "application/json",
  });

  return {
    name: "AFTERSHIP",
    async track(trackingNumber, carrierCode) {
      const list = ListResponse.parse(
        await requestJson(
          "AFTERSHIP",
          fetchImpl,
          `${baseUrl}/trackings?tracking_numbers=${encodeURIComponent(trackingNumber)}`,
          {
            method: "GET",
            headers: headers(),
          },
        ),
      );
      const existing = list.data.trackings[0];
      const tracking =
        existing ??
        CreateResponse.parse(
          await requestJson("AFTERSHIP", fetchImpl, `${baseUrl}/trackings`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ tracking_number: trackingNumber }),
          }),
        ).data;

      const events: AttributedEvent[] = (tracking.checkpoints ?? []).map((c) => ({
        occurredAt: new Date(c.checkpoint_time),
        rawStatus:
          c.events?.find((e) => e.code && HANDOVER_CODES.has(e.code))?.code ??
          (c.subtag || c.tag || ""),
        rawMessage: c.message ?? "",
        location: c.location ?? ([c.city, c.country_region].filter(Boolean).join(", ") || null),
        carrierCode: carrierCodeFromAggregator(c.slug ?? tracking.slug),
        trackingNumber: null,
      }));

      const lastMileCarrier = carrierCodeFromAggregator(tracking.last_mile?.slug);
      const lastMile =
        lastMileCarrier && tracking.last_mile?.tracking_number && lastMileCarrier !== carrierCode
          ? { carrierCode: lastMileCarrier, trackingNumber: tracking.last_mile.tracking_number }
          : null;
      const estimate =
        tracking.courier_estimated_delivery_date ?? tracking.aftership_estimated_delivery_date;
      const estimatedFrom =
        estimate?.estimated_delivery_date_min ?? estimate?.estimated_delivery_date;
      const weight = tracking.shipment_weight;
      return {
        events,
        handoff: lastMile
          ? { nextCarrierCode: lastMile.carrierCode, nextTrackingNumber: lastMile.trackingNumber }
          : null,
        // A tracking created just now is fetched in the background, so it starts empty.
        state: !existing && events.length === 0 ? "PENDING" : "READY",
        facts: {
          originCountry: tracking.origin_country_region || null,
          destinationCountry: tracking.destination_country_region || null,
          lastMile,
          estimatedDelivery:
            estimatedFrom || estimate?.estimated_delivery_date_max
              ? {
                  from: date(estimatedFrom),
                  to: date(estimate?.estimated_delivery_date_max),
                  source: tracking.courier_estimated_delivery_date ? "Carrier" : "AfterShip",
                }
              : null,
          weightKg:
            weight?.value && weight.unit?.toLowerCase().startsWith("kg") ? weight.value : null,
        },
      };
    },
  };
}
