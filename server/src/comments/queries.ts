import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { comments, docs, spaces, versions } from "../db/schema.js";
import { extractText } from "../search/extract.js";
import type { BlobStore } from "../blob/store.js";
import { resolveAnchor, type ResolvedAnchor } from "./anchor.js";

export interface CommentRow {
  id: string;
  doc_id: string;
  version_id_created_on: string;
  parent_id: string | null;
  author_user_id: string;
  body: string;
  anchor_quote: string | null;
  anchor_prefix: string | null;
  anchor_suffix: string | null;
  anchor_selector: string | null;
  resolved_at: number | null;
  created_at: number;
  /** Anchor re-resolved against the latest version's text. */
  anchor_resolved: ResolvedAnchor;
  /** True if the comment was created on a version older than the current latest. */
  is_carried_over: boolean;
}

export interface CreateCommentInput {
  docId: string;
  versionIdCreatedOn: string;
  parentId?: string | null;
  authorUserId: string;
  body: string;
  anchor?: {
    quote: string;
    prefix?: string | null;
    suffix?: string | null;
    selector?: string | null;
  } | null;
  now: number;
}

export function createComment(db: DB, input: CreateCommentInput): { id: string } {
  const id = newId();
  db.insert(comments).values({
    id,
    docId: input.docId,
    versionIdCreatedOn: input.versionIdCreatedOn,
    parentId: input.parentId ?? null,
    authorUserId: input.authorUserId,
    body: input.body,
    anchorQuote: input.anchor?.quote ?? null,
    anchorPrefix: input.anchor?.prefix ?? null,
    anchorSuffix: input.anchor?.suffix ?? null,
    anchorSelector: input.anchor?.selector ?? null,
    resolvedAt: null,
    createdAt: input.now,
  }).run();
  return { id };
}

export function resolveComment(db: DB, id: string, now: number): void {
  db.update(comments).set({ resolvedAt: now }).where(eq(comments.id, id)).run();
}

/** Re-resolve a comment's anchor against the latest version's extracted text. */
async function reResolveAnchor(
  blobs: BlobStore,
  db: DB,
  row: typeof comments.$inferSelect,
): Promise<ResolvedAnchor> {
  if (!row.anchorQuote) return { start: -1, end: -1, lost: true };
  // Find the highest-numbered version for this doc.
  const docVersions = db
    .select()
    .from(versions)
    .where(eq(versions.docId, row.docId))
    .all();
  if (docVersions.length === 0) return { start: -1, end: -1, lost: true };
  const latest = docVersions.sort((a, b) => b.number - a.number)[0]!;
  const bytes = await blobs.get(latest.blobHash);
  const text = extractText(new TextDecoder().decode(bytes));
  return resolveAnchor(
    { quote: row.anchorQuote, prefix: row.anchorPrefix, suffix: row.anchorSuffix, selector: row.anchorSelector },
    text,
  );
}

/**
 * List all comments for a doc, re-resolving anchors against the latest version.
 * Carries-over threads (a root comment created on an older version) are
 * surfaced on every newer version with `is_carried_over: true`.
 */
export async function listComments(
  db: DB,
  blobs: BlobStore,
  docId: string,
  includeResolved = false,
): Promise<CommentRow[]> {
  const all = db
    .select()
    .from(comments)
    .where(eq(comments.docId, docId))
    .orderBy(comments.createdAt)
    .all();

  const filtered = includeResolved ? all : all.filter((c) => c.resolvedAt == null);

  const out: CommentRow[] = [];
  for (const c of filtered) {
    const resolved = await reResolveAnchor(blobs, db, c);
    const isCarriedOver = await isOlderThanLatest(db, c.versionIdCreatedOn, c.docId);
    out.push({
      id: c.id,
      doc_id: c.docId,
      version_id_created_on: c.versionIdCreatedOn,
      parent_id: c.parentId,
      author_user_id: c.authorUserId,
      body: c.body,
      anchor_quote: c.anchorQuote,
      anchor_prefix: c.anchorPrefix,
      anchor_suffix: c.anchorSuffix,
      anchor_selector: c.anchorSelector,
      resolved_at: c.resolvedAt,
      created_at: c.createdAt,
      anchor_resolved: resolved,
      is_carried_over: isCarriedOver,
    });
  }
  return out;
}

async function isOlderThanLatest(db: DB, versionId: string, docId: string): Promise<boolean> {
  const v = db.select().from(versions).where(eq(versions.id, versionId)).get();
  if (!v) return false;
  const all = db.select().from(versions).where(eq(versions.docId, docId)).all();
  const latest = all.sort((a, b) => b.number - a.number)[0];
  return !!latest && latest.id !== versionId && latest.number > v.number;
}

/** Get one comment by id. */
export function getComment(db: DB, id: string) {
  return db.select().from(comments).where(eq(comments.id, id)).get();
}
