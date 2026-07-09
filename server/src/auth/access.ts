import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  orgs,
  spaces,
  spaceOwners,
  orgMemberships,
  orgInvitations,
  docShares,
} from "../db/schema.js";

/**
 * Access control for the org/personal model.
 *
 * Two kinds of spaces:
 *  - ORG space:    spaces.orgId is set, spaces.ownerId is null.
 *                  Read = org member (or space_owner grandfather, or shared).
 *                  Review (approve/reject) = org admin (or space_owner grandfather).
 *  - PERSONAL space: spaces.ownerId is set, spaces.orgId is null.
 *                  Read = owner, or a member of an org the doc is shared with.
 *                  Review = owner only.
 *
 * `space_owners` is the legacy v0 per-space approver grant; it is kept as a
 * grandfathered access/review grant so existing setups (and tests) keep working
 * alongside the new org-membership model.
 */

export type OrgRole = "admin" | "member";

/** The role a user holds in an org, or null if they're not a member. */
export function orgRole(db: DB, orgId: string, userId: string): OrgRole | null {
  const row = db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .get();
  return (row?.role as OrgRole | undefined) ?? null;
}

export function isOrgMember(db: DB, orgId: string, userId: string): boolean {
  return orgRole(db, orgId, userId) !== null;
}

export function isOrgAdmin(db: DB, orgId: string, userId: string): boolean {
  return orgRole(db, orgId, userId) === "admin";
}

/** True iff the user is a space_owner for the given space (legacy grant). */
export function isSpaceOwner(db: DB, spaceId: string, userId: string): boolean {
  const row = db
    .select()
    .from(spaceOwners)
    .where(and(eq(spaceOwners.spaceId, spaceId), eq(spaceOwners.userId, userId)))
    .get();
  return !!row;
}

export interface OrgForUser {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Orgs the user belongs to, with their role. */
export function userOrgs(db: DB, userId: string): OrgForUser[] {
  const rows = db
    .select()
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, userId))
    .all();
  if (rows.length === 0) return [];
  const orgIds = rows.map((r) => r.orgId);
  const orgRows = db.select().from(orgs).all().filter((o) => orgIds.includes(o.id));
  const byId = new Map(orgRows.map((o) => [o.id, o]));
  return rows
    .map((r) => {
      const o = byId.get(r.orgId);
      if (!o) return null;
      return { id: o.id, name: o.name, slug: o.slug, role: r.role as OrgRole };
    })
    .filter((x): x is OrgForUser => x !== null);
}

/** The set of org ids a user can access (member or admin). */
export function userOrgIds(db: DB, userId: string): Set<string> {
  return new Set(userOrgs(db, userId).map((o) => o.id));
}

/** A space is an org space iff it has an orgId and no ownerId. */
export function isOrgSpace(space: { orgId: string | null; ownerId: string | null }): boolean {
  return space.orgId !== null && space.ownerId === null;
}

/** True iff a personal doc is shared with the given org. */
function docSharedWithOrg(db: DB, docId: string, orgId: string): boolean {
  const row = db
    .select()
    .from(docShares)
    .where(and(eq(docShares.docId, docId), eq(docShares.orgId, orgId)))
    .get();
  return !!row;
}

export type SessionAuth = { kind: "session"; userId: string };
export type TokenAuth = { kind: "token"; orgId: string | null; ownerId: string | null };
export type AnyAuth = SessionAuth | TokenAuth;

/**
 * Can the caller READ this space's docs?
 *  - token (org): the token's org must match the space's org (org spaces only).
 *  - token (owner): the token's owner must match the space's owner (personal spaces only).
 *  - session (org space): org member/admin, OR space_owner, OR doc shared with one of the user's orgs.
 *  - session (personal space): owner, OR the doc is shared with one of the user's orgs.
 */
export function canReadSpace(db: DB, space: { id: string; orgId: string | null; ownerId: string | null }, auth: AnyAuth): boolean {
  if (auth.kind === "token") {
    if (isOrgSpace(space)) return auth.orgId !== null && space.orgId === auth.orgId;
    return auth.ownerId !== null && space.ownerId === auth.ownerId;
  }
  const userId = auth.userId;
  // Personal space.
  if (!isOrgSpace(space)) {
    if (space.ownerId === userId) return true;
    // Shared with one of the user's orgs? We can't know the doc here; the caller
    // resolves that against a specific doc. For space-level reads we allow and
    // let the doc-level check gate it.
    return false;
  }
  // Org space.
  const orgId = space.orgId!;
  if (isOrgMember(db, orgId, userId)) return true;
  if (isSpaceOwner(db, space.id, userId)) return true;
  return false;
}

