import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type { BlobStore } from "../blob/store.js";
import { spaces, docs } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { createVersion, type Provenance } from "../versions/create.js";

const MAX_BYTES = 5 * 1024 * 1024;

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

export interface ApiDeps {
  db: DB;
  blobs: BlobStore;
  appOrigin: string;
}

interface PublishBody {
  html?: string;
  metadata?: Record<string, unknown>;
  draft?: boolean;
}

export function versionsRoutes(deps: ApiDeps): Hono {
  const r = new Hono();

  r.post("/spaces/:space/docs/:slug/versions", async (c) => {
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return c.json(err("missing token"), 401);
    const auth = await verifyToken(deps.db, raw);
    if (!auth) return c.json(err("invalid token"), 401);
    if (!hasScope(auth.scopes as Scope[], "push")) {
      return c.json(err("push scope required"), 403);
    }

    const body = (await c.req.json().catch(() => null)) as PublishBody | null;
    if (!body?.html) return c.json(err("html required"), 400);
    const bytes = new TextEncoder().encode(body.html);
    if (bytes.byteLength > MAX_BYTES) return c.json(err("body exceeds 5 MB"), 413);

    const space = deps.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.orgId, auth.orgId), eq(spaces.slug, c.req.param("space"))))
      .get();
    if (!space) return c.json(err("space not found"), 404);

    const doc = deps.db
      .select()
      .from(docs)
      .where(and(eq(docs.spaceId, space.id), eq(docs.slug, c.req.param("slug"))))
      .get();
    if (!doc) return c.json(err("doc not found"), 404);

    const m = body.metadata ?? {};
    const provenance: Provenance = {
      authorType: (m.author_type as "human" | "agent") ?? "agent",
      authorName: m.author as string | undefined,
      tool: m.tool as string | undefined,
      sourceRepo: m.source_repo as string | undefined,
      commitSha: m.commit_sha as string | undefined,
      branch: m.branch as string | undefined,
    };

    const res = await createVersion(
      { db: deps.db, blobs: deps.blobs, appOrigin: deps.appOrigin },
      { orgId: auth.orgId, spaceId: space.id, docId: doc.id, html: bytes, draft: body.draft, provenance },
    );

    return c.json(
      ok({ version_id: res.versionId, review_url: res.reviewUrl, deduped: res.deduped }),
      201,
    );
  });

  return r;
}
