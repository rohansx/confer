import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { docs, spaces } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { createComment, listComments, resolveComment, getComment } from "../comments/queries.js";
import { canManageSpace, canReadSpace, resolveReadableSpace } from "../auth/access.js";
import { notify } from "../notify/index.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

type Auth =
  | { kind: "session"; userId: string }
  | { kind: "token"; orgId: string | null; ownerId: string | null; scopes: Scope[] };

async function authn(deps: ServerDeps, c: any): Promise<Auth | { error: number; message: string } | null> {
  const cookie = parseCookie(c.req.header("cookie"));
  if (cookie) {
    try {
      const { userId } = verifySession(deps.signingSecret, cookie);
      return { kind: "session", userId };
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
    }
  }
  const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const t = await verifyToken(deps.db, raw);
    if (t) return { kind: "token", orgId: t.orgId, ownerId: t.ownerId, scopes: t.scopes as Scope[] };
  }
  return { error: 401, message: "authentication required" };
}

/**
 * Resolve a (space, slug) doc the caller may read.
 * Token: org must match (org spaces). Session: must be able to read the space.
 */
function resolveDoc(
  deps: ServerDeps,
  auth: Auth,
  spaceSlug: string,
  docSlug: string,
): { space: typeof spaces.$inferSelect; doc: typeof docs.$inferSelect } | null {
  let space: typeof spaces.$inferSelect | undefined;
  if (auth.kind === "token") {
    // org token → its org's space; owner token → the owner's personal space.
    const where = auth.orgId
      ? and(eq(spaces.orgId, auth.orgId), eq(spaces.slug, spaceSlug))
      : and(eq(spaces.ownerId, auth.ownerId!), eq(spaces.slug, spaceSlug));
    space = deps.db.select().from(spaces).where(where).get();
  } else {
    space = resolveReadableSpace(deps.db, auth.userId, spaceSlug) ?? undefined;
    if (space && !canReadSpace(deps.db, space, { kind: "session", userId: auth.userId })) return null;
  }
  if (!space) return null;
  const doc = deps.db
    .select()
    .from(docs)
    .where(and(eq(docs.spaceId, space.id), eq(docs.slug, docSlug)))
    .get();
  if (!doc) return null;
  return { space, doc };
}

export function commentRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  // List comments for a doc
  r.get("/spaces/:space/docs/:slug/comments", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if ("error" in auth) return c.json(err(auth.message), auth.error as 401 | 403);
    if (auth.kind === "token" && !hasScope(auth.scopes, "read")) {
      return c.json(err("read scope required"), 403);
    }
    const found = resolveDoc(deps, auth, c.req.param("space"), c.req.param("slug"));
    if (!found) return c.json(err("doc not found"), 404);
    const orgId = found.space.orgId ?? "";
    const includeResolved = c.req.query("include_resolved") === "true";
    const rows = await listComments(deps.db, deps.blobs, found.doc.id, includeResolved);
    return c.json(ok({ comments: rows }));
  });

  // Create a comment
  r.post("/spaces/:space/docs/:slug/comments", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if ("error" in auth) return c.json(err(auth.message), auth.error as 401 | 403);
    if (auth.kind !== "session") {
      return c.json(err("comments require a human session"), 403);
    }
    const found = resolveDoc(deps, auth, c.req.param("space"), c.req.param("slug"));
    if (!found) return c.json(err("doc not found"), 404);
    if (!canReadSpace(deps.db, found.space, { kind: "session", userId: auth.userId })) {
      return c.json(err("forbidden"), 403);
    }
    const orgId = found.space.orgId ?? "";

    const body = (await c.req.json().catch(() => null)) as {
      body?: string;
      version_id?: string;
      parent_id?: string;
      anchor?: { quote: string; prefix?: string; suffix?: string; selector?: string };
    } | null;
    if (!body?.body?.trim()) return c.json(err("body required"), 400);
    if (!body.version_id) return c.json(err("version_id required (the version you're commenting on)"), 400);

    const res = createComment(deps.db, {
      docId: found.doc.id,
      versionIdCreatedOn: body.version_id,
      parentId: body.parent_id ?? null,
      authorUserId: auth.userId,
      body: body.body.trim(),
      anchor: body.anchor ?? null,
      now: Date.now(),
    });

    notify({
      kind: "comment.created",
      orgId,
      payload: {
        docId: found.doc.id, docSlug: found.doc.slug, spaceSlug: found.space.slug,
        commentId: res.id, authorUserId: auth.userId,
      },
    });

    return c.json(ok({ id: res.id }), 201);
  });

  // Resolve a comment
  r.post("/comments/:id/resolve", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if ("error" in auth) return c.json(err(auth.message), auth.error as 401 | 403);
    if (auth.kind !== "session") return c.json(err("human session required"), 403);

    const row = getComment(deps.db, c.req.param("id"));
    if (!row) return c.json(err("comment not found"), 404);
    const doc = deps.db.select().from(docs).where(eq(docs.id, row.docId)).get();
    if (!doc) return c.json(err("doc not found"), 404);
    const space = deps.db.select().from(spaces).where(eq(spaces.id, doc.spaceId)).get();
    if (!space) return c.json(err("space not found"), 404);
    if (!canManageSpace(deps.db, space, auth.userId)) {
      return c.json(err("review privilege required to resolve comments"), 403);
    }
    resolveComment(deps.db, row.id, Date.now());
    return c.json(ok({ id: row.id, resolved_at: Date.now() }));
  });

  // Reply to a thread
  r.post("/comments/:id/replies", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if ("error" in auth) return c.json(err(auth.message), auth.error as 401 | 403);
    if (auth.kind !== "session") return c.json(err("human session required"), 403);

    const parent = getComment(deps.db, c.req.param("id"));
    if (!parent) return c.json(err("comment not found"), 404);
    if (parent.parentId) return c.json(err("cannot reply to a reply — reply to the root"), 400);
    const doc = deps.db.select().from(docs).where(eq(docs.id, parent.docId)).get();
    if (!doc) return c.json(err("doc not found"), 404);
    const space = deps.db.select().from(spaces).where(eq(spaces.id, doc.spaceId)).get();
    if (!space) return c.json(err("space not found"), 404);
    if (!canReadSpace(deps.db, space, { kind: "session", userId: auth.userId })) {
      return c.json(err("forbidden"), 403);
    }

    const body = (await c.req.json().catch(() => null)) as { body?: string } | null;
    if (!body?.body?.trim()) return c.json(err("body required"), 400);

    const res = createComment(deps.db, {
      docId: parent.docId,
      versionIdCreatedOn: parent.versionIdCreatedOn,
      parentId: parent.id,
      authorUserId: auth.userId,
      body: body.body.trim(),
      now: Date.now(),
    });
    return c.json(ok({ id: res.id }), 201);
  });

  return r;
}