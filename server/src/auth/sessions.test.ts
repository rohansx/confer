import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createSessionCookie,
  verifySession,
  SessionError,
  parseCookie,
  buildSetCookie,
  SESSION_COOKIE_NAME,
} from "./sessions.js";

const SECRET = "test-secret";

describe("sessions", () => {
  it("creates and verifies a valid session", () => {
    const c = createSessionCookie(SECRET, "u_123", 60);
    const payload = verifySession(SECRET, c.value);
    expect(payload.userId).toBe("u_123");
    expect(payload.exp).toBe(c.exp);
  });

  it("rejects a tampered cookie", () => {
    const c = createSessionCookie(SECRET, "u_123", 60);
    const [u, e, s] = c.value.split(".");
    // swap user
    const tampered = `evil.${e}.${s}`;
    expect(() => verifySession(SECRET, tampered)).toThrow(SessionError);
    expect(() => verifySession(SECRET, `${u}.${e}.AAAA`)).toThrow(SessionError);
  });

  it("rejects an expired session", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const sig = createHmac("sha256", SECRET)
      .update(`u_x.${past}`)
      .digest("base64url");
    expect(() => verifySession(SECRET, `u_x.${past}.${sig}`)).toThrow(/expired/);
  });

  it("rejects a malformed cookie", () => {
    expect(() => verifySession(SECRET, "")).toThrow();
    expect(() => verifySession(SECRET, "only-one-part")).toThrow();
    expect(() => verifySession(SECRET, "a.b.c.d")).toThrow();
  });

  it("rejects a session signed with a different secret", () => {
    const c = createSessionCookie("other-secret", "u_123", 60);
    expect(() => verifySession(SECRET, c.value)).toThrow(SessionError);
  });

  it("parseCookie extracts the confer_session value", () => {
    const header = "foo=bar; confer_session=abc.def.ghi; baz=qux";
    expect(parseCookie(header)).toBe("abc.def.ghi");
    expect(parseCookie(header, "foo")).toBe("bar");
    expect(parseCookie(null)).toBeNull();
  });

  it("buildSetCookie includes HttpOnly + SameSite=Lax + Expires; Secure only in prod", () => {
    const sc = buildSetCookie("v", Math.floor(Date.now() / 1000) + 60, false);
    expect(sc).toContain(`${SESSION_COOKIE_NAME}=v`);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Expires=");
    expect(sc).not.toContain("Secure");

    const scProd = buildSetCookie("v", Math.floor(Date.now() / 1000) + 60, true);
    expect(scProd).toContain("Secure");
  });
});
