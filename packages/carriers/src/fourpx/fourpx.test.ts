import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import type { FetchLike } from "../aggregators/http";
import { normalise } from "../normaliser";
import { adapterFor } from "../registry";
import { classifyStage } from "../stages";
import {
  createFourPxClient,
  FourPxError,
  fourPxSign,
  fourPxTime,
  FOURPX_PRODUCTION_URL,
} from "./client";
import { classifyFourPxCode, fourPxStage, fourPxStatus, isFourPxCode } from "./codes";

const keys = { appKey: "key-1", appSecret: "secret-1" };

/** Records the request and answers with a fixed body and status. */
function reply(body: unknown, status = 200, requests: { url: string; init?: RequestInit }[] = []) {
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return fetch;
}

/** A 4PX parcel handed to Sagawa, in 4PX's newest-first order. */
const handedOver = {
  result: "1",
  msg: "操作成功",
  errors: [],
  data: {
    deliveryOrderNo: "4PX3002711212113CN",
    destinationCountry: "JP",
    serverName: "Sagawa",
    serverNum: "900011112222",
    trackingList: [
      {
        businessLinkCode: "FPX_D_STPP",
        occurDatetime: "2026-10-04 10:00:00",
        occurLocation: "Osaka",
        timeZone: "UTC+09:00",
        trackingContent: "In transit,it'sprogressing through delivery network",
      },
      {
        businessLinkCode: "FPX_M_ATA",
        occurDatetime: "2026-10-03 08:30:00",
        city: "Osaka",
        country: "Japan",
        timeZone: "UTC+9",
        trackingContent: "Arrival to the destination airport",
      },
      {
        businessLinkCode: "FPX_L_RPIF",
        occurDatetime: "2026-10-01 09:00:00",
        trackingContent: "Shipment information received",
      },
    ],
  },
};

describe("fourPxSign", () => {
  it("matches the worked example in 4PX's merchant guide", () => {
    expect(
      fourPxSign({
        appKey: "16081f05-e8fc-4250-b9c4-0660d1ecbb28",
        appSecret: "7eebf328-8e5a-4030-904d-ec6e89174fbc",
        method: "ds.xms.order.create",
        timestamp: "1532592413187",
        v: "1.0",
        body: '{"aa":"bb"}',
      }),
    ).toBe("ff4af77c062a9b97d98aa29777621c4a");
  });
});

describe("fourPxTime", () => {
  it("reads 4PX's wall-clock time in the zone it names, or China time", () => {
    expect(fourPxTime("2026-10-04 10:00:00", "UTC+09:00")).toEqual(
      new Date("2026-10-04T01:00:00Z"),
    );
    expect(fourPxTime("2026-10-04 10:00:00", "UTC-5")).toEqual(new Date("2026-10-04T15:00:00Z"));
    expect(fourPxTime("2026-10-04 10:00:00", null)).toEqual(new Date("2026-10-04T02:00:00Z"));
  });
});

