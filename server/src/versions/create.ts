import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { versions, spaces, docs } from "../db/schema.js";
import type { BlobStore } from "../blob/store.js";
import { hashBytes } from "../blob/hash.js";
import { extractText } from "../search/extract.js";
import { notify } from "../notify/index.js";

export interface Provenance {
  authorType: "human" | "agent";
  authorName?: string;
  tool?: string;
  sourceRepo?: string;
  commitSha?: string;
  branch?: string;
}

export interface CreateVersionDeps {
  db: DB;
  blobs: BlobStore;
  appOrigin: string;
}

/** Max size of an attached session transcript. */
export const MAX_SESSION_BYTES = 2 * 1024 * 1024;

export interface CreateVersionInput {
  /** Set for org spaces, null for personal spaces. */
  orgId: string | null;
  spaceId: string;
  docId: string;
  html: Uint8Array;
  draft?: boolean;
  provenance: Provenance;
  /**
   * Optional raw agent session / prompt transcript that produced this version.
   * Stored content-addressed in the blob store; referenced by session_hash.
   */
  session?: Uint8Array;
}

export interface CreateVersionResult {
  versionId: string;
  number: number;
  reviewUrl: string;
  deduped: boolean;
}

/**
 * Hash → dedupe → write blob → insert immutable version row + provenance →
 * index extracted text into FTS. Idempotent by content hash per doc.
 */
export async function createVersion(
  deps: CreateVersionDeps,
  input: CreateVersionInput,
): Promise<CreateVersionResult> {
  const { db, blobs, appOrigin } = deps;
  const bytes = input.html;
  const blobHash = hashBytes(bytes);

  if (input.session && input.session.byteLength > MAX_SESSION_BYTES) {
    throw new Error("session transcript exceeds 2 MB");
  }

  // Dedupe: identical content for this doc → return existing version, no new row.
  const existing = db
    .select()
    .from(versions)
    .where(and(eq(versions.docId, input.docId), eq(versions.blobHash, blobHash)))
    .get();
  if (existing) {
    // Backfill a session onto the deduped version if it has none — lets you push
    // the same content again just to attach the "why" without a spurious version.
    if (input.session && existing.sessionHash == null) {
      const sh = await blobs.put(input.session);
      db.update(versions).set({ sessionHash: sh }).where(eq(versions.id, existing.id)).run();
    }
    return {
      versionId: existing.id,
      number: existing.number,
      reviewUrl: reviewUrl(appOrigin, existing.id),
      deduped: true,
    };
  }

  await blobs.put(bytes);
  const sessionHash = input.session ? await blobs.put(input.session) : null;

  const last = db
    .select()
    .from(versions)
    .where(eq(versions.docId, input.docId))
    .orderBy(desc(versions.number))
    .get();
  const number = (last?.number ?? 0) + 1;
  const id = newId();
  const state = input.draft ? "draft" : "in_review";
  const p = input.provenance;

  db.insert(versions)
    .values({
      id,
      docId: input.docId,
      number,
      blobHash,
      state,
      origin: "push",
      authorType: p.authorType,
      authorName: p.authorName ?? null,
      tool: p.tool ?? null,
      sourceRepo: p.sourceRepo ?? null,
      commitSha: p.commitSha ?? null,
      branch: p.branch ?? null,
      pushedAt: Date.now(),
      sessionHash,
    })
    .run();

  // Index extracted text for search (raw SQL against the FTS5 virtual table).
  db.$client
    .prepare(
      `INSERT INTO docs_fts (version_id, doc_id, space_id, state, source_repo, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.docId,
      input.spaceId,
      state,
      p.sourceRepo ?? "",
      extractText(new TextDecoder().decode(bytes)),
    );

  // Notify on review-requested. Drafts do not fire (they're not in the queue).
  // Personal spaces (orgId null) do not fire notifications yet — the user is the
  // only reviewer; their UI gets the version back in the create response.
  if (state === "in_review" && input.orgId) {
    const space = db.select().from(spaces).where(eq(spaces.id, input.spaceId)).get();
    const doc = db.select().from(docs).where(eq(docs.id, input.docId)).get();
    notify({
      kind: "version.pushed",
      orgId: input.orgId,
      payload: {
        versionId: id,
        versionNumber: number,
        spaceId: input.spaceId,
        spaceSlug: space?.slug,
        docId: input.docId,
        docSlug: doc?.slug,
        authorName: p.authorName ?? null,
      },
    });
  }

  return { versionId: id, number, reviewUrl: reviewUrl(appOrigin, id), deduped: false };
}

function reviewUrl(appOrigin: string, versionId: string): string {
  return `${appOrigin}/v/${versionId}`;
}
