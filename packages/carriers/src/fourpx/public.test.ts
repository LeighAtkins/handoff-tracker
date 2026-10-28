import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import type { FetchLike } from "../aggregators/http";
import { withSagawaLastMile } from "../lastmile";
import { adapterFor, trackingProviders } from "../registry";
import type { SagawaClient, SagawaParcel } from "../sagawa/client";
import { createFourPxPublicClient, FOURPX_TRACK_URL, fourPxWebTime } from "./public";

/** Answers every request with `body` and records it. */
function reply(body: unknown, status = 200, requests: { url: string; init?: RequestInit }[] = []) {
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return fetch;
}

/**
 * Shaped like track.4px.com's listTrackV3 answer. The fields are the ones its page reads; the
 * values are invented, because no real 4PX number was to hand when this was written.
 */
const toJapan = {
  result: 1,
  message: "操作成功",
  data: [
    {
      queryCode: "4PX3002711212113CN",
      serverCode: "368763643662",
      shipperCode: "4PX3002711212113CN",
      ctStartName: "China",
      ctEndName: "Japan",
      status: 2,
      tracks: [
        {
          tkCategoryName: "Delivery",
          tkDate: "2026-10-02 09:00:00",
          tkTimezone: "UTC+09:00",
          tkDesc: "Handed over to the delivery company",
          tkLocation: "Osaka",
        },
        {
          tkDate: "2026-09-28 10:00:00",
          tkDesc: "Shipment information received",
          tkLocation: "Shenzhen",
        },
      ],
    },
  ],
  tag: "6",
};

/** What the site answered for a number it does not know (a real reply, 2026-10-26). */
const noData = {
  result: 1,
  message: "操作成功",
  data: [
    {
      queryCode: "368763643662",
      serverCode: null,
      shipperCode: null,
      ctEndName: "未知",
      status: 7,
      tracks: null,
    },
  ],
  tag: "6",
};

const sagawaParcel: SagawaParcel = {
  trackingNumber: "368763643662",
  found: true,
  status: "配達完了",
  message: "お荷物のお届けが完了致しました。",
  shippedOn: "2026年10月02日",
  deliveryOffice: { name: "城南営業所", tel: "0570-01-0363" },
  scans: [
    { occurredAt: new Date("2026-10-02T01:04:00Z"), status: "集荷", office: "りんくう営業所" },
    { occurredAt: new Date("2026-10-04T01:13:00Z"), status: "配達完了", office: "城南営業所" },
  ],
};

function fakeSagawa(answer: SagawaParcel | "down" | "unknown"): SagawaClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: "SAGAWA",
    asked,
    async trackMany(numbers) {
      asked.push(...numbers);
      if (answer === "down") throw new Error("Sagawa is down");
      if (answer === "unknown")
        return numbers.map((n) => ({
          ...sagawaParcel,
          trackingNumber: n,
          found: false,
          scans: [],
        }));
      return [answer];
    },
    async track() {
      throw new Error("not used");
    },
  };
}

describe("fourPxWebTime", () => {
  it("uses the zone 4PX gives, else Japan or China time by location", () => {
    expect(fourPxWebTime("2026-10-02 09:00:00", "UTC+09:00", null)).toEqual(
      new Date("2026-10-02T00:00:00Z"),
    );
    expect(fourPxWebTime("2026-10-02 09:00", "GMT+8", null)).toEqual(
      new Date("2026-10-02T01:00:00Z"),
    );
    expect(fourPxWebTime("2026-10-02 09:00:00", null, "Osaka")).toEqual(
      new Date("2026-10-02T00:00:00Z"),
    );
    expect(fourPxWebTime("2026-10-02 09:00:00", null, "Shenzhen")).toEqual(
      new Date("2026-10-02T01:00:00Z"),
    );
  });

  it("reads epoch milliseconds and ISO strings, and rejects nonsense", () => {
    expect(fourPxWebTime(1_790_000_000_000, null, null)).toEqual(new Date(1_790_000_000_000));
    expect(fourPxWebTime("1790000000000", null, null)).toEqual(new Date(1_790_000_000_000));
    expect(fourPxWebTime("2026-10-02T00:00:00Z", null, null)).toEqual(
      new Date("2026-10-02T00:00:00Z"),
    );
    expect(fourPxWebTime("yesterday", null, null)).toBeNull();
  });
});

