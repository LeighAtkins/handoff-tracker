import { describe, expect, it } from "vitest";
import { HAPPY_PATH, isStatus, isTerminal, STATUSES, transition, type Status } from "./status";

describe("Status", () => {
  it("recognises every declared status", () => {
    for (const status of STATUSES) expect(isStatus(status)).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isStatus("LOST")).toBe(false);
    expect(isStatus("delivered")).toBe(false);
  });

  it("treats DELIVERED and RETURNED as terminal", () => {
    expect(STATUSES.filter(isTerminal)).toEqual(["DELIVERED", "RETURNED"]);
  });
});

describe("transition", () => {
  it("moves forward along the happy path", () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i++) {
      for (let j = i + 1; j < HAPPY_PATH.length; j++) {
        expect(transition(HAPPY_PATH[i]!, HAPPY_PATH[j]!)).toBe(HAPPY_PATH[j]);
      }
    }
  });

  it("never moves backwards along the happy path", () => {
    expect(transition("HANDED_OFF", "IN_TRANSIT")).toBe("HANDED_OFF");
    expect(transition("OUT_FOR_DELIVERY", "SHIPPED")).toBe("OUT_FOR_DELIVERY");
    expect(transition("IN_TRANSIT", "IN_TRANSIT")).toBe("IN_TRANSIT");
  });

  it("allows EXCEPTION and RETURNED from any non-terminal status", () => {
    const nonTerminal = STATUSES.filter((s) => !isTerminal(s));
    for (const from of nonTerminal) {
      expect(transition(from, "EXCEPTION")).toBe("EXCEPTION");
      expect(transition(from, "RETURNED")).toBe("RETURNED");
    }
  });

  it("never leaves a terminal status", () => {
    for (const from of ["DELIVERED", "RETURNED"] as Status[]) {
      for (const incoming of STATUSES) expect(transition(from, incoming)).toBe(from);
    }
  });

  it("resumes the happy path once an exception clears", () => {
    expect(transition("EXCEPTION", "IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(transition("EXCEPTION", "DELIVERED")).toBe("DELIVERED");
  });
});
