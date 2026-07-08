import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { stars, docs } from "../db/schema.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

/**
 * Per-user doc stars (bookmarks). Session-only.
 *   POST   /api/v1/docs/:docId/star   — star a doc (idempotent)
 *   DELETE /api/v1/docs/:docId/star   — unstar
 */
export function starRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  async function sessionUserId(c: any): Promise<string | null> {
    const cookie = parseCookie(c.req.header("cookie"));
    if (!cookie) return null;
    try {
      return verifySession(deps.signingSecret, cookie).userId;
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
      return null;
    }
  }

  r.post("/docs/:docId/star", async (c) => {
    const userId = await sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const docId = c.req.param("docId");
    const doc = deps.db.select().from(docs).where(eq(docs.id, docId)).get();
    if (!doc) return c.json(err("doc not found"), 404);
    // Idempotent insert (PK is doc_id+user_id).
    deps.db
      .insert(stars)
      .values({ docId, userId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
    return c.json(ok({ starred: true }));
  });

  r.delete("/docs/:docId/star", async (c) => {
    const userId = await sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const docId = c.req.param("docId");
    deps.db
      .delete(stars)
      .where(and(eq(stars.docId, docId), eq(stars.userId, userId)))
      .run();
    return c.json(ok({ starred: false }));
  });

  return r;
}