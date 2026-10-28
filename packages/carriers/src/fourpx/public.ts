import { z } from "zod";
import { RateLimitedError } from "../adapter";
import {
  carrierCodeFromAggregator,
  localOffsetFor,
  type AggregatorClient,
  type AggregatorResult,
  type AttributedEvent,
} from "../aggregators/aggregator";
import { requestJson, type FetchLike } from "../aggregators/http";
import { isSagawaNumber } from "../sagawa/client";

/**
 * 4PX's public tracking site, track.4px.com: the page staff use today to copy the last-mile number.
 * It needs no key, so it works before 4PX approves API access (ADR-0004). It answers for the 4PX
 * number or the last-mile one, and gives both (`shipperCode`, `serverCode`), every scan with 4PX's
 * own status code (`tkCode`), and usually the last-mile carrier with its contact details
 * (`channelContact`, e.g. "【服务商】Speedx"). Without a named carrier, a number is only taken to
 * be Sagawa's when the parcel is going to Japan and the number looks like one; withSagawaLastMile
 * then asks Sagawa to confirm it.
 *
 * Unlike the Open Platform API this is not a documented interface and can change without notice.
 */
export const FOURPX_TRACK_URL = "https://track.4px.com/track/v2/front/listTrackV3";

const Track = z.looseObject({
  tkDate: z.union([z.string(), z.number()]).nullish(),
  tkTimezone: z.string().nullish(),
  tkDesc: z.string().nullish(),
  tkLocation: z.string().nullish(),
  tkCategoryName: z.string().nullish(),
  // Not shown by the site; read if present so 4PX's status codes can be classified.
  tkCode: z.string().nullish(),
  businessLinkCode: z.string().nullish(),
});

const ListTrackResponse = z.looseObject({
  result: z.union([z.number(), z.string()]).transform(Number),
  message: z.string().nullish(),
  data: z
    .array(
      z.looseObject({
        queryCode: z.string().nullish(),
        serverCode: z.string().nullish(),
        shipperCode: z.string().nullish(),
        ctStartName: z.string().nullish(),
        ctEndName: z.string().nullish(),
        tracks: z.array(Track).nullish(),
        channelContact: z
          .looseObject({ contact: z.string().nullish(), website: z.string().nullish() })
          .nullish(),
      }),
    )
    .nullish(),
});

/**
 * The site's times are "2026-10-01 09:30:00" (or epoch milliseconds), with an optional zone such
 * as "UTC+09:00" or "GMT+8". Without one the location decides: Japan time in Japan, else China.
 */
