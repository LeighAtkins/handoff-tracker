import { describe, expect, it } from "vitest";
import { manualEvent } from "./manual";
import type { AggregatorClient } from "./aggregators/aggregator";
import { adapterFor, firstWithEvents, trackingProviders } from "./registry";
import { RateLimitedError } from "./adapter";

describe("adapterFor", () => {
  it("builds the fake adapter", () => {
    expect(adapterFor({ code: "4PX", adapter: "fake" }).detectHandoff).toBeTypeOf("function");
  });

  it("falls back to manual, which never fetches anything", async () => {
    const adapter = adapterFor({ code: "YAMATO", adapter: "something-else" });
    expect(adapter.code).toBe("YAMATO");
    expect(await adapter.fetchEvents("x")).toEqual([]);
  });
});

describe("firstWithEvents", () => {
  const client = (name: string, events: number): AggregatorClient => ({
    name,
    track: async () => ({
      events: Array.from({ length: events }, (_, i) => ({
        occurredAt: new Date(i),
        rawStatus: "",
        rawMessage: name,
        location: null,
        carrierCode: "SAGAWA",
        trackingNumber: "368764353296",
      })),
      handoff: null,
      state: events ? undefined : "NOT_FOUND",
    }),
  });

  it("falls back to the next client when the first has nothing yet", async () => {
    const result = await firstWithEvents("SAGAWA", [
      client("sagawa", 0),
      client("takesend", 2),
    ]).track("368764353296", "SAGAWA");
    expect(result.events.map((e) => e.rawMessage)).toEqual(["takesend", "takesend"]);
  });

  it("prefers the first client once it has events, and reports not found if nobody has any", async () => {
    const first = await firstWithEvents("SAGAWA", [
      client("sagawa", 1),
      client("takesend", 2),
    ]).track("x", "SAGAWA");
    expect(first.events[0]!.rawMessage).toBe("sagawa");
    const none = await firstWithEvents("SAGAWA", [client("a", 0), client("b", 0)]).track(
      "x",
      "SAGAWA",
    );
    expect(none.state).toBe("NOT_FOUND");
  });
});

describe("trackingProviders", () => {
  it("lists 4PX first, then the public sites, then the aggregators, and says which are configured", () => {
    const providers = trackingProviders({
      env: { FOURPX_APP_KEY: "k", SHIP24_API_KEY: "k", SEVENTEEN_TRACK_API_KEY: "" },
    });
    expect(providers.map((p) => [p.name, p.configured, p.keys])).toEqual([
      ["4PX", false, ["FOURPX_APP_KEY", "FOURPX_APP_SECRET"]],
      ["4PX_WEB", true, []],
      ["SAGAWA", true, []],
      ["SHIP24", true, ["SHIP24_API_KEY"]],
      ["17TRACK", false, ["SEVENTEEN_TRACK_API_KEY"]],
      ["AFTERSHIP", false, ["AFTERSHIP_API_KEY"]],
    ]);
    expect(providers.map((p) => p.client.name)).toEqual([
      "4PX",
      "4PX_WEB",
      "SAGAWA",
      "SHIP24",
      "17TRACK",
      "AFTERSHIP",
    ]);
  });

  it("reads the environment by default", () => {
    expect(trackingProviders()).toHaveLength(6);
  });
});

describe("manualEvent", () => {
  it("trims input and marks the raw status as MANUAL", () => {
    const at = new Date();
    expect(
      manualEvent({ occurredAt: at, message: "  Called Sagawa: at depot ", location: "  " }),
    ).toEqual({
      occurredAt: at,
      rawStatus: "MANUAL",
      rawMessage: "Called Sagawa: at depot",
      location: null,
    });
  });
});

describe("RateLimitedError", () => {
  it("describes the retry window", () => {
    expect(new RateLimitedError("SHIP24", 30).message).toBe("SHIP24 rate limited; retry after 30s");
    expect(new RateLimitedError("SHIP24", null).message).toBe("SHIP24 rate limited");
  });
});
