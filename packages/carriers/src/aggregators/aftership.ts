import { z } from "zod";
import {
  carrierCodeFromAggregator,
  type AggregatorClient,
  type AttributedEvent,
} from "./aggregator";
import { requestJson, requireKey, type FetchLike } from "./http";

const Tracking = z.looseObject({
  slug: z.string().nullish(),
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
      }),
    )
    .nullish(),
  next_couriers: z
    .array(z.looseObject({ slug: z.string(), tracking_number: z.string() }))
    .nullish(),
});

const ListResponse = z.looseObject({ data: z.looseObject({ trackings: z.array(Tracking) }) });
const CreateResponse = z.looseObject({ data: Tracking });

/**
 * AfterShip (tracking API 2025-07, https://www.aftership.com/docs/tracking). A number must be
 * created as a tracking once; later polls read it back. next_couriers names the last-mile carrier.
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
      const tracking =
        list.data.trackings[0] ??
        CreateResponse.parse(
          await requestJson("AFTERSHIP", fetchImpl, `${baseUrl}/trackings`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ tracking_number: trackingNumber }),
          }),
        ).data;

      const events: AttributedEvent[] = (tracking.checkpoints ?? []).map((c) => ({
        occurredAt: new Date(c.checkpoint_time),
        rawStatus: c.subtag || c.tag || "",
        rawMessage: c.message ?? "",
        location: c.location ?? ([c.city, c.country_region].filter(Boolean).join(", ") || null),
        carrierCode: carrierCodeFromAggregator(c.slug ?? tracking.slug),
        trackingNumber: null,
      }));
      const next = (tracking.next_couriers ?? [])
        .map((n) => ({
          nextCarrierCode: carrierCodeFromAggregator(n.slug)!,
          nextTrackingNumber: n.tracking_number,
        }))
        .find((n) => n.nextCarrierCode !== carrierCode);
      return { events, handoff: next ?? null };
    },
  };
}
