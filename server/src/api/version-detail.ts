import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { versions, docs, spaces, orgs } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { signContentUrl } from "../viewer/signed-url.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

type Auth =
  | { kind: "session"; orgId: string }
  | { kind: "token"; orgId: string };

async function authn(deps: ServerDeps, c: any): Promise<Auth | null> {
  const cookie = parseCookie(c.req.header("cookie"));
  if (cookie) {
    try {
      verifySession(deps.signingSecret, cookie);
      // Resolve the user's org (v0: first org). Used to scope the content URL.
      const org = deps.db.select().from(orgs).all()[0];
      if (org) return { kind: "session", orgId: org.id };
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
    }
  }
  const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const t = await verifyToken(deps.db, raw);
    if (t && hasScope(t.scopes as Scope[], "read")) return { kind: "token", orgId: t.orgId };
  }
  return null;
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
    if (!space || space.orgId !== auth.orgId) return c.json(err("not found"), 404);

    const contentUrl = signContentUrl(deps.viewOrigin, deps.signingSecret, v.blobHash, auth.orgId, 300);

    return c.json(
      ok({
        id: v.id,
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
      }),
    );
  });

  return r;
}
