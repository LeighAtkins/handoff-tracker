import { describe, expect, it } from "vitest";
import { manualEvent } from "./manual";
import { adapterFor, trackingProviders } from "./registry";
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

describe("trackingProviders", () => {
  it("lists 4PX first, then the aggregators, and says which are configured", () => {
    const providers = trackingProviders({
      env: { FOURPX_APP_KEY: "k", SHIP24_API_KEY: "k", SEVENTEEN_TRACK_API_KEY: "" },
    });
    expect(providers.map((p) => [p.name, p.configured, p.keys])).toEqual([
      ["4PX", false, ["FOURPX_APP_KEY", "FOURPX_APP_SECRET"]],
      ["SHIP24", true, ["SHIP24_API_KEY"]],
      ["17TRACK", false, ["SEVENTEEN_TRACK_API_KEY"]],
      ["AFTERSHIP", false, ["AFTERSHIP_API_KEY"]],
    ]);
    expect(providers.map((p) => p.client.name)).toEqual(["4PX", "SHIP24", "17TRACK", "AFTERSHIP"]);
  });

  it("reads the environment by default", () => {
    expect(trackingProviders()).toHaveLength(4);
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
