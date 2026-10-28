import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import type { FetchLike } from "../aggregators/http";
import { normalise } from "../normaliser";
import { adapterFor } from "../registry";
import { classifyStage } from "../stages";
import {
  createSagawaClient,
  isSagawaNumber,
  SAGAWA_K2K_ACTION_ID,
  SAGAWA_K2K_URL,
  SagawaError,
  sagawaTime,
} from "./client";

/** Sagawa's real k2k answer for a delivered parcel (2026-10-26), one found and one unknown. */
const delivered = {
  trackingNumber: "368763643662",
  status: "配達完了",
  messageLines: ["お荷物のお届けが完了致しました。", "ご利用頂きありがとうございました。"],
  dateLines: [{ label: "配達完了日　　：", value: "10月04日　10時13分" }],
  shippedDate: "2026年10月02日",
  pickupOffice: { name: "りんくう営業所", tel: "0570-01-0604", fax: "072-458-7103" },
  deliveryOffice: { name: "城南営業所", tel: "0570-01-0363", fax: "03-3799-8650" },
  packageCount: "1個",
  history: [
    { status: "↓集荷", date: "10/02 10:04", office: "りんくう営業所" },
    { status: "↓輸送中", date: "10/03 13:40", office: "関西中継センター" },
    { status: "↓配達中", date: "10/04 08:14", office: "城南営業所" },
    { status: "⇒配達完了", date: "10/04 10:13", office: "城南営業所" },
  ],
};
const unknown = {
  trackingNumber: "123456789012",
  status: "該当なし",
  messageLines: ["恐れ入りますが、お問い合せ送り状NOをお確かめください。"],
  dateLines: [],
  shippedDate: "",
  pickupOffice: null,
  deliveryOffice: null,
  packageCount: "",
  history: [],
};

function rsc(payload: unknown) {
  return `0:{"a":"$@1","q":"","i":false,"b":"x"}\n1:${JSON.stringify(payload)}\n`;
}

type Request = { url: string; init?: RequestInit };

/** Answers like k2k: the action at `actionId`, the page and its script for rediscovery. */
function k2k(options: { actionId?: string; payload?: unknown; status?: number } = {}) {
  const requests: Request[] = [];
  const actionId = options.actionId ?? SAGAWA_K2K_ACTION_ID;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/chunk.js")) {
      return new Response(
        `let s=(0,n.createServerReference)("${actionId}",n.callServer,void 0,n.findSourceMapURL,"searchPackages")`,
      );
    }
    if (!init?.method)
      return new Response('<script src="/k2k/_next/static/chunks/chunk.js" async="">');
    const headers = new Headers(init.headers);
    if (headers.get("next-action") !== actionId) {
      return new Response("Invalid Server Action request.", { status: 400 });
    }
    if (options.status) return new Response("busy", { status: options.status });
    return new Response(rsc(options.payload ?? { ok: true, results: [delivered] }), {
      headers: { "content-type": "text/x-component" },
    });
  };
  return { fetch, requests };
}

const now = () => new Date("2026-10-26T00:00:00Z");

describe("isSagawaNumber", () => {
  it("accepts 10 or 12 digits, with hyphens", () => {
    expect(isSagawaNumber("368763643662")).toBe(true);
    expect(isSagawaNumber("3687-6364-3662")).toBe(true);
    expect(isSagawaNumber("3687636436")).toBe(true);
    expect(isSagawaNumber("36876364366")).toBe(false);
    expect(isSagawaNumber("000000000000")).toBe(false);
    expect(isSagawaNumber("4PX3002711212113CN")).toBe(false);
  });
});

describe("sagawaTime", () => {
  it("reads Japan time and takes the year from the ship date", () => {
    expect(sagawaTime("10/04 10:13", "2026年10月02日", now())).toEqual(
      new Date("2026-10-04T01:13:00Z"),
    );
  });

  it("moves scans in an earlier month than the ship date into the next year", () => {
    expect(sagawaTime("01/03 09:00", "2026年12月30日", now())).toEqual(
      new Date("2027-01-03T00:00:00Z"),
    );
  });

  it("without a ship date, picks the latest year that is not in the future", () => {
    expect(sagawaTime("12/30 09:00", "", now())).toEqual(new Date("2025-12-30T00:00:00Z"));
    expect(sagawaTime("10/25 09:00", "", now())).toEqual(new Date("2026-10-25T00:00:00Z"));
  });

  it("returns null for anything else", () => {
    expect(sagawaTime("", "2026年10月02日", now())).toBeNull();
  });
});

