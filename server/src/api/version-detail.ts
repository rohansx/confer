import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { versions, docs, spaces } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { canReadSpace, isOrgSpace } from "../auth/access.js";
import { signContentUrl } from "../viewer/signed-url.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

async function authn(deps: ServerDeps, c: any): Promise<{ kind: "session"; userId: string } | { kind: "token"; orgId: string | null; ownerId: string | null } | null> {
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
    if (t && hasScope(t.scopes as Scope[], "read")) return { kind: "token", orgId: t.orgId, ownerId: t.ownerId };
  }
  return null;
}

type Authed = { kind: "session"; userId: string } | { kind: "token"; orgId: string | null; ownerId: string | null };

/** True iff this token/session may read the space the version belongs to. */
function canRead(deps: ServerDeps, space: typeof spaces.$inferSelect, auth: Authed): boolean {
  if (auth.kind === "token") {
    return isOrgSpace(space) ? space.orgId === auth.orgId : space.ownerId === auth.ownerId;
  }
  return canReadSpace(deps.db, space, { kind: "session", userId: auth.userId });
}

/** GET /api/v1/versions/:id — metadata + provenance + a signed content_url. */
export function versionDetailRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.get("/versions/:id", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);

    const v = deps.db.select().from(versions).where(eq(versions.id, c.req.param("id"))).get();
    if (!v) return c.json(err("version not found"), 404);
    const doc = deps.db.select().from(docs).where(eq(docs.id, v.docId)).get();
    if (!doc) return c.json(err("doc not found"), 404);
    const space = deps.db.select().from(spaces).where(eq(spaces.id, doc.spaceId)).get();
    if (!space) return c.json(err("not found"), 404);

    // Access control: token must match the space's org (or personal owner); session must be able to read.
    if (!canRead(deps, space, auth)) return c.json(err("not found"), 404);
    const orgId = space.orgId;

    const orgOrOwner = orgId ?? space.ownerId ?? "x";  // 'x' is a safe sentinel — never reaches verify since ownerId is set in practice
    const contentUrl = signContentUrl(deps.viewOrigin, deps.signingSecret, v.blobHash, orgOrOwner, 300);

    return c.json(
      ok({
        id: v.id,
        doc_id: v.docId,
        number: v.number,
        state: v.state,
        origin: v.origin,
        title: doc.title,
        slug: doc.slug,
        space: space.slug,
        provenance: {
          author_type: v.authorType,
          author_name: v.authorName,
          tool: v.tool,
          source_repo: v.sourceRepo,
          commit_sha: v.commitSha,
          branch: v.branch,
          pushed_at: v.pushedAt,
        },
        content_url: contentUrl,
        has_session: v.sessionHash != null,
      }),
    );
  });

  // GET /api/v1/versions/:id/session — the raw transcript as text/plain.
  // Same authz as GET /versions/:id; 404 when the version has no session.
  r.get("/versions/:id/session", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("authentication required"), 401);

    const v = deps.db.select().from(versions).where(eq(versions.id, c.req.param("id"))).get();
    if (!v) return c.json(err("version not found"), 404);
    const doc = deps.db.select().from(docs).where(eq(docs.id, v.docId)).get();
    if (!doc) return c.json(err("doc not found"), 404);
    const space = deps.db.select().from(spaces).where(eq(spaces.id, doc.spaceId)).get();
    if (!space) return c.json(err("not found"), 404);

    if (!canRead(deps, space, auth)) return c.json(err("not found"), 404);
    if (v.sessionHash == null) return c.json(err("no session"), 404);

    const bytes = await deps.blobs.get(v.sessionHash);
    return c.body(new TextDecoder().decode(bytes), 200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
  });

  return r;
}
