import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  IllegalTransitionError,
  allLegalTransitions,
  STATES,
  type State,
} from "./state-machine.js";

describe("state machine", () => {
  it("every legal transition succeeds", () => {
    for (const { from, to } of allLegalTransitions()) {
      expect(canTransition(from, to)).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("exactly these edges are legal", () => {
    expect(allLegalTransitions()).toEqual([
      { from: "draft", to: "in_review" },
      { from: "in_review", to: "approved" },
      { from: "in_review", to: "rejected" },
      { from: "approved", to: "superseded" },
    ]);
  });

  it("rejects every non-legal edge with a typed error", () => {
    const legal = new Set(
      allLegalTransitions().map((e) => `${e.from}->${e.to}`),
    );
    for (const from of STATES) {
      for (const to of STATES) {
        if (from === to) continue;
        if (legal.has(`${from}->${to}`)) continue;
        expect(canTransition(from, to)).toBe(false);
        expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
      }
    }
  });

  it("terminal states (superseded, rejected) have no outgoing edges", () => {
    for (const to of STATES) {
      if (to === "superseded" || to === "in_review") continue;
      expect(canTransition("superseded", to as State)).toBe(false);
    }
    for (const to of STATES) {
      if (to === "in_review") continue;
      expect(canTransition("rejected", to as State)).toBe(false);
    }
  });

  it("the four key enforcement rules", () => {
    // Cannot approve a draft — must go through in_review first.
    expect(canTransition("draft", "approved")).toBe(false);
    // Cannot re-approve an already-approved version.
    expect(canTransition("approved", "approved")).toBe(false);
    // Cannot move out of rejected or superseded (no resurrection).
    expect(canTransition("rejected", "in_review")).toBe(false);
    expect(canTransition("superseded", "approved")).toBe(false);
  });

  it("IllegalTransitionError carries from and to for the API to map to 409", () => {
    try {
      assertTransition("rejected", "approved");
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      const err = e as IllegalTransitionError;
      expect(err.from).toBe("rejected");
      expect(err.to).toBe("approved");
      return;
    }
    expect.fail("expected throw");
  });
});
