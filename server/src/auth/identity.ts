import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { users, identities, orgMemberships } from "../db/schema.js";
import { acceptPendingInvites } from "./access.js";

/**
 * Identity is keyed by EMAIL. GitHub / Google / email magic-link with the same
 * email all merge into a single account. `identities` records (provider,
 * subject) → userId so we can detect a returning provider subject.
 */

/** Find an existing user by email (case-insensitive). */
export function findUserByEmail(db: DB, email: string) {
  const e = email.toLowerCase().trim();
  return db.select().from(users).where(eq(users.email, e)).get() ?? undefined;
}

/** Find an existing user by a linked (provider, subject). */
export function findUserBySubject(db: DB, provider: string, subject: string) {
  const row = db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
    .get();
  if (!row) return undefined;
  return db.select().from(users).where(eq(users.id, row.userId)).get() ?? undefined;
}

export interface FindOrCreateResult {
  userId: string;
  created: boolean;
}

/**
 * Find-or-create a user by email. If a name is given and the user is new (or
 * has no name), it's applied. Pending org invitations for the email are
 * auto-accepted on create.
 */
export function findOrCreateUserByEmail(
  db: DB,
  email: string,
  name?: string,
  avatarUrl?: string | null,
): FindOrCreateResult {
  const e = email.toLowerCase().trim();
  const existing = db.select().from(users).where(eq(users.email, e)).get();
  if (existing) {
    return { userId: existing.id, created: false };
  }
  const id = newId();
  db.insert(users)
    .values({
      id,
      email: e,
      name: name || e.split("@")[0] || "user",
      avatarUrl: avatarUrl ?? null,
      createdAt: Date.now(),
    })
    .run();
  acceptPendingInvites(db, id, e);
  return { userId: id, created: true };
}

/** Link a (provider, subject) to a user. Idempotent. */
export function linkIdentity(
  db: DB,
  userId: string,
  provider: string,
  subject: string,
): void {
  const existing = db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
    .get();
  if (existing) {
    if (existing.userId !== userId) {
      // Re-link to the new user (the email is the canonical key).
      db.update(identities)
        .set({ userId })
        .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
        .run();
    }
    return;
  }
  db.insert(identities)
    .values({ userId, provider, subject, createdAt: Date.now() })
    .run();
}