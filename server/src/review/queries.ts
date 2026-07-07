import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  spaceOwners,
  versions,
  approvals,
  docs,
  spaces,
} from "../db/schema.js";

/** Accepts either the top-level db or a transaction handle. */
type AnyDb = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

/** True iff the given user is a space owner for the given space. */
export function isOwner(db: AnyDb, spaceId: string, userId: string): boolean {
  const row = db
    .select()
    .from(spaceOwners)
    .where(and(eq(spaceOwners.spaceId, spaceId), eq(spaceOwners.userId, userId)))
    .get();
  return !!row;
}

/** The currently-approved version for a doc, or undefined. At most one by invariant. */
export function approvedForDoc(db: DB, docId: string) {
  return db
    .select()
    .from(versions)
    .where(and(eq(versions.docId, docId), eq(versions.state, "approved")))
    .get();
}

export interface HistoryRow {
  id: string;
  number: number;
  state: string;
  origin: string;
  authorType: string;
  authorName: string | null;
  tool: string | null;
  sourceRepo: string | null;
  commitSha: string | null;
  branch: string | null;
  pushedAt: number;
  approvedBy: string | null;
  approvedAt: number | null;
  rejectedBy: string | null;
  rejectedAt: number | null;
  rejectReason: string | null;
}

/**
 * Full history of a doc, newest first. Each row carries who approved/rejected it
 * (if anyone) and when. Joins versions with their latest matching approval row.
 */
export function listHistory(db: DB, docId: string): HistoryRow[] {
  const rows = db
    .select()
    .from(versions)
    .where(eq(versions.docId, docId))
    .orderBy(desc(versions.number))
    .all();

  return rows.map((v) => {
    const appr = db
      .select()
      .from(approvals)
      .where(eq(approvals.versionId, v.id))
      .all();
    const approval = appr.find((a) => a.action === "approve");
    const rejection = appr.find((a) => a.action === "reject");
    return {
      id: v.id,
      number: v.number,
      state: v.state,
      origin: v.origin,
      authorType: v.authorType,
      authorName: v.authorName,
      tool: v.tool,
      sourceRepo: v.sourceRepo,
      commitSha: v.commitSha,
      branch: v.branch,
      pushedAt: v.pushedAt,
      approvedBy: approval?.userId ?? null,
      approvedAt: approval?.decidedAt ?? null,
      rejectedBy: rejection?.userId ?? null,
      rejectedAt: rejection?.decidedAt ?? null,
      rejectReason: rejection?.reason ?? null,
    };
  });
}

/** Resolve a (space, slug) pair to a doc, scoped to an org. */
export function findDocBySlug(db: DB, orgId: string, spaceSlug: string, docSlug: string) {
  const space = db.select().from(spaces).where(and(eq(spaces.orgId, orgId), eq(spaces.slug, spaceSlug))).get();
  if (!space) return null;
  const doc = db
    .select()
    .from(docs)
    .where(and(eq(docs.spaceId, space.id), eq(docs.slug, docSlug)))
    .get();
  if (!doc) return null;
  return { space, doc };
}