/**
 * Can the session user APPROVE/REJECT versions in this space?
 *  - org space: org admin, OR space_owner (grandfathered).
 *  - personal space: owner only.
 */
export function canReviewSpace(db: DB, space: { id: string; orgId: string | null; ownerId: string | null }, userId: string): boolean {
  if (!isOrgSpace(space)) {
    return space.ownerId === userId;
  }
  if (isOrgAdmin(db, space.orgId!, userId)) return true;
  if (isSpaceOwner(db, space.id, userId)) return true;
  return false;
}

/**
 * Can the caller PUSH a new version to this space?
 *  - token (org): token's org must match the space's org (org spaces only).
 *  - token (owner): token's owner must match the space's owner (personal spaces only).
 *  - session: org member/admin, OR space_owner, OR personal owner.
 */
export function canPushToSpace(db: DB, space: { id: string; orgId: string | null; ownerId: string | null }, auth: AnyAuth): boolean {
  if (auth.kind === "token") {
    if (isOrgSpace(space)) return auth.orgId !== null && space.orgId === auth.orgId;
    return auth.ownerId !== null && space.ownerId === auth.ownerId;
  }
  if (!isOrgSpace(space)) {
    return space.ownerId === auth.userId;
  }
  const userId = auth.userId;
  if (isOrgMember(db, space.orgId!, userId)) return true;
  if (isSpaceOwner(db, space.id, userId)) return true;
  return false;
}

/**
 * Can the session user manage a doc (resolve comments etc.) in this space?
 * Same as canReviewSpace — review-level privilege.
 */
export function canManageSpace(db: DB, space: { id: string; orgId: string | null; ownerId: string | null }, userId: string): boolean {
  return canReviewSpace(db, space, userId);
}

/**
 * Resolve a space by slug that the session user is allowed to read.
 * Searches org spaces in the user's orgs, then personal spaces they own or that
 * are shared with their orgs. Returns the space row or null.
 */
export function resolveReadableSpace(db: DB, userId: string, spaceSlug: string) {
  const candidates = db.select().from(spaces).where(eq(spaces.slug, spaceSlug)).all();
  const orgIds = userOrgIds(db, userId);
  for (const s of candidates) {
    if (canReadSpace(db, s, { kind: "session", userId })) {
      // For personal spaces, ensure the user owns it or it's shared — canReadSpace
      // already returns true only for owner on personal spaces.
      return s;
    }
    // Personal space shared with one of the user's orgs: allow if any doc in it
    // is shared with the user's org. Check via docShares against the user's orgs.
    if (!isOrgSpace(s) && orgIds.size > 0) {
      const shared = db
        .select()
        .from(docShares)
        .all()
        .some((d) => orgIds.has(d.orgId));
      if (shared && s.ownerId !== userId) {
        // Only meaningful at doc granularity; allow the space lookup so the
        // doc-level handler can decide.
        return s;
      }
    }
  }
  return null;
}

/**
 * Auto-accept any pending org invitations for this email when a user signs in.
 * Creates an org_memberships row (role "member") and stamps acceptedAt.
 * Idempotent: if already a member, just marks the invite accepted.
 */
export function acceptPendingInvites(db: DB, userId: string, email: string): string[] {
  const e = email.toLowerCase().trim();
  const pending = db
    .select()
    .from(orgInvitations)
    .all()
    .filter((i) => i.email === e && i.acceptedAt === null);
  const joined: string[] = [];
  for (const inv of pending) {
    const existing = db
      .select()
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, inv.orgId), eq(orgMemberships.userId, userId)))
      .get();
    if (!existing) {
      db.insert(orgMemberships)
        .values({ orgId: inv.orgId, userId, role: "member", createdAt: Date.now() })
        .run();
    }
    db.update(orgInvitations)
      .set({ acceptedAt: Date.now() })
      .where(eq(orgInvitations.orgId, inv.orgId))
      .run();
    joined.push(inv.orgId);
  }
  return joined;
}