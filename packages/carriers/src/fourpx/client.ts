import { createHash } from "node:crypto";
import { z } from "zod";
import { RateLimitedError } from "../adapter";
import {
  carrierCodeFromAggregator,
  type AggregatorClient,
  type AggregatorResult,
  type AttributedEvent,
} from "../aggregators/aggregator";
import { requireKey, type FetchLike } from "../aggregators/http";
import { fourPxStage } from "./codes";

/**
 * Direct client for the 4PX Open Platform tracking API (`tr.order.tracking.get`,
 * https://open.4px.com/apiInfo/detail?id=25). Unlike the aggregators it needs no third party:
 * 4PX reports its own scans, and names the last-mile carrier and its tracking number
 * (`serverName`, `serverNum`), which is the number staff otherwise copy from 4PX's website.
 *
 * Credentials come from a 4PX merchant account (see docs/4px-api-request.md). The test and
 * production platforms have separate key pairs.
 */
export const FOURPX_PRODUCTION_URL = "https://open.4px.com/router/api/service";
export const FOURPX_TEST_URL = "https://open-test.4px.com/router/api/service";

const METHOD = "tr.order.tracking.get";
const VERSION = "1.0.0";

/**
 * 4PX's request signature: the system parameters sorted by name and concatenated without "="
 * or "&", then the exact JSON body, then the app secret; MD5 as 32 lowercase hex characters.
 * access_token and language are not signed.
 */
export function fourPxSign(input: {
  appKey: string;
  appSecret: string;
  method: string;
  timestamp: string;
  v: string;
  body: string;
}): string {
  const base =
    `app_key${input.appKey}formatjsonmethod${input.method}timestamp${input.timestamp}` +
    `v${input.v}${input.body}${input.appSecret}`;
  return createHash("md5").update(base, "utf8").digest("hex");
}

const Code = z.union([z.string(), z.number()]).transform(String);

const TrackingResponse = z.looseObject({
  result: Code,
  msg: z.string().nullish(),
  // 4PX services disagree on casing, so both spellings are accepted.
  errors: z
    .array(
      z.looseObject({
        error_code: Code.nullish(),
        errorCode: Code.nullish(),
        error_msg: z.string().nullish(),
        errorMsg: z.string().nullish(),
      }),
    )
    .nullish(),
  data: z
    .looseObject({
      deliveryOrderNo: z.string().nullish(),
      destinationCountry: z.string().nullish(),
      serverName: z.string().nullish(),
      serverNum: z.string().nullish(),
      trackingList: z
        .array(
          z.looseObject({
            businessLinkCode: z.string().nullish(),
            occurDatetime: z.string(),
            occurLocation: z.string().nullish(),
            country: z.string().nullish(),
            city: z.string().nullish(),
            timeZone: z.string().nullish(),
            trackingContent: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

/**
 * 4PX sends wall-clock time ("2026-10-01 09:30:00") and, when it knows it, a zone such as
 * "UTC+09:00". Without one the time is read as China time, where 4PX operates. The trial with
 * real keys should confirm this.
 */
export function fourPxTime(occurDatetime: string, timeZone?: string | null): Date {
  const zone = /UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(timeZone ?? "");
  const offset = zone ? `${zone[1]}${zone[2]!.padStart(2, "0")}:${zone[3] ?? "00"}` : "+08:00";
  return new Date(`${occurDatetime.trim().replace(" ", "T")}${offset}`);
}

/** Thrown for anything 4PX refuses other than "slow down" (bad keys, unknown app, bad sign). */
export class FourPxError extends Error {
  override name = "FourPxError";
}

const RATE_LIMIT_CODES = new Set(["000017", "DS000006", "DS000007"]);
/** Stages that mean the last-mile carrier has the parcel, so its number is no longer just planned. */
const AFTER_HANDOVER = new Set([
  "HANDED_OFF",
  "LAST_MILE_ACCEPTED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

export function createFourPxClient(
  options: {
    appKey?: string;
    appSecret?: string;
    fetch?: FetchLike;
    baseUrl?: string;
    now?: () => Date;
  } = {},
): AggregatorClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? FOURPX_PRODUCTION_URL;
  const now = options.now ?? (() => new Date());

  return {
    name: "4PX",
    async track(trackingNumber): Promise<AggregatorResult> {
      const appKey = requireKey("FOURPX_APP_KEY", options.appKey);
      const appSecret = requireKey("FOURPX_APP_SECRET", options.appSecret);
      const body = JSON.stringify({ deliveryOrderNo: trackingNumber });
      const timestamp = String(now().getTime());
      const query = new URLSearchParams({
        method: METHOD,
        app_key: appKey,
        v: VERSION,
        timestamp,
        format: "json",
        sign: fourPxSign({ appKey, appSecret, method: METHOD, timestamp, v: VERSION, body }),
        language: "en",
      });
      const response = await fetchImpl(`${baseUrl}?${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      if (response.status === 429) throw new RateLimitedError("4PX", null);
      if (!response.ok) {
        // Gateway errors come back as HTTP 500 with a Spring error body, e.g.
        // {"message":"com.fpx.openapi.oauth2.exception.ApiException: APP不存在"}.
        const message = gatewayMessage(text);
        if (/频繁/.test(message)) throw new RateLimitedError("4PX", 60);
        throw new FourPxError(`4PX refused the request (${response.status}): ${message}`);
      }

      const parsed = TrackingResponse.parse(JSON.parse(text));
      if (parsed.result === "0") {
        const error = parsed.errors?.[0];
        const code = error?.error_code ?? error?.errorCode ?? "";
        const message = error?.error_msg ?? error?.errorMsg ?? parsed.msg ?? "unknown error";
        // errorCode "0": "the order number is empty or does not exist".
        if (code === "0") return { events: [], handoff: null, state: "NOT_FOUND" };
        if (RATE_LIMIT_CODES.has(code)) throw new RateLimitedError("4PX", 60);
        throw new FourPxError(`4PX could not track ${trackingNumber}: ${message} (${code})`);
      }

      const data = parsed.data;
      const events: AttributedEvent[] = (data?.trackingList ?? [])
        .map((e) => ({
          occurredAt: fourPxTime(e.occurDatetime, e.timeZone),
          rawStatus: e.businessLinkCode ?? "",
          rawMessage: e.trackingContent ?? "",
          location: e.occurLocation || [e.city, e.country].filter(Boolean).join(", ") || null,
          carrierCode: "4PX",
          trackingNumber,
        }))
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

      const lastMileNumber = data?.serverNum?.trim();
      const lastMileCarrier = carrierCodeFromAggregator(data?.serverName?.trim() || null);
      const lastMile =
        lastMileNumber && lastMileCarrier && lastMileNumber !== trackingNumber
          ? { carrierCode: lastMileCarrier, trackingNumber: lastMileNumber }
          : null;
      // 4PX can assign the last-mile number when the order is created, long before the
      // handover, so it only counts as a handoff once a handover (or later) scan exists.
      const handedOver = events.some((e) => AFTER_HANDOVER.has(fourPxStage(e.rawStatus) ?? ""));

      return {
        events,
        handoff:
          lastMile && handedOver
            ? { nextCarrierCode: lastMile.carrierCode, nextTrackingNumber: lastMile.trackingNumber }
            : null,
        facts: {
          destinationCountry: data?.destinationCountry || null,
          lastMile,
        },
      };
    },
  };
}

function gatewayMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") return body.message.replace(/^.*Exception:\s*/, "");
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 200) || "no details";
}
