import { describe, expect, it } from "vitest";
import { maskName, maskPostcode } from "./privacy";

describe("maskName", () => {
  it("keeps initials only", () => {
    expect(maskName("Aiko Tanaka")).toBe("A••• T•••••");
    expect(maskName("  Mei  ")).toBe("M••");
  });

  it("never reveals a one-letter name part", () => {
    expect(maskName("J Smith")).toBe("J• S••••");
  });

  it("handles Japanese names by character", () => {
    expect(maskName("田中 愛子")).toBe("田• 愛•");
  });

  it("returns empty for empty input", () => {
    expect(maskName("   ")).toBe("");
  });
});

describe("maskPostcode", () => {
  it("keeps the first block of a separated postcode", () => {
    expect(maskPostcode("150-0001")).toBe("150-••••");
    expect(maskPostcode("SW1A 1AA")).toBe("SW1A •••");
  });

  it("keeps at most three characters of an unseparated postcode", () => {
    expect(maskPostcode("1500001")).toBe("150••••");
    expect(maskPostcode("12")).toBe("1•");
  });
});
