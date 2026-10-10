import { describe, expect, it } from "vitest";
import { isStatus, isTerminal, STATUSES } from "./status";

describe("Status", () => {
  it("recognises every declared status", () => {
    for (const status of STATUSES) expect(isStatus(status)).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isStatus("LOST")).toBe(false);
    expect(isStatus("delivered")).toBe(false);
  });

  it("treats DELIVERED and RETURNED as terminal", () => {
    const terminal = STATUSES.filter(isTerminal);
    expect(terminal).toEqual(["DELIVERED", "RETURNED"]);
  });
});
