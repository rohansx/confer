import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Self-contained signed session cookie: <userId>.<exp>.<sig(base64url)>
 * No server-side session table needed (v0). Revocation = rotate SIGNING_SECRET.
 */

const COOKIE_NAME = "confer_session";
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload {
  userId: string;
  exp: number; // unix seconds
}

function sign(secret: string, userId: string, exp: number): string {
  const data = `${userId}.${exp}`;
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function b64uDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function createSessionCookie(
  secret: string,
  userId: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): { value: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = sign(secret, userId, exp);
  const value = `${userId}.${exp}.${sig}`;
  return { value, exp };
}

export class SessionError extends Error {
  constructor(msg: string) { super(msg); this.name = "SessionError"; }
}

export function verifySession(secret: string, raw: string | null | undefined): SessionPayload {
  if (!raw) throw new SessionError("missing session");
  const parts = raw.split(".");
  if (parts.length !== 3) throw new SessionError("malformed session");
  const [userId, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) throw new SessionError("malformed session");
  if (Math.floor(Date.now() / 1000) >= exp) throw new SessionError("session expired");

  const expected = sign(secret, userId, exp);
  const a = b64uDecode(sig);
  const b = b64uDecode(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SessionError("bad signature");
  }
  return { userId, exp };
}

export function parseCookie(header: string | null | undefined, name: string = COOKIE_NAME): string | null {
  if (!header) return null;
  for (const piece of header.split(";")) {
    const [k, ...rest] = piece.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function buildSetCookie(value: string, exp: number, isProd: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(exp * 1000).toUTCString()}`,
  ];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/** Used by tests/dev to seed deterministic sessions. */
export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}