export function fourPxWebTime(
  tkDate: string | number,
  zone: string | null | undefined,
  location: string | null,
): Date | null {
  if (typeof tkDate === "number" || /^\d{12,}$/.test(tkDate)) return new Date(Number(tkDate));
  const wall = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(tkDate.trim());
  if (!wall) {
    const parsed = new Date(tkDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const offset = /(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(zone ?? "");
  const suffix = offset
    ? `${offset[1]}${offset[2]!.padStart(2, "0")}:${offset[3] ?? "00"}`
    : localOffsetFor("4PX", location);
  const time = wall[2]!.length === 5 ? `${wall[2]}:00` : wall[2];
  return new Date(`${wall[1]}T${time}${suffix}`);
}

const JAPAN = /japan|日本|^jp$/i;

/** 4PX names some carriers in Chinese; these are the ones seen in a month of Comfort Works parcels. */
const CARRIER_NAMES: Record<string, string> = {
  日本邮政: "Japan Post",
  佐川: "Sagawa",
  法邮: "La Poste",
  澳邮: "Australia Post",
  加拿大邮政: "Canada Post",
  瑞士邮政: "Swiss Post",
  燕文落地配: "Yanwen",
  冠廷: "Morning Global",
  DEDHL: "DHL Germany",
};

export function carrierDisplayName(name: string): string {
  return CARRIER_NAMES[name.trim()] ?? name.trim();
}

/** The carrier 4PX handed over to, from its contact card: "【服务商】Speedx\n【联系方式】...". */
export function fourPxLastMileContact(
  contact: { contact?: string | null; website?: string | null } | null | undefined,
): { name: string; website: string | null; details: string | null } | null {
  const text = contact?.contact ?? "";
  const raw = /【服务商】\s*([^\n【]+)/.exec(text)?.[1]?.trim();
  if (!raw) return null;
  const name = carrierDisplayName(raw);
  const details = /【联系方式】\s*([\s\S]*)$/.exec(text)?.[1]?.trim() || null;
  return { name, website: contact?.website?.trim() || null, details };
}

export function createFourPxPublicClient(
  options: { fetch?: FetchLike; url?: string } = {},
): AggregatorClient {
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url ?? FOURPX_TRACK_URL;

  return {
    name: "4PX_WEB",
    async track(trackingNumber): Promise<AggregatorResult> {
      const json = await requestJson("4PX_WEB", fetchImpl, url, {
        method: "POST",
        headers: { "content-type": "application/json;charset=UTF-8" },
        body: JSON.stringify({
          queryCodes: [trackingNumber],
          language: "en-us",
          translateLanguage: "",
        }),
      });
      const parsed = ListTrackResponse.parse(json);
      // 4PX answers HTTP 200 with result 0 when asked too often; the worker should back off.
      if (parsed.result !== 1 && /访问次数过多|too many visits/i.test(parsed.message ?? "")) {
        throw new RateLimitedError("4PX_WEB", 60);
      }
      if (parsed.result !== 1) {
        throw new Error(
          `4PX's tracking site refused the request: ${parsed.message ?? "no details"}`,
        );
      }
      const parcel = parsed.data?.[0];
      const tracks = parcel?.tracks ?? [];
      if (!parcel || tracks.length === 0) return { events: [], handoff: null, state: "NOT_FOUND" };

      const events: AttributedEvent[] = tracks
        .flatMap((t) => {
          const location = t.tkLocation?.trim() || null;
          const occurredAt =
            t.tkDate == null ? null : fourPxWebTime(t.tkDate, t.tkTimezone, location);
          if (!occurredAt) return [];
          return [
            {
              occurredAt,
              rawStatus: t.tkCode ?? t.businessLinkCode ?? t.tkCategoryName ?? "",
              rawMessage: t.tkDesc?.trim() ?? "",
              location,
              carrierCode: "4PX",
              trackingNumber,
            },
          ];
        })
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

      const destination = parcel.ctEndName && parcel.ctEndName !== "未知" ? parcel.ctEndName : null;
      // serverCode is the last-mile number; it equals the 4PX number until one is assigned.
      const serverCode = parcel.serverCode?.trim();
      const lastMileNumber =
        serverCode && serverCode !== parcel.shipperCode?.trim() ? serverCode : null;
      const contact = fourPxLastMileContact(parcel.channelContact);
      const named = contact ? carrierCodeFromAggregator(contact.name) : null;
      const guessed =
        destination && JAPAN.test(destination) && lastMileNumber && isSagawaNumber(lastMileNumber)
          ? "SAGAWA"
          : null;
      const carrier = named ?? guessed;
      const lastMile =
        lastMileNumber && carrier
          ? {
              carrierCode: carrier,
              trackingNumber:
                carrier === "SAGAWA" ? lastMileNumber.replace(/-/g, "") : lastMileNumber,
            }
          : null;

      return {
        events,
        // The site does not name the carrier, so only Sagawa's own scans prove a handover.
        handoff: null,
        facts: {
          originCountry:
            parcel.ctStartName && parcel.ctStartName !== "未知" ? parcel.ctStartName : null,
          destinationCountry: destination,
          lastMile,
          lastMileContact: contact,
          fourPxNumber: parcel.shipperCode?.trim() || null,
        },
      };
    },
  };
}
