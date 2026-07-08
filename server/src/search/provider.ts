import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { versions, docs, spaces, approvals } from "../db/schema.js";
import type { BlobStore } from "../blob/store.js";

/** A single hit from `search`. Includes provenance + the approval metadata. */
export interface SearchHit {
  slug: string;
  title: string;
  space: string;
  snippet: string;
  state: "approved" | "in_review" | "draft" | "rejected" | "superseded";
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  source_repo: string | null;
  doc_id: string;
  version_id: string;
  version_number: number;
  updated_at: number;
}

export interface ListHit {
  slug: string;
  title: string;
  space: string;
  state: SearchHit["state"];
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  source_repo: string | null;
  updated_at: number;
  doc_id: string;
  version_id: string;
  version_number: number;
}

export interface GetDocResult {
  space: string;
  slug: string;
  title: string;
  version_id: string;
  version_number: number;
  state: SearchHit["state"];
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  branch: string | null;
  source_repo: string | null;
  pushed_at: number;
  html: string;
}

/**
 * The interface every read path on the MCP server goes through. The authz layer
 * is responsible for setting `includeUnapproved` correctly — the provider trusts
 * the flag but does not consult the token. Single chokepoint for the
 * approved-only invariant.
 */
export interface SearchProvider {
  search(opts: {
    query: string;
    space?: string;
    repo?: string;
    includeUnapproved: boolean;
    limit?: number;
  }): Promise<SearchHit[]>;

  getDoc(opts: {
    space: string;
    slug: string;
    version?: number;
    includeUnapproved: boolean;
  }): Promise<GetDocResult | null>;

  listDocs(opts: {
    space?: string;
    repo?: string;
    includeUnapproved: boolean;
    limit?: number;
  }): Promise<ListHit[]>;
}

const ALLOWED_STATES_ALL = ["approved", "in_review", "draft", "rejected", "superseded"] as const;
const ALLOWED_STATES_APPROVED_ONLY = ["approved"] as const;

function statesFor(includeUnapproved: boolean): readonly string[] {
  return includeUnapproved ? ALLOWED_STATES_ALL : ALLOWED_STATES_APPROVED_ONLY;
}

/**
 * SQLite FTS5 implementation. Wraps raw SQL + drizzle joins. The FTS table is
 * written by `createVersion`; this provider is read-only.
 */
export class Fts5Provider implements SearchProvider {
  constructor(private readonly db: DB, private readonly blobs: BlobStore) {}

  async search(opts: { query: string; space?: string; repo?: string; includeUnapproved: boolean; limit?: number }): Promise<SearchHit[]> {
    const limit = opts.limit ?? 20;
    const allowedStates = statesFor(opts.includeUnapproved);

    // Escape user input for FTS5: wrap each token in quotes to neutralize query syntax.
    const safeQuery = opts.query.trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" ");

    if (!safeQuery) return [];

