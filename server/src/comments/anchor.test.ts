import { describe, it, expect } from "vitest";
import { resolveAnchor, makeAnchor } from "./anchor.js";

describe("resolveAnchor", () => {
  it("returns lost when quote is empty", () => {
    const r = resolveAnchor({ quote: "" }, "any text");
    expect(r.lost).toBe(true);
  });

  it("returns lost when quote is not in the text", () => {
    const r = resolveAnchor({ quote: "not present" }, "the quick brown fox");
    expect(r.lost).toBe(true);
  });

  it("finds a single occurrence and returns the offsets", () => {
    const text = "the quick brown fox";
    const r = resolveAnchor({ quote: "brown" }, text);
    expect(r.lost).toBe(false);
    expect(text.slice(r.start, r.end)).toBe("brown");
  });

  it("picks the right match when the word appears multiple times (with prefix)", () => {
    const text = "alpha beta gamma beta delta";
    const r = resolveAnchor({ quote: "beta", prefix: "gamma " }, text);
    expect(r.lost).toBe(false);
    expect(text.slice(r.start, r.end)).toBe("beta");
    // The right match is the one after "gamma " (the second beta).
    expect(text.slice(Math.max(0, r.start - 6), r.end)).toBe("gamma beta");
  });

  it("returns ambiguous=true when multiple top-scoring candidates", () => {
    const text = "beta alpha beta alpha beta";
    const r = resolveAnchor({ quote: "beta" }, text);
    expect(r.lost).toBe(false);
    expect(r.ambiguous).toBe(true);
  });

  it("uses suffix to disambiguate when prefix doesn't help", () => {
    const text = "beta is here. then beta is there.";
    const r = resolveAnchor({ quote: "beta", suffix: " is there" }, text);
    expect(r.lost).toBe(false);
    expect(text.slice(r.start, r.end)).toBe("beta");
    expect(text.slice(r.start, r.end + 10)).toContain("is there");
  });

  it("makeAnchor captures prefix and suffix from a selection", () => {
    const text = "the quick brown fox jumps over";
    const a = makeAnchor(text, text.indexOf("brown"), text.indexOf("brown") + "brown".length);
    expect(a.quote).toBe("brown");
    expect(a.prefix).toContain("quick");
    expect(a.suffix).toContain("fox");
  });
});