describe("createFourPxClient", () => {
  it("signs the request and puts the system parameters in the query string", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const client = createFourPxClient({
      ...keys,
      fetch: reply(handedOver, 200, requests),
      now: () => new Date(1_760_000_000_000),
    });
    await client.track("4PX3002711212113CN", "4PX");

    const { url, init } = requests[0]!;
    const query = new URL(url).searchParams;
    const body = '{"deliveryOrderNo":"4PX3002711212113CN"}';
    expect(url.startsWith(`${FOURPX_PRODUCTION_URL}?`)).toBe(true);
    expect(Object.fromEntries(query)).toEqual({
      method: "tr.order.tracking.get",
      app_key: "key-1",
      v: "1.0.0",
      timestamp: "1760000000000",
      format: "json",
      language: "en",
      sign: fourPxSign({
        ...keys,
        method: "tr.order.tracking.get",
        timestamp: "1760000000000",
        v: "1.0.0",
        body,
      }),
    });
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
  });

  it("returns 4PX's scans oldest first, and the last-mile handoff once 4PX has handed over", async () => {
    const result = await createFourPxClient({ ...keys, fetch: reply(handedOver) }).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(result.events.map((e) => [e.rawStatus, e.location])).toEqual([
      ["FPX_L_RPIF", null],
      ["FPX_M_ATA", "Osaka, Japan"],
      ["FPX_D_STPP", "Osaka"],
    ]);
    expect(result.events[0]).toMatchObject({
      occurredAt: new Date("2026-10-01T01:00:00Z"),
      carrierCode: "4PX",
      trackingNumber: "4PX3002711212113CN",
    });
    expect(result.handoff).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900011112222",
    });
    expect(result.facts).toEqual({
      destinationCountry: "JP",
      lastMile: { carrierCode: "SAGAWA", trackingNumber: "900011112222" },
    });
  });

  it("shows a planned last-mile number without treating it as a handoff", async () => {
    const planned = {
      ...handedOver,
      data: { ...handedOver.data, trackingList: handedOver.data.trackingList.slice(1) },
    };
    const result = await createFourPxClient({ ...keys, fetch: reply(planned) }).track(
      "4PX3002711212113CN",
      "4PX",
    );
    expect(result.handoff).toBeNull();
    expect(result.facts?.lastMile).toEqual({
      carrierCode: "SAGAWA",
      trackingNumber: "900011112222",
    });
  });

  it("ignores a last-mile number that is just the 4PX number again, or names no carrier", async () => {
    for (const data of [
      { serverName: "", serverNum: "4PX3002711212113CN" },
      { serverName: null, serverNum: "900011112222" },
    ]) {
      const result = await createFourPxClient({
        ...keys,
        fetch: reply({ ...handedOver, data: { ...handedOver.data, ...data } }),
      }).track("4PX3002711212113CN", "4PX");
      expect(result.handoff).toBeNull();
      expect(result.facts?.lastMile).toBeNull();
    }
  });

  it("copes with a response that has no data", async () => {
    const result = await createFourPxClient({
      ...keys,
      fetch: reply({ result: 1, errors: [] }),
    }).track("4PX1CN", "4PX");
    expect(result).toEqual({
      events: [],
      handoff: null,
      facts: { destinationCountry: null, lastMile: null },
    });
  });

  it("reports an unknown number as NOT_FOUND rather than an error", async () => {
    const result = await createFourPxClient({
      ...keys,
      fetch: reply({
        result: "0",
        msg: "失败",
        errors: [{ errorCode: "0", errorMsg: "The order number is empty or does not exist" }],
      }),
    }).track("4PX1CN", "4PX");
    expect(result).toEqual({ events: [], handoff: null, state: "NOT_FOUND" });
  });

  it("backs off when 4PX says it is being asked too often", async () => {
    for (const fetch of [
      reply({ result: "0", errors: [{ error_code: "DS000007", error_msg: "处理中" }] }),
      reply({ message: "com.fpx.openapi.ApiException: 访问太过频繁,请一分钟后再试" }, 500),
      reply("slow down", 429),
    ]) {
      await expect(
        createFourPxClient({ ...keys, fetch }).track("4PX1CN", "4PX"),
      ).rejects.toBeInstanceOf(RateLimitedError);
    }
  });

  it("explains other refusals, from the gateway or the tracking service", async () => {
    await expect(
      createFourPxClient({
        ...keys,
        fetch: reply({ message: "com.fpx.openapi.oauth2.exception.ApiException: APP不存在" }, 500),
      }).track("4PX1CN", "4PX"),
    ).rejects.toThrow("4PX refused the request (500): APP不存在");
    await expect(
      createFourPxClient({ ...keys, fetch: reply("<html>Bad gateway</html>", 502) }).track(
        "4PX1CN",
        "4PX",
      ),
    ).rejects.toThrow("(502): <html>Bad gateway</html>");
    await expect(
      createFourPxClient({ ...keys, fetch: reply("", 503) }).track("4PX1CN", "4PX"),
    ).rejects.toThrow("(503): no details");
    await expect(
      createFourPxClient({
        ...keys,
        fetch: reply({ result: "0", msg: "签名错误", errors: [] }),
      }).track("4PX1CN", "4PX"),
    ).rejects.toThrow(FourPxError);
  });

  it("fails clearly when the keys are missing", async () => {
    await expect(createFourPxClient({ appKey: "k" }).track("4PX1CN", "4PX")).rejects.toThrow(
      "FOURPX_APP_SECRET is not set",
    );
  });

  it("works as the 4px adapter, using the test platform when configured", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const adapter = adapterFor(
      { code: "4PX", adapter: "4px" },
      {
        env: {
          FOURPX_APP_KEY: "k",
          FOURPX_APP_SECRET: "s",
          FOURPX_API_URL: "https://open-test.4px.com/router/api/service",
        },
        fetch: reply(handedOver, 200, requests),
      },
    );
    const events = await adapter.fetchEvents("4PX3002711212113CN");
    expect(events.map((e) => normalise("4PX", e))).toEqual(["PENDING", "IN_TRANSIT", "HANDED_OFF"]);
    expect(events.map((e) => classifyStage("4PX", e))).toEqual([
      "LABEL_CREATED",
      "ARRIVED_DESTINATION",
      "HANDED_OFF",
    ]);
    expect(adapter.detectHandoff?.(events)).toEqual({
      nextCarrierCode: "SAGAWA",
      nextTrackingNumber: "900011112222",
    });
    expect(requests[0]?.url.startsWith("https://open-test.4px.com/router/api/service?")).toBe(true);
  });
});