    // FTS5 gives us matched version_ids. The FTS row's `state` is stale (captured at
    // insert time) so we must join through `versions` to get the *current* state and
    // filter on that.
    const ftsRows = this.db.$client
      .prepare(
        `SELECT version_id, snippet(docs_fts, 5, '<mark>', '</mark>', '…', 16) AS snippet
         FROM docs_fts
         WHERE docs_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(safeQuery, limit * 4) as Array<{ version_id: string; snippet: string }>;

    if (ftsRows.length === 0) return [];

    const versionIds = ftsRows.map((r) => r.version_id);
    const versionsList = this.db
      .select()
      .from(versions)
      .where(inArray(versions.id, versionIds))
      .all();

    const docIds = [...new Set(versionsList.map((v) => v.docId))];
    const docsList = this.db.select().from(docs).where(inArray(docs.id, docIds)).all();
    const docsById = new Map(docsList.map((d) => [d.id, d]));

    const spaceIds = [...new Set(docsList.map((d) => d.spaceId))];
    const spacesList = this.db.select().from(spaces).where(inArray(spaces.id, spaceIds)).all();
    const spacesById = new Map(spacesList.map((s) => [s.id, s]));

    const approvalsList = this.db
      .select()
      .from(approvals)
      .where(and(inArray(approvals.versionId, versionIds), eq(approvals.action, "approve")))
      .all();
    const apprByVersion = new Map(approvalsList.map((a) => [a.versionId, a]));

    const hits: SearchHit[] = [];
    for (const v of versionsList) {
      if (!allowedStates.includes(v.state)) continue;
      if (opts.repo && v.sourceRepo !== opts.repo) continue;

      const d = docsById.get(v.docId);
      if (!d) continue;
      const s = spacesById.get(d.spaceId);
      if (!s) continue;
      if (opts.space && s.slug !== opts.space) continue;

      const appr = apprByVersion.get(v.id);
      const fts = ftsRows.find((r) => r.version_id === v.id);

      hits.push({
        slug: d.slug,
        title: d.title,
        space: s.slug,
        snippet: fts?.snippet ?? "",
        state: v.state as SearchHit["state"],
        approved_by: appr?.userId ?? null,
        approved_at: appr?.decidedAt ?? null,
        commit_sha: v.commitSha,
        source_repo: v.sourceRepo,
        version_id: v.id,
        version_number: v.number,
        updated_at: v.pushedAt,
        doc_id: v.docId,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async getDoc(opts: { space: string; slug: string; version?: number; includeUnapproved: boolean }): Promise<GetDocResult | null> {
    const space = this.db.select().from(spaces).where(eq(spaces.slug, opts.space)).get();
    if (!space) return null;
    const doc = this.db
      .select()
      .from(docs)
      .where(and(eq(docs.spaceId, space.id), eq(docs.slug, opts.slug)))
      .get();
    if (!doc) return null;

    const states = statesFor(opts.includeUnapproved);
    let v;
    if (opts.version !== undefined) {
      v = this.db
        .select()
        .from(versions)
        .where(and(
          eq(versions.docId, doc.id),
          eq(versions.number, opts.version),
          inArray(versions.state, states as unknown as string[]),
        ))
        .get();
    } else {
      // Latest allowed-state version, preferring approved.
      v = this.db
        .select()
        .from(versions)
        .where(and(eq(versions.docId, doc.id), inArray(versions.state, states as unknown as string[])))
        .orderBy(versions.state, versions.number)
        .get();
      if (v && v.state !== "approved" && states.includes("approved")) {
        // If a more recent in_review/rejected exists, prefer the latest approved instead.
        const approved = this.db
          .select()
          .from(versions)
          .where(and(eq(versions.docId, doc.id), eq(versions.state, "approved")))
          .orderBy(versions.number)
          .get();
        if (approved) v = approved;
      }
    }
    if (!v) return null;

    const appr = this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.versionId, v.id), eq(approvals.action, "approve")))
      .get();

    const bytes = await this.blobs.get(v.blobHash);
    const html = new TextDecoder().decode(bytes);

    return {
      space: space.slug,
      slug: doc.slug,
      title: doc.title,
      version_id: v.id,
      version_number: v.number,
      state: v.state as SearchHit["state"],
      approved_by: appr?.userId ?? null,
      approved_at: appr?.decidedAt ?? null,
      commit_sha: v.commitSha,
      branch: v.branch,
      source_repo: v.sourceRepo,
      pushed_at: v.pushedAt,
      html,
    };
  }

  async listDocs(opts: { space?: string; repo?: string; includeUnapproved: boolean; limit?: number }): Promise<ListHit[]> {
    const limit = opts.limit ?? 100;
    const states = statesFor(opts.includeUnapproved);

    // Pull the relevant versions first, then group to one row per doc.
    // We pick the highest-numbered version-per-doc within the allowed states.
    const allowedStates = states as unknown as string[];
    const allVersions = this.db
      .select()
      .from(versions)
      .where(inArray(versions.state, allowedStates))
      .all();

    const filtered = allVersions.filter((v) => {
      if (opts.repo && v.sourceRepo !== opts.repo) return false;
      return true;
    });

    // Group by doc, take max number
    const best = new Map<string, typeof filtered[number]>();
    for (const v of filtered) {
      const cur = best.get(v.docId);
      if (!cur || v.number > cur.number) best.set(v.docId, v);
    }

    if (best.size === 0) return [];
    const docIds = [...best.keys()];
    const docsList = this.db.select().from(docs).where(inArray(docs.id, docIds)).all();
    const docsById = new Map(docsList.map((d) => [d.id, d]));

    const spaceIds = [...new Set(docsList.map((d) => d.spaceId))];
    const spacesList = this.db.select().from(spaces).where(inArray(spaces.id, spaceIds)).all();
    const spacesById = new Map(spacesList.map((s) => [s.id, s]));

    const versionIds = [...best.values()].map((v) => v.id);
    const approvalsList = this.db
      .select()
      .from(approvals)
      .where(and(inArray(approvals.versionId, versionIds), eq(approvals.action, "approve")))
      .all();
    const apprByVersion = new Map(approvalsList.map((a) => [a.versionId, a]));

    const hits: ListHit[] = [];
    for (const v of best.values()) {
      const d = docsById.get(v.docId);
      if (!d) continue;
      const s = spacesById.get(d.spaceId);
      if (!s) continue;
      if (opts.space && s.slug !== opts.space) continue;
      const appr = apprByVersion.get(v.id);
      hits.push({
        slug: d.slug,
        title: d.title,
        space: s.slug,
        state: v.state as SearchHit["state"],
        approved_by: appr?.userId ?? null,
        approved_at: appr?.decidedAt ?? null,
        commit_sha: v.commitSha,
        source_repo: v.sourceRepo,
        updated_at: v.pushedAt,
        doc_id: v.docId,
        version_id: v.id,
        version_number: v.number,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }
}
