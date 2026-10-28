import { z } from "zod";
import { RateLimitedError } from "../adapter";
import type {
  AggregatorClient,
  AggregatorResult,
  AttributedEvent,
} from "../aggregators/aggregator";
import type { FetchLike } from "../aggregators/http";

/**
 * Sagawa's public parcel inquiry (お荷物問い合わせサービス) at e-customer.sagawa-exp.co.jp/k2k. It
 * kept working while Sagawa's main tracking site was down for maintenance in October 2026, and it
 * needs no account or key.
 *
 * The page is a Next.js app whose search button calls a server action ("searchPackages") with up
 * to 10 numbers and answers JSON. The action's id changes when Sagawa redeploys the page, so it is
 * read from the page's scripts whenever the remembered one is refused.
 */
export const SAGAWA_K2K_URL = "https://e-customer.sagawa-exp.co.jp/k2k";
/** The action id seen on 2026-10-26. Only a starting point: it is rediscovered when refused. */
export const SAGAWA_K2K_ACTION_ID = "60e3b76ba7f1d28cf3c3fa01680217528f16cd1984";
/** The form has 10 boxes and the server rejects more. */
export const SAGAWA_BATCH_SIZE = 10;

/** Sagawa numbers are 10 or 12 digits; the form strips hyphens and rejects all-zero numbers. */
export function isSagawaNumber(value: string): boolean {
  const digits = value.replace(/-/g, "");
  return /^(\d{10}|\d{12})$/.test(digits) && !/^0+$/.test(digits);
}

const Office = z
  .looseObject({ name: z.string(), tel: z.string().nullish(), fax: z.string().nullish() })
  .nullish();

const Parcel = z.looseObject({
  trackingNumber: z.string(),
  status: z.string(),
  messageLines: z.array(z.string()).default([]),
  dateLines: z.array(z.looseObject({ label: z.string(), value: z.string() })).default([]),
  shippedDate: z.string().default(""),
  pickupOffice: Office,
  deliveryOffice: Office,
  packageCount: z.string().default(""),
  history: z
    .array(z.looseObject({ status: z.string(), date: z.string(), office: z.string().nullish() }))
    .default([]),
});

const ActionResponse = z.union([
  z.looseObject({ ok: z.literal(true), results: z.array(Parcel) }),
  z.looseObject({ ok: z.literal(false), message: z.string().nullish() }),
]);

export interface SagawaScan {
  occurredAt: Date;
  /** Sagawa's wording without the arrow it draws in front: 集荷, 輸送中, 配達中, 配達完了 ... */
  status: string;
  office: string | null;
}

export interface SagawaParcel {
  trackingNumber: string;
  /** False when Sagawa answers 該当なし: unknown number, or shipped more than 60 days ago. */
  found: boolean;
  /** The headline status, e.g. 配達完了 or 配達完了（宅配BOX）. */
  status: string;
  /** Sagawa's explanation under the status, joined into one line. */
  message: string;
  shippedOn: string | null;
  /** The branch that delivers it: who to call about the delivery. */
  deliveryOffice: { name: string; tel: string | null } | null;
  scans: SagawaScan[];
}

/** Thrown when k2k answers with its generic error, or the search action cannot be found. */
export class SagawaError extends Error {
  override name = "SagawaError";
}

/**
 * k2k shows scan times as "10/04 10:13" in Japan time, without a year. The year comes from the
 * ship date; a scan in an earlier month than the ship date is in the following year.
 */
export function sagawaTime(date: string, shippedDate: string, now: Date): Date | null {
  const scan = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(date.trim());
  if (!scan) return null;
  const [, month, day, hour, minute] = scan.map(Number) as [number, number, number, number, number];
  const shipped = /(\d{4})年(\d{1,2})月/.exec(shippedDate);
  let year: number;
  if (shipped) {
    year = Number(shipped[1]) + (month < Number(shipped[2]) ? 1 : 0);
  } else {
    // No ship date: the most recent such date that is not in the future.
    year = now.getUTCFullYear();
    if (jst(year, month, day, hour, minute).getTime() > now.getTime() + 86_400_000) year -= 1;
  }
  return jst(year, month, day, hour, minute);
}

