import { describe, it, expect } from "vitest";
import { signContentUrl, verifyContent } from "./signed-url.js";

const secret = "s3cr3t";
const view = "http://view.local";
const parts = (url: string) => {
  const u = new URL(url);
  return {
    o: u.searchParams.get("o"),
    e: u.searchParams.get("e"),
    s: u.searchParams.get("s"),
  };
};

describe("signed content URLs", () => {
  it("round-trips a valid signature", () => {
    const url = signContentUrl(view, secret, "abc", "org1", 300);
    const u = new URL(url);
    expect(u.origin).toBe(view);
    expect(u.pathname).toBe("/c/abc");
    const p = parts(url);
    expect(verifyContent(secret, "abc", p.o, p.e, p.s)).toEqual({ hash: "abc", orgId: "org1" });
  });

  it("rejects a tampered signature", () => {
    const p = parts(signContentUrl(view, secret, "abc", "org1", 300));
    expect(verifyContent(secret, "abc", p.o, p.e, "tampered")).toBeNull();
  });

  it("rejects cross-org (orgId swapped, signature kept)", () => {
    const p = parts(signContentUrl(view, secret, "abc", "org1", 300));
    expect(verifyContent(secret, "abc", "org2", p.e, p.s)).toBeNull();
  });

  it("rejects a different hash than was signed", () => {
    const p = parts(signContentUrl(view, secret, "abc", "org1", 300));
    expect(verifyContent(secret, "xyz", p.o, p.e, p.s)).toBeNull();
  });

  it("rejects an expired URL", () => {
    const now = 1_000_000;
    const p = parts(signContentUrl(view, secret, "abc", "org1", 300, now));
    expect(verifyContent(secret, "abc", p.o, p.e, p.s, now + 301_000)).toBeNull();
  });

  it("rejects a missing signature entirely", () => {
    expect(verifyContent(secret, "abc", null, null, null)).toBeNull();
  });
});
