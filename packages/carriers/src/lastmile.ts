import type { AggregatorClient, AggregatorResult } from "./aggregators/aggregator";
import { isSagawaNumber, sagawaEvents, type SagawaClient } from "./sagawa/client";

/**
 * Follows a 4PX parcel onto Sagawa: when the provider names a Sagawa number (4PX's API) or one
 * that looks like it (4PX's tracking site), Sagawa is asked about it and its scans are added to the
 * journey. Sagawa's own first scan proves the handover, so it also becomes the handoff.
 *
 * `confirmCarrier` is for providers that only guess the carrier: if Sagawa does not know the
 * number, the guess is dropped rather than shown as Sagawa's. A carrier the provider names itself
 * is kept, because Sagawa only lists a number once it has scanned the parcel.
 *
 * Sagawa being down never fails the lookup: the provider's answer is returned as it was.
 */
export function withSagawaLastMile(
  client: AggregatorClient,
  sagawa: SagawaClient,
  options: { confirmCarrier?: boolean } = {},
): AggregatorClient {
  return {
    name: client.name,
    async track(trackingNumber, carrierCode): Promise<AggregatorResult> {
      const result = await client.track(trackingNumber, carrierCode);
      const lastMile = result.facts?.lastMile;
      const number =
        result.handoff?.nextCarrierCode === "SAGAWA"
          ? result.handoff.nextTrackingNumber
          : lastMile?.carrierCode === "SAGAWA"
            ? lastMile.trackingNumber
            : null;
      if (!number || !isSagawaNumber(number) || number === trackingNumber) return result;

      let parcel;
      try {
        [parcel] = await sagawa.trackMany([number]);
      } catch {
        return result;
      }
      if (!parcel?.found) {
        if (!options.confirmCarrier) return result;
        return { ...result, facts: { ...result.facts, lastMile: null } };
      }

      const events = [...result.events, ...sagawaEvents(parcel)].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      return {
        ...result,
        events,
        handoff:
          parcel.scans.length > 0
            ? { nextCarrierCode: "SAGAWA", nextTrackingNumber: number }
            : result.handoff,
        facts: { ...result.facts, lastMile: { carrierCode: "SAGAWA", trackingNumber: number } },
      };
    },
  };
}