describe("createSagawaClient", () => {
  it("posts the numbers the way the k2k form does and reads the scans", async () => {
    const { fetch, requests } = k2k({ payload: { ok: true, results: [delivered, unknown] } });
    const client = createSagawaClient({ fetch, now });
    const [parcel, missing] = await client.trackMany(["3687-6364-3662", "123456789012"]);

    const body = requests[0]!.init!.body as FormData;
    expect(requests[0]!.url).toBe(SAGAWA_K2K_URL);
    expect(body.getAll("_1_tracking_number")).toEqual(["368763643662", "123456789012"]);
    expect(body.get("0")).toBe('[null,"$K1"]');

    expect(parcel).toMatchObject({
      trackingNumber: "368763643662",
      found: true,
      status: "配達完了",
      shippedOn: "2026年10月02日",
      deliveryOffice: { name: "城南営業所", tel: "0570-01-0363" },
    });
    expect(parcel!.scans.map((s) => [s.status, s.occurredAt.toISOString(), s.office])).toEqual([
      ["集荷", "2026-10-02T01:04:00.000Z", "りんくう営業所"],
      ["輸送中", "2026-10-03T04:40:00.000Z", "関西中継センター"],
      ["配達中", "2026-10-03T23:14:00.000Z", "城南営業所"],
      ["配達完了", "2026-10-04T01:13:00.000Z", "城南営業所"],
    ]);
    expect(missing).toMatchObject({ found: false, scans: [] });
  });

  it("asks 10 numbers at a time", async () => {
    const { fetch, requests } = k2k();
    const numbers = Array.from({ length: 23 }, (_, i) => String(368763600000 + i));
    await createSagawaClient({ fetch }).trackMany(numbers);
    expect(
      requests.map((r) => (r.init!.body as FormData).getAll("_1_tracking_number").length),
    ).toEqual([10, 10, 3]);
  });

  it("finds the new action id on the page after Sagawa redeploys", async () => {
    const { fetch, requests } = k2k({ actionId: "ab".repeat(21) });
    const [parcel] = await createSagawaClient({ fetch }).trackMany(["368763643662"]);
    expect(parcel!.found).toBe(true);
    expect(requests.map((r) => r.init?.method ?? "GET")).toEqual(["POST", "GET", "GET", "POST"]);
  });

  it("gives up when the page has no search action", async () => {
    const fetch: FetchLike = async (_url, init) =>
      init?.method ? new Response("Invalid", { status: 400 }) : new Response("<html></html>");
    await expect(createSagawaClient({ fetch }).trackMany(["368763643662"])).rejects.toThrow(
      "Could not find Sagawa's search action",
    );
  });

  it("reports Sagawa's own error and rate limits", async () => {
    const failing = k2k({ payload: { ok: false, message: "エラーが発生しました。" } });
    await expect(createSagawaClient(failing).trackMany(["368763643662"])).rejects.toThrow(
      SagawaError,
    );
    await expect(
      createSagawaClient(k2k({ status: 429 })).trackMany(["368763643662"]),
    ).rejects.toThrow(RateLimitedError);
    await expect(
      createSagawaClient(k2k({ status: 503 })).trackMany(["368763643662"]),
    ).rejects.toThrow("Sagawa refused the request (503)");
  });

  it("tracks one number as Sagawa events, and skips numbers that are not Sagawa's", async () => {
    const { fetch, requests } = k2k();
    const client = createSagawaClient({ fetch, now });
    const result = await client.track("368763643662", "SAGAWA");
    expect(result.events).toHaveLength(4);
    expect(result.events[3]).toMatchObject({
      carrierCode: "SAGAWA",
      trackingNumber: "368763643662",
      rawMessage: "配達完了",
      location: "城南営業所",
    });
    expect(await client.track("4PX3002711212113CN", "4PX")).toMatchObject({ state: "NOT_FOUND" });
    expect(requests).toHaveLength(1);

    const empty = createSagawaClient(k2k({ payload: { ok: true, results: [unknown] } }));
    expect(await empty.track("123456789012", "SAGAWA")).toMatchObject({ state: "NOT_FOUND" });
  });

  it("produces scans the normaliser and stage classifier understand", async () => {
    const result = await createSagawaClient({ ...k2k(), now }).track("368763643662", "SAGAWA");
    expect(result.events.map((e) => normalise("SAGAWA", e))).toEqual([
      "IN_TRANSIT",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(result.events.map((e) => classifyStage("SAGAWA", e, 2))).toEqual([
      "LAST_MILE_ACCEPTED",
      null,
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(
      normalise("SAGAWA", { rawStatus: "配達完了（宅配BOX）", rawMessage: "配達完了（宅配BOX）" }),
    ).toBe("DELIVERED");
  });

  it("is available to the worker as the sagawa adapter", async () => {
    const adapter = adapterFor({ code: "SAGAWA", adapter: "sagawa" }, { fetch: k2k().fetch });
    expect(await adapter.fetchEvents("368763643662")).toHaveLength(4);
  });
});
