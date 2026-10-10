import { describe, expect, it } from "vitest";
import { manualEvent } from "./manual";
import { adapterFor } from "./registry";
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