describe("createFourPxPublicClient", () => {
  it("asks the site like its own page does and reads the scans and the last-mile number", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const client = createFourPxPublicClient({ fetch: reply(toJapan, 200, requests) });
    const result = await client.track("4PX3002711212113CN", "4PX");

    expect(requests[0]!.url).toBe(FOURPX_TRACK_URL);
    expect(JSON.parse(requests[0]!.init!.body as string)).toEqual({
      queryCodes: ["4PX3002711212113CN"],
      language: "en-us",
      translateLanguage: "",
    });
    expect(
      result.events.map((e) => [e.occurredAt.toISOString(), e.rawMessage, e.carrierCode]),
    ).toEqual([
      ["2026-09-28T02:00:00.000Z", "Shipment information received", "4PX"],
      ["2026-10-02T00:00:00.000Z", "Handed over to the delivery company", "4PX"],
    ]);
    expect(result.handoff).toBeNull();
    expect(result.facts).toEqual({
      originCountry: "China",
      destinationCountry: "Japan",
      lastMile: { carrierCode: "SAGAWA", trackingNumber: "368763643662" },
      lastMileContact: null,
      fourPxNumber: "4PX3002711212113CN",
    });
  });

  it("names the last-mile carrier from 4PX's contact card, looked up by either number", async () => {
    // Trimmed from a real answer (2026-10-26) for a parcel to the US.
    const speedx = {
      result: 1,
      message: "操作成功",
      data: [
        {
          queryCode: "SPXPHL003022610210040090",
          serverCode: "SPXPHL003022610210040090",
          shipperCode: "4PX3003285265628CN",
          ctStartName: "China",
          ctEndName: "America",
          status: 1,
          channelContact: {
            contact:
              "【服务商】Speedx\n【联系方式】\n邮箱：Support@speedx.io  \n官网反馈指引：https://docs.qq.com/doc/x",
            website: "www.speedx.io",
          },
          tracks: [
            {
              tkCode: "FPX_D_STPP",
              tkDesc: "In transit, it's progressing through post network\n",
              tkLocation: "",
              tkTimezone: "UTC-04:00",
              tkDate: "2026-10-25T10:30:00.000+0000",
              tkCategoryName: "Transiting in Destination Country",
            },
            {
              tkCode: "FPX_I_RCUK",
              tkDesc: "Released from customs: customs cleared.\n",
              tkTimezone: "UTC-04:00",
              tkDate: "2026-10-25T02:37:09.000+0000",
            },
          ],
        },
      ],
    };
    const result = await createFourPxPublicClient({ fetch: reply(speedx) }).track(
      "SPXPHL003022610210040090",
      "4PX",
    );
    expect(
      result.events.map((e) => [e.occurredAt.toISOString(), e.rawStatus, e.rawMessage]),
    ).toEqual([
      ["2026-10-25T02:37:09.000Z", "FPX_I_RCUK", "Released from customs: customs cleared."],
      [
        "2026-10-25T10:30:00.000Z",
        "FPX_D_STPP",
        "In transit, it's progressing through post network",
      ],
    ]);
    expect(result.facts).toMatchObject({
      destinationCountry: "America",
      fourPxNumber: "4PX3003285265628CN",
      lastMile: { carrierCode: "SPEEDX", trackingNumber: "SPXPHL003022610210040090" },
      lastMileContact: { name: "Speedx", website: "www.speedx.io" },
    });
    expect(result.facts?.lastMileContact?.details).toContain("Support@speedx.io");
  });

  it("translates the carrier names 4PX gives in Chinese", async () => {
    const body = structuredClone(toJapan) as typeof toJapan & {
      data: { channelContact?: { contact: string; website: string } }[];
    };
    body.data[0]!.serverCode = "EB123456789JP";
    body.data[0]!.channelContact = {
      contact: "【服务商】日本邮政\n【联系方式】\n电话：0570-046-666",
      website: "",
    };
    const result = await createFourPxPublicClient({ fetch: reply(body) }).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(result.facts?.lastMileContact).toEqual({
      name: "Japan Post",
      website: null,
      details: "电话：0570-046-666",
    });
    expect(result.facts?.lastMile).toEqual({
      carrierCode: "JAPANPOST",
      trackingNumber: "EB123456789JP",
    });
  });

  it("does not guess Sagawa outside Japan or for numbers that are not Sagawa's", async () => {
    const elsewhere = structuredClone(toJapan);
    elsewhere.data[0]!.ctEndName = "United States";
    const own = structuredClone(toJapan);
    own.data[0]!.serverCode = "4PX3002711212113CN";
    for (const body of [elsewhere, own]) {
      const result = await createFourPxPublicClient({ fetch: reply(body) }).track(
        "4PX3002711212113CN",
        "4PX",
      );
      expect(result.facts?.lastMile).toBeNull();
    }
  });

  it("treats a number with no scans as not found", async () => {
    const result = await createFourPxPublicClient({ fetch: reply(noData) }).track(
      "368763643662",
      "SAGAWA",
    );
    expect(result).toEqual({ events: [], handoff: null, state: "NOT_FOUND" });
  });

  it("reports 4PX's 'too many visits' answer as a rate limit", async () => {
    const busy = {
      result: 0,
      message:
        "Too many visits per minute, please try again later（一分钟内访问次数过多，请稍后再试）",
    };
    await expect(
      createFourPxPublicClient({ fetch: reply(busy) }).track("X", "4PX"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("fails on a refusal", async () => {
    const client = createFourPxPublicClient({ fetch: reply({ result: 0, message: "busy" }) });
    await expect(client.track("4PX3002711212113CN", "4PX")).rejects.toThrow("busy");
  });
});

describe("withSagawaLastMile", () => {
  const web = () => createFourPxPublicClient({ fetch: reply(toJapan) });

  it("adds Sagawa's scans and makes its first scan the handoff", async () => {
    const sagawa = fakeSagawa(sagawaParcel);
    const result = await withSagawaLastMile(web(), sagawa, { confirmCarrier: true }).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(sagawa.asked).toEqual(["368763643662"]);
    expect(result.events.map((e) => [e.carrierCode, e.rawMessage])).toEqual([
      ["4PX", "Shipment information received"],
      ["4PX", "Handed over to the delivery company"],
      ["SAGAWA", "集荷"],
      ["SAGAWA", "配達完了"],
    ]);
    expect(result.handoff).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "368763643662",
    });
  });

  it("drops a guessed number Sagawa does not know, but keeps one 4PX named", async () => {
    const guessed = await withSagawaLastMile(web(), fakeSagawa("unknown"), {
      confirmCarrier: true,
    }).track("4PX3002711212113CN", "4PX");
    expect(guessed.facts?.lastMile).toBeNull();
    expect(guessed.events).toHaveLength(2);

    const named = await withSagawaLastMile(web(), fakeSagawa("unknown")).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(named.facts?.lastMile).toEqual({
      carrierCode: "SAGAWA",
      trackingNumber: "368763643662",
    });
  });

  it("returns 4PX's answer unchanged when Sagawa is down or there is no Sagawa number", async () => {
    const down = await withSagawaLastMile(web(), fakeSagawa("down")).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(down.events).toHaveLength(2);
    expect(down.handoff).toBeNull();

    const sagawa = fakeSagawa(sagawaParcel);
    await withSagawaLastMile(createFourPxPublicClient({ fetch: reply(noData) }), sagawa).track(
      "X",
      "4PX",
    );
    expect(sagawa.asked).toEqual([]);
  });

  it("lets the worker follow a 4PX leg onto Sagawa with the 4px-web adapter", async () => {
    // The adapter keeps 4PX's own events for the 4PX leg and reports the handoff to Sagawa.
    const sagawaReply = `1:${JSON.stringify({ ok: true, results: [] })}`;
    const fetch: FetchLike = async (url) =>
      url === FOURPX_TRACK_URL
        ? new Response(JSON.stringify(toJapan))
        : new Response(sagawaReply, { headers: { "content-type": "text/x-component" } });
    const adapter = adapterFor({ code: "4PX", adapter: "4px-web" }, { fetch });
    const events = await adapter.fetchEvents("4PX3002711212113CN");
    expect(events).toHaveLength(2);
    expect(adapter.detectHandoff!(events)).toBeNull();
  });
});

describe("public sites in trackingProviders", () => {
  it("are connected without keys, and can be switched off", () => {
    const on = trackingProviders({ env: {} });
    expect(on.filter((p) => p.publicSite).map((p) => [p.name, p.configured])).toEqual([
      ["4PX_WEB", true],
      ["SAGAWA", true],
    ]);
    const off = trackingProviders({ env: { PUBLIC_TRACKING_SITES: "false" } });
    expect(off.filter((p) => p.configured)).toEqual([]);
  });
});
