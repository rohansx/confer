import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { eq } from "drizzle-orm";
import type { TokenScope } from "@confer/shared";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { tokens } from "../db/schema.js";

/** Alias kept for call-site compatibility; the canonical union lives in @confer/shared. */
export type Scope = TokenScope;

function hashRaw(raw: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(raw)));
}

/** Create an org-scoped token. Stores only the hash; returns the plaintext ONCE. */
export function createToken(
  db: DB,
  orgId: string,
  name: string,
  scopes: Scope[],
): { raw: string; id: string } {
  const raw = "confer_" + randomBytes(24).toString("base64url");
  const id = newId();
  db.insert(tokens)
    .values({ id, orgId, name, hash: hashRaw(raw), scopes: scopes.join(",") })
    .run();
  return { raw, id };
}

/** Verify a bearer token; returns its org + scopes, or null. Bumps lastUsedAt. */
export async function verifyToken(
  db: DB,
  raw: string,
): Promise<{ orgId: string; scopes: Scope[] } | null> {
  const row = db.select().from(tokens).where(eq(tokens.hash, hashRaw(raw))).get();
  if (!row) return null;
  db.update(tokens).set({ lastUsedAt: Date.now() }).where(eq(tokens.id, row.id)).run();
  return { orgId: row.orgId, scopes: row.scopes.split(",") as Scope[] };
}

export function hasScope(scopes: Scope[], want: Scope): boolean {
  return scopes.includes(want);
}

/** List an org's tokens (never the hash). */
export function listTokens(
  db: DB,
  orgId: string,
): Array<{ id: string; name: string; scopes: string; lastUsedAt: number | null; createdBy: string | null }> {
  return db
    .select({ id: tokens.id, name: tokens.name, scopes: tokens.scopes, lastUsedAt: tokens.lastUsedAt, createdBy: tokens.createdBy })
    .from(tokens)
    .where(eq(tokens.orgId, orgId))
    .all();
}

/** Revoke (delete) a token by id. */
export function deleteToken(db: DB, id: string): void {
  db.delete(tokens).where(eq(tokens.id, id)).run();
}