function jst(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

const NOT_FOUND = "該当なし";

function toParcel(raw: z.infer<typeof Parcel>, now: Date): SagawaParcel {
  const scans = raw.history
    .map((h) => ({
      occurredAt: sagawaTime(h.date, raw.shippedDate, now),
      status: h.status.replace(/^[\s↓⇒→]+/, "").trim(),
      office: h.office?.trim() || null,
    }))
    .filter((s): s is SagawaScan => s.occurredAt !== null)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return {
    trackingNumber: raw.trackingNumber,
    found: raw.status !== NOT_FOUND,
    status: raw.status,
    message: raw.messageLines.join(""),
    shippedOn: raw.shippedDate || null,
    deliveryOffice: raw.deliveryOffice
      ? { name: raw.deliveryOffice.name, tel: raw.deliveryOffice.tel ?? null }
      : null,
    scans,
  };
}

/**
 * Reads the action's JSON out of a React Server Components reply, which looks like
 * `0:{"a":"$@1",...}\n1:{"ok":true,"results":[...]}`.
 */
function actionPayload(text: string): unknown {
  for (const line of text.split("\n")) {
    const match = /^[0-9a-f]+:(\{.*\})$/.exec(line);
    if (!match) continue;
    const value = JSON.parse(match[1]!) as Record<string, unknown>;
    if ("ok" in value) return value;
  }
  throw new SagawaError(`Sagawa answered in an unexpected format: ${text.slice(0, 200)}`);
}

export interface SagawaClient extends AggregatorClient {
  /** Up to any number of tracking numbers, asked 10 at a time, in the order given. */
  trackMany(trackingNumbers: string[]): Promise<SagawaParcel[]>;
}

export function createSagawaClient(
  options: {
    fetch?: FetchLike;
    url?: string;
    actionId?: string;
    now?: () => Date;
  } = {},
): SagawaClient {
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url ?? SAGAWA_K2K_URL;
  const now = options.now ?? (() => new Date());
  let actionId = options.actionId ?? SAGAWA_K2K_ACTION_ID;

  async function discoverActionId(): Promise<string> {
    const page = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    const html = await page.text();
    const origin = new URL(url).origin;
    const scripts = [...new Set([...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]!))];
    for (const script of scripts) {
      const js = await (
        await fetchImpl(new URL(script, origin).toString(), { signal: AbortSignal.timeout(20_000) })
      ).text();
      const match = /createServerReference\)\("([0-9a-f]{40,})"[^;]{0,200}?"searchPackages"/.exec(
        js,
      );
      if (match) return match[1]!;
    }
    throw new SagawaError("Could not find Sagawa's search action on the k2k page");
  }

  async function ask(batch: string[], retried = false): Promise<SagawaParcel[]> {
    const form = new FormData();
    for (const number of batch) form.append("_1_tracking_number", number);
    form.append("0", '[null,"$K1"]');
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "text/x-component", "next-action": actionId },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) throw new RateLimitedError("SAGAWA", null);
    const text = await response.text();
    // A redeploy changes the action id: Next answers 400 "Invalid Server Action request" or 404.
    const refused =
      !response.ok || !(response.headers.get("content-type") ?? "").includes("text/x-component");
    if (refused) {
      if (retried || response.status >= 500)
        throw new SagawaError(
          `Sagawa refused the request (${response.status}): ${text.slice(0, 200)}`,
        );
      actionId = await discoverActionId();
      return ask(batch, true);
    }
    const payload = ActionResponse.parse(actionPayload(text));
    if (!payload.ok) {
      throw new SagawaError(`Sagawa could not answer: ${payload.message ?? "unknown error"}`);
    }
    const at = now();
    return payload.results.map((r) => toParcel(r, at));
  }

  async function trackMany(trackingNumbers: string[]): Promise<SagawaParcel[]> {
    const numbers = trackingNumbers.map((n) => n.replace(/-/g, ""));
    const parcels: SagawaParcel[] = [];
    for (let i = 0; i < numbers.length; i += SAGAWA_BATCH_SIZE) {
      parcels.push(...(await ask(numbers.slice(i, i + SAGAWA_BATCH_SIZE))));
    }
    return parcels;
  }

  return {
    name: "SAGAWA",
    trackMany,
    async track(trackingNumber): Promise<AggregatorResult> {
      if (!isSagawaNumber(trackingNumber)) return { events: [], handoff: null, state: "NOT_FOUND" };
      const [parcel] = await trackMany([trackingNumber]);
      if (!parcel?.found) return { events: [], handoff: null, state: "NOT_FOUND" };
      return { events: sagawaEvents(parcel), handoff: null, facts: { destinationCountry: "JP" } };
    },
  };
}

/** Sagawa's scans as events on the Sagawa leg. */
export function sagawaEvents(parcel: SagawaParcel): AttributedEvent[] {
  return parcel.scans.map((scan) => ({
    occurredAt: scan.occurredAt,
    rawStatus: scan.status,
    rawMessage: scan.status,
    location: scan.office,
    carrierCode: "SAGAWA",
    trackingNumber: parcel.trackingNumber,
  }));
}
