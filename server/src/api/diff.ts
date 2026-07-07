import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { versions, docs, spaces } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { wordDiffHtml, type DiffSegment } from "../diff/word-diff.js";
import type { BlobStore } from "../blob/store.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

async function authn(deps: ServerDeps, c: any): Promise<{ orgId: string } | { error: number; message: string } | null> {
  const cookie = parseCookie(c.req.header("cookie"));
  if (cookie) {
    try {
      verifySession(deps.signingSecret, cookie);
      const org = deps.db.select().from(spaces).all()[0];
      return org ? { orgId: org.orgId } : { error: 404, message: "no org" };
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
    }
  }
  const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const t = await verifyToken(deps.db, raw);
    if (t) {
      if (!hasScope(t.scopes as Scope[], "read")) return { error: 403, message: "read scope required" };
      return { orgId: t.orgId };
    }
    return { error: 401, message: "invalid token" };
  }
  return { error: 401, message: "authentication required" };
}

/**
 * GET /api/v1/spaces/:space/docs/:slug/diff?from=N&to=M
 * Returns word-level diff segments between two versions, plus both extracted
 * texts. Auth: read-scope token OR session. If `to` is omitted, the latest
 * approved (or latest if none approved) version is used. If `from` is
 * omitted, the most recent approved version before `to` is used.
 */
export function diffRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.get("/spaces/:space/docs/:slug/diff", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if ("error" in auth) return c.json(err(auth.message), auth.error as 401 | 403);

    const space = deps.db.select().from(spaces).where(and(eq(spaces.orgId, auth.orgId), eq(spaces.slug, c.req.param("space")))).get();
    if (!space) return c.json(err("space not found"), 404);
    const doc = deps.db
      .select()
      .from(docs)
      .where(and(eq(docs.spaceId, space.id), eq(docs.slug, c.req.param("slug"))))
      .get();
    if (!doc) return c.json(err("doc not found"), 404);

    const toNum = Number(c.req.query("to") ?? "0");
    const fromQ = c.req.query("from");

    let to: typeof versions.$inferSelect | undefined;
    if (toNum > 0) {
      to = deps.db.select().from(versions).where(and(eq(versions.docId, doc.id), eq(versions.number, toNum))).get();
    } else {
      // Latest version, preferring approved.
      const all = deps.db
        .select()
        .from(versions)
        .where(eq(versions.docId, doc.id))
        .all();
      if (all.length === 0) return c.json(err("no versions to diff"), 404);
      to = all.find((v) => v.state === "approved") ?? all.sort((a, b) => b.number - a.number)[0];
    }
    if (!to) return c.json(err("to version not found"), 404);

    let from: typeof versions.$inferSelect | undefined;
    if (fromQ !== undefined && fromQ !== "") {
      const n = Number(fromQ);
      from = deps.db.select().from(versions).where(and(eq(versions.docId, doc.id), eq(versions.number, n))).get();
      if (!from) return c.json(err("from version not found"), 404);
    } else {
      // Most recent version strictly before `to` (any state).
      const all = deps.db
        .select()
        .from(versions)
        .where(eq(versions.docId, doc.id))
        .all();
      const prior = all.filter((v) => v.number < to!.number).sort((a, b) => b.number - a.number);
      from = prior[0];
    }
    if (!from) return c.json(err("no prior version to diff against"), 404);

    const fromBytes = await deps.blobs.get(from.blobHash);
    const toBytes = await deps.blobs.get(to.blobHash);
    const { segments, aText, bText } = wordDiffHtml(
      new TextDecoder().decode(fromBytes),
      new TextDecoder().decode(toBytes),
    );

    return c.json(ok({
      from: { id: from.id, number: from.number, state: from.state },
      to:   { id: to.id,   number: to.number,   state: to.state },
      segments,
      aText,
      bText,
    }));
  });

  return r;
}