describe("4PX business link codes", () => {
  it("recognises 4PX codes only", () => {
    expect(isFourPxCode("FPX_D_STPP")).toBe(true);
    expect(isFourPxCode("fpx_s_ok")).toBe(true);
    expect(isFourPxCode("HANDOVER")).toBe(false);
    expect(fourPxStage("HANDOVER")).toBeUndefined();
    expect(fourPxStatus("HANDOVER")).toBeUndefined();
  });

  it.each([
    ["FPX_L_RPIF", "LABEL_CREATED", "PENDING"],
    ["FPX_C_SPLS", "PICKED_UP", "SHIPPED"],
    ["FPX_M_DFOA", "DEPARTED_ORIGIN", "IN_TRANSIT"],
    ["FPX_M_ATA", "ARRIVED_DESTINATION", "IN_TRANSIT"],
    ["FPX_I_RCUK", "CUSTOMS_CLEARED", "IN_TRANSIT"],
    ["FPX_D_STPP", "HANDED_OFF", "HANDED_OFF"],
    ["FPX_O_RR", "LAST_MILE_ACCEPTED", "HANDED_OFF"],
    ["FPX_D_SD", "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY"],
    ["FPX_D_ATDE", "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY"],
    ["FPX_S_OKCC", "DELIVERED", "DELIVERED"],
  ])("maps the milestone %s to %s (%s)", (code, stage, status) => {
    expect(fourPxStage(code)).toBe(stage);
    expect(fourPxStatus(code)).toBe(status);
  });

  it.each([
    ["FPX_M_TDBW", "DELAYED", "IN_TRANSIT"], // bad weather
    ["FPX_D_DDPH", "DELAYED", "IN_TRANSIT"], // public holiday
    ["FPX_I_HCCI", "CUSTOMS_HOLD", "EXCEPTION"], // held: needs consignee's information
    ["FPX_Q_IH", "CUSTOMS_HOLD", "EXCEPTION"], // export: incomplete HS code
    ["FPX_M_HCSC", "CUSTOMS_HOLD", "EXCEPTION"], // held in transit customs
    ["FPX_D_FDF", "DELIVERY_FAILED", "EXCEPTION"], // first delivery failed
    ["FPX_D_DDRH", "DELIVERY_FAILED", "EXCEPTION"], // not at home (a "delivery delay" code)
    ["FPX_D_DEFB", "ADDRESS_PROBLEM", "EXCEPTION"],
    ["FPX_D_SASPS", "AWAITING_PICKUP", "OUT_FOR_DELIVERY"],
    ["FPX_D_FDR", "RETURNING", "RETURNED"],
    ["FPX_M_PRTS", "RETURNED", "RETURNED"],
    ["FPX_D_FDPL", "EXCEPTION", "EXCEPTION"], // lost
    ["FPX_C_PRHB", "EXCEPTION", "EXCEPTION"], // warehouse: prohibited item
  ])("maps the problem %s to %s (%s)", (code, stage, status) => {
    expect(fourPxStage(code)).toBe(stage);
    expect(fourPxStatus(code)).toBe(status);
  });

  it("treats normal progress as in transit with no stage, and flags codes 4PX adds later", () => {
    expect(classifyFourPxCode("FPX_I_PTCW")).toEqual({ kind: "progress" });
    expect(fourPxStage("FPX_M_HA")).toBeNull();
    expect(fourPxStatus("FPX_M_HA")).toBe("IN_TRANSIT");
    expect(classifyFourPxCode("FPX_Z_NEW")).toEqual({ kind: "unknown" });
    expect(fourPxStage("FPX_Z_NEW")).toBeNull();
    expect(fourPxStatus("FPX_Z_NEW")).toBeNull();
  });
});
