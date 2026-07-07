import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedContent {
  hash: string;
  orgId: string;
}

function sign(secret: string, hash: string, orgId: string, exp: number): string {
  return createHmac("sha256", secret).update(`${hash}.${orgId}.${exp}`).digest("base64url");
}

/**
 * Mint a signed, short-lived, org-scoped content URL on the view origin.
 * The signature binds hash + orgId + expiry, so a URL cannot be replayed for a
 * different blob or org, and expires after `ttlSec`. `now` is injectable for tests.
 */
export function signContentUrl(
  viewOrigin: string,
  secret: string,
  hash: string,
  orgId: string,
  ttlSec: number,
  now: number = Date.now(),
): string {
  const exp = now + ttlSec * 1000;
  const sig = sign(secret, hash, orgId, exp);
  const q = new URLSearchParams({ o: orgId, e: String(exp), s: sig });
  return `${viewOrigin}/c/${hash}?${q.toString()}`;
}

/**
 * Verify the signed query for a content request. Returns the bound
 * { hash, orgId } or null (bad/absent signature, expired, or tampered).
 */
export function verifyContent(
  secret: string,
  hash: string,
  o: string | undefined | null,
  e: string | undefined | null,
  s: string | undefined | null,
  now: number = Date.now(),
): SignedContent | null {
  if (!o || !e || !s) return null;
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < now) return null;
  const expected = sign(secret, hash, o, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { hash, orgId: o };
}
