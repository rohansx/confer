import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { magicLinks } from "../db/schema.js";

/**
 * Email magic links: one-time, hashed-at-rest (like push tokens). A link is
 * `confer_ml_<random>`; only the hash is stored. Consuming marks it used and
 * returns the email it was issued for, so the auth route can find-or-create
 * the user and mint a session.
 */

const PREFIX = "confer_ml_";
const TTL_SEC = 15 * 60; // 15 minutes

function hashRaw(raw: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

/** Create a magic link for an email. Returns the plaintext token ONCE. */
export function createMagicLink(db: DB, email: string): string {
  const e = email.toLowerCase().trim();
  const raw = PREFIX + randomBytes(24).toString("base64url");
  const id = newId();
  const now = Date.now();
  db.insert(magicLinks)
    .values({
      id,
      email: e,
      hash: hashRaw(raw),
      expiresAt: Math.floor(now / 1000) + TTL_SEC,
      createdAt: now,
    })
    .run();
  return raw;
}

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** Consume (verify + mark used) a magic link. One-shot. */
export function consumeMagicLink(db: DB, raw: string): ConsumeResult {
  const row = db.select().from(magicLinks).where(eq(magicLinks.hash, hashRaw(raw))).get();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.usedAt !== null) return { ok: false, reason: "used" };
  if (Math.floor(Date.now() / 1000) >= row.expiresAt) return { ok: false, reason: "expired" };

  db.update(magicLinks)
    .set({ usedAt: Date.now() })
    .where(eq(magicLinks.id, row.id))
    .run();
  return { ok: true, email: row.email };
}

/** Purge expired/used links. Best-effort; called opportunistically. */
export function purgeMagicLinks(db: DB): void {
  const now = Math.floor(Date.now() / 1000);
  const rows = db.select().from(magicLinks).all();
  for (const r of rows) {
    if (r.usedAt !== null || now >= r.expiresAt) {
      db.delete(magicLinks).where(eq(magicLinks.id, r.id)).run();
    }
  }
}