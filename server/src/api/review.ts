import { Hono } from "hono";
import type { ServerDeps } from "../deps.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { findDocBySlug, listHistory, approvedForDoc, isOwner } from "../review/queries.js";
import { approve, ForbiddenError, NotFoundError, ConflictError } from "../review/approve.js";
import { reject } from "../review/reject.js";
import { orgs } from "../db/schema.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

type Auth =
  | { kind: "session"; userId: string }
  | { kind: "token"; orgId: string; scopes: Scope[] };

async function authn(deps: ServerDeps, c: any): Promise<Auth | null> {
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
    if (t) return { kind: "token", orgId: t.orgId, scopes: t.scopes as Scope[] };
  }
  return null;
}

/** Best-effort: pick the first org. v0 self-host has one org. */
function firstOrgId(deps: ServerDeps): string | null {
  return deps.db.select().from(orgs).all()[0]?.id ?? null;
}

export function reviewRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.post("/versions/:id/approve", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind !== "session") {
      return c.json(err("approval requires a human session"), 403);
    }
    try {
      const res = approve(deps.db, {
        versionId: c.req.param("id"),
        userId: auth.userId,
        now: Date.now(),
      });
      return c.json(ok(res));
    } catch (e) {
      if (e instanceof ForbiddenError) return c.json(err(e.message), 403);
      if (e instanceof NotFoundError) return c.json(err(e.message), 404);
      if (e instanceof ConflictError) return c.json(err(e.message), 409);
      throw e;
    }
  });

  r.post("/versions/:id/reject", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind !== "session") {
      return c.json(err("rejection requires a human session"), 403);
    }
    const body = (await c.req.json().catch(() => null)) as { reason?: string } | null;
    if (!body?.reason || !body.reason.trim()) {
      return c.json(err("reason required"), 400);
    }
    try {
      const res = reject(deps.db, {
        versionId: c.req.param("id"),
        userId: auth.userId,
        reason: body.reason.trim(),
        now: Date.now(),
      });
      return c.json(ok(res));
    } catch (e) {
      if (e instanceof ForbiddenError) return c.json(err(e.message), 403);
      if (e instanceof NotFoundError) return c.json(err(e.message), 404);
      if (e instanceof ConflictError) return c.json(err(e.message), 409);
      throw e;
    }
  });

  r.get("/spaces/:space/docs/:slug/versions", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind === "token" && !hasScope(auth.scopes, "read")) {
      return c.json(err("read scope required"), 403);
    }
    const orgId = auth.kind === "token" ? auth.orgId : firstOrgId(deps);
    if (!orgId) return c.json(err("no org"), 404);

    const found = findDocBySlug(deps.db, orgId, c.req.param("space"), c.req.param("slug"));
    if (!found) return c.json(err("doc not found"), 404);

    const rows = listHistory(deps.db, found.doc.id);
    const isOwnerFlag = auth.kind === "session" ? isOwner(deps.db, found.space.id, auth.userId) : false;

    return c.json(ok({
      doc: { id: found.doc.id, slug: found.doc.slug, title: found.doc.title, space: found.space.slug },
      versions: rows,
      is_owner: isOwnerFlag,
    }));
  });

  r.get("/spaces/:space/docs/:slug", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind === "token" && !hasScope(auth.scopes, "read")) {
      return c.json(err("read scope required"), 403);
    }
    const orgId = auth.kind === "token" ? auth.orgId : firstOrgId(deps);
    if (!orgId) return c.json(err("no org"), 404);
    const found = findDocBySlug(deps.db, orgId, c.req.param("space"), c.req.param("slug"));
    if (!found) return c.json(err("doc not found"), 404);
    const approved = approvedForDoc(deps.db, found.doc.id);
    return c.json(ok({
      doc: { id: found.doc.id, slug: found.doc.slug, title: found.doc.title, space: found.space.slug },
      latest_approved: approved ? {
        id: approved.id, number: approved.number, state: approved.state,
        pushed_at: approved.pushedAt, commit_sha: approved.commitSha,
      } : null,
    }));
  });

  return r;
}
