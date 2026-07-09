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

/**
 * Create a token. EITHER `orgId` OR `ownerId` must be set (not both, not neither).
 * Stores only the hash; returns the plaintext ONCE.
 */
export function createToken(
  db: DB,
  scope: { orgId?: string; ownerId?: string },
  name: string,
  scopes: Scope[],
): { raw: string; id: string } {
  const { orgId, ownerId } = scope;
  if (!orgId && !ownerId) throw new Error("createToken: orgId or ownerId required");
  if (orgId && ownerId) throw new Error("createToken: pass orgId OR ownerId, not both");
  const raw = "confer_" + randomBytes(24).toString("base64url");
  const id = newId();
  db.insert(tokens)
    .values({ id, orgId: orgId ?? null, ownerId: ownerId ?? null, name, hash: hashRaw(raw), scopes: scopes.join(",") })
    .run();
  return { raw, id };
}

/**
 * Verify a bearer token; returns its scope (org or owner) + scopes, or null.
 * Bumps lastUsedAt.
 */
export async function verifyToken(
  db: DB,
  raw: string,
): Promise<{ orgId: string | null; ownerId: string | null; scopes: Scope[] } | null> {
  const row = db.select().from(tokens).where(eq(tokens.hash, hashRaw(raw))).get();
  if (!row) return null;
  db.update(tokens).set({ lastUsedAt: Date.now() }).where(eq(tokens.id, row.id)).run();
  return { orgId: row.orgId, ownerId: row.ownerId, scopes: row.scopes.split(",") as Scope[] };
}

export function hasScope(scopes: Scope[], want: Scope): boolean {
  return scopes.includes(want);
}

/** List a scope's tokens (never the hash). `scope.orgId` or `scope.ownerId`. */
export function listTokens(
  db: DB,
  scope: { orgId?: string; ownerId?: string },
): Array<{ id: string; name: string; scopes: string; lastUsedAt: number | null; createdBy: string | null }> {
  const where = scope.orgId
    ? eq(tokens.orgId, scope.orgId)
    : eq(tokens.ownerId, scope.ownerId!);
  return db
    .select({ id: tokens.id, name: tokens.name, scopes: tokens.scopes, lastUsedAt: tokens.lastUsedAt, createdBy: tokens.createdBy })
    .from(tokens)
    .where(where)
    .all();
}

/** Revoke (delete) a token by id. */
export function deleteToken(db: DB, id: string): void {
  db.delete(tokens).where(eq(tokens.id, id)).run();
}