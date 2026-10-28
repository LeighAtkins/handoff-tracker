import { describe, expect, it } from "vitest";
import { RateLimitedError } from "../adapter";
import type { FetchLike } from "../aggregators/http";
import { createTakesendClient, parseTakesend, TAKESEND_TRACK_URL, takesendTime } from "./client";

/** Trimmed from Takesend's real answer for a UPS parcel to the UK (2026-10-26). */
const delivered = `<?xml version="1.0" encoding="UTF-8"?>
<xdoc>
  <xout>
    <track index="0" searchBillid="1Z0114E10495607789" billid="" desti="GB  NEW MILTON" intro="DELIVERED " sdate="2026-10-23 14:49:26" trackstatus="200" statusname="签收" statusnameus="Delivery">
      <trackitem index="trackitem_0_0" sdate="2026-10-23 14:49:26" place="GB  NEW MILTON" intro="DELIVERED " statusname="签收" statusnameus="Delivery" />
      <trackitem index="trackitem_0_1" sdate="2026-10-22 13:15:45" place="GB  Southampton" intro="UPS Access Point&#39;s possession " statusname="到达待取" statusnameus="" />
      <trackitem index="trackitem_0_2" sdate="2026-10-14 22:20:00" place="CN  Shenzhen" intro="Departed from Facility" statusname="航班飞离" statusnameus="" />
    </track>
  </xout>
</xdoc>`;

const summaryOnly = `<xdoc><xout><track index="0" searchBillid="1Z0114E10400223095" desti="GB  Manchester" intro="Out For Delivery" sdate="2026-10-26 06:55:57" trackstatus="101" statusnameus="Official Update" /></xout></xdoc>`;
const unknown = `<xdoc><xout><track index="0" billid="879041083962" searchBillid="879041083962" /></xout></xdoc>`;

function answers(...bodies: (string | number)[]) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
    const body = bodies[Math.min(requests.length - 1, bodies.length - 1)]!;
    return typeof body === "number" ? new Response("busy", { status: body }) : new Response(body);
  };
  return { fetch, requests };
}

describe("parseTakesend", () => {
  it("reads the scans oldest first, the latest event and the delivered flag", () => {
    const parcel = parseTakesend("1Z0114E10495607789", delivered);
    expect(parcel.found).toBe(true);
    expect(parcel.delivered).toBe(true);
    expect(parcel.latest).toEqual({
      localTime: "2026-10-23 14:49:26",
      place: "GB NEW MILTON",
      message: "DELIVERED",
    });
    expect(parcel.scans.map((s) => s.message)).toEqual([
      "Departed from Facility",
      "UPS Access Point's possession",
      "DELIVERED",
    ]);
  });

  it("keeps a summary without scans, and treats an empty track as not found", () => {
    const parcel = parseTakesend("1Z0114E10400223095", summaryOnly);
    expect(parcel).toMatchObject({ found: true, delivered: false, scans: [] });
    expect(parcel.latest?.message).toBe("Out For Delivery");
    expect(parseTakesend("879041083962", unknown)).toMatchObject({ found: false, latest: null });
    expect(parseTakesend("x", "<html>maintenance</html>").found).toBe(false);
  });
});

describe("takesendTime", () => {
  it("reads the local time as written, without a zone", () => {
    expect(takesendTime("2026-10-23 14:49:26")).toEqual(new Date("2026-10-23T14:49:26Z"));
    expect(takesendTime("2026-10-23 14:49")).toEqual(new Date("2026-10-23T14:49:00Z"));
    expect(takesendTime("soon")).toBeNull();
  });
});

describe("createTakesendClient", () => {
  it("posts the number like the tracking page does", async () => {
    const { fetch, requests } = answers(delivered);
    await createTakesendClient({ fetch }).trackParcel("1Z0114E10495607789");
    expect(requests[0]!.url).toBe(TAKESEND_TRACK_URL);
    expect(new URLSearchParams(requests[0]!.init!.body as string).get("billid")).toBe(
      "1Z0114E10495607789",
    );
  });

  it("asks for Takesend's copy first, and for a live fetch only when that is empty", async () => {
    const { fetch, requests } = answers(unknown, delivered);
    const parcel = await createTakesendClient({ fetch, retryDelayMs: 0 }).trackParcel(
      "1Z0114E10495607789",
    );
    expect(parcel.found).toBe(true);
    const repeat = requests.map((r) => new URLSearchParams(r.init!.body as string).get("isRepeat"));
    expect(repeat).toEqual(["no", "yes"]);
  });

  it("retries after an error, but not after a rate limit", async () => {
    const flaky = answers(500, delivered);
    expect((await createTakesendClient({ ...flaky, retryDelayMs: 0 }).trackParcel("x")).found).toBe(
      true,
    );
    await expect(
      createTakesendClient({ ...answers(429), retryDelayMs: 0 }).trackParcel("x"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("tracks as events for the carrier asked about", async () => {
    const client = createTakesendClient({ ...answers(delivered), retryDelayMs: 0 });
    const result = await client.track("1Z0114E10495607789", "UPS");
    expect(result.events.map((e) => [e.carrierCode, e.rawMessage, e.location])).toEqual([
      ["UPS", "Departed from Facility", "CN Shenzhen"],
      ["UPS", "UPS Access Point's possession", "GB Southampton"],
      ["UPS", "DELIVERED", "GB NEW MILTON"],
    ]);
    const missing = createTakesendClient({ ...answers(unknown), retryDelayMs: 0 });
    expect(await missing.track("879041083962", "FEDEX")).toMatchObject({ state: "NOT_FOUND" });
  });
});
