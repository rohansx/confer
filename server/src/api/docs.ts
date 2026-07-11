import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import type { SearchProvider } from "../search/provider.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { readableSpaceIds } from "../auth/access.js";
import { orgs, stars } from "../db/schema.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

type Auth =
  | { kind: "token"; orgId: string | null; ownerId: string | null; scopes: Scope[] }
  | { kind: "session"; userId: string };

async function authn(deps: ServerDeps, c: any): Promise<Auth | null> {
  const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const t = await verifyToken(deps.db, raw);
    if (t) return { kind: "token", orgId: t.orgId, ownerId: t.ownerId, scopes: t.scopes as Scope[] };
  }
  const cookie = parseCookie(c.req.header("cookie"));
  if (cookie) {
    try {
      const { userId } = verifySession(deps.signingSecret, cookie);
      return { kind: "session", userId };
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
    }
  }
  return null;
}

/** The set of doc ids the session user has starred. Empty for token auth. */
function starredSet(deps: ServerDeps, auth: Auth): Set<string> {
  if (auth.kind !== "session") return new Set();
  const rows = deps.db.select().from(stars).where(eq(stars.userId, auth.userId)).all();
  return new Set(rows.map((r) => r.docId));
}

/** Attach a `starred` flag to each hit (which now carry doc_id). */
function decorate<T extends { doc_id: string }>(hits: T[], starred: Set<string>): (T & { starred: boolean })[] {
  return hits.map((h) => ({ ...h, starred: starred.has(h.doc_id) }));
}

/**
 * GET /api/v1/spaces/:space/docs[?repo=]   — latest version per doc
 * GET /api/v1/search?q=…                   — full-text search (⌘K)
 * GET /api/v1/starred                       — the session user's starred docs
 *
 * Owners (session) see all states; read tokens see approved-only unless they
 * hold the unapproved scope. Starred flags are only meaningful for sessions.
 */
export function docsRoutes(deps: ServerDeps, provider: SearchProvider): Hono {
  const r = new Hono();

  r.get("/spaces/:space/docs", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind === "token" && !hasScope(auth.scopes, "read")) {
      return c.json(err("read scope required"), 403);
    }
    const includeUnapproved = auth.kind === "token" ? auth.scopes.includes("unapproved") : true;
    const hits = await provider.listDocs({
      space: c.req.param("space"),
      repo: c.req.query("repo") || undefined,
      includeUnapproved,
      limit: 500,
    }, { spaceIds: readableSpaceIds(deps.db, auth) });
    const starred = starredSet(deps, auth);
    return c.json(ok({ docs: decorate(hits, starred), is_owner: auth.kind === "session", include_unapproved: includeUnapproved }));
  });

  r.get("/search", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);
    if (auth.kind === "token" && !hasScope(auth.scopes, "read")) {
      return c.json(err("read scope required"), 403);
    }
    const query = c.req.query("q") ?? "";
    if (!query.trim()) return c.json(ok({ hits: [] }));
    const includeUnapproved = auth.kind === "token" ? auth.scopes.includes("unapproved") : true;
    const hits = await provider.search({
      query,
      space: c.req.query("space") || undefined,
      repo: c.req.query("repo") || undefined,
      includeUnapproved,
      limit: Number(c.req.query("limit") ?? 20),
    }, { spaceIds: readableSpaceIds(deps.db, auth) });
    const starred = starredSet(deps, auth);
    return c.json(ok({ hits: decorate(hits, starred) }));
  });

  r.get("/starred", async (c) => {
    const auth = await authn(deps, c);
    if (!auth || auth.kind !== "session") return c.json(err("authentication required"), 401);
    const starred = starredSet(deps, auth);
    if (starred.size === 0) return c.json(ok({ docs: [] }));
    // Pull all docs (latest version per doc) and keep the starred ones.
    const all = await provider.listDocs({ includeUnapproved: true, limit: 1000 }, { spaceIds: readableSpaceIds(deps.db, auth) });
    const docsHit = all.filter((h) => starred.has(h.doc_id));
    return c.json(ok({ docs: decorate(docsHit, starred) }));
  });

  return r;
}