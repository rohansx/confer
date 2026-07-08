import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { spaces, docs } from "../db/schema.js";
import { newId } from "../db/client.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { canPushToSpace } from "../auth/access.js";
import { createVersion, type Provenance } from "../versions/create.js";
import { rateLimit, keyByAuthOrIp } from "../ratelimit.js";

const pushLimiter = rateLimit({ windowMs: 60_000, max: 60, keyFn: keyByAuthOrIp, message: "push rate limit exceeded — try again shortly" });

const MAX_BYTES = 5 * 1024 * 1024;

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

interface PublishBody {
  html?: string;
  metadata?: {
    author_type?: "human" | "agent";
    author?: string;
    tool?: string;
    source_repo?: string;
    commit_sha?: string;
    branch?: string;
    title?: string;
  };
  draft?: boolean;
}

type Auth =
  | { kind: "token"; orgId: string }
  | { kind: "session"; userId: string };

/**
 * Two auth paths:
 *  - push-scope token (agents / CLI / import scripts)
 *  - human session cookie (dashboard upload) — the user must be an owner of
 *    the target space
 */
async function authn(deps: ServerDeps, c: any): Promise<Auth | { error: number; msg: string } | null> {
  const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const t = await verifyToken(deps.db, raw);
    if (!t) return { error: 401, msg: "invalid token" };
    if (!hasScope(t.scopes as Scope[], "push")) return { error: 403, msg: "push scope required" };
    return { kind: "token", orgId: t.orgId };
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

export function versionsRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.use("/spaces/:space/docs/:slug/versions", pushLimiter);
  r.post("/spaces/:space/docs/:slug/versions", async (c) => {
    const auth = await authn(deps, c);
    if (!auth) return c.json(err("missing token or session"), 401);
    if ("error" in auth) return c.json(err(auth.msg), auth.error as 401 | 403);

    const body = (await c.req.json().catch(() => null)) as PublishBody | null;
    if (!body?.html) return c.json(err("html required"), 400);
    const bytes = new TextEncoder().encode(body.html);
    if (bytes.byteLength > MAX_BYTES) return c.json(err("body exceeds 5 MB"), 413);

    // Resolve the space by slug, scoped to what the caller may push to.
    // Token: the token's org. Session: any space with this slug the user can push to
    // (org spaces they're a member/admin of, or a personal space they own).
    let space;
    if (auth.kind === "token") {
      space = deps.db
        .select()
        .from(spaces)
        .where(and(eq(spaces.orgId, auth.orgId), eq(spaces.slug, c.req.param("space"))))
        .get();
    } else {
      space = deps.db.select().from(spaces).where(eq(spaces.slug, c.req.param("space"))).all()
        .find((s) => canPushToSpace(deps.db, s, auth));
    }
    if (!space) return c.json(err("space not found"), 404);
    const orgId = space.orgId;
    if (!orgId) return c.json(err("personal space pushes require the dashboard owner session"), 403);

    if (auth.kind === "session" && !canPushToSpace(deps.db, space, auth)) {
      return c.json(err("you are not allowed to push to this space"), 403);
    }

    // Find or create the doc. Auto-creation lets the dashboard upload brand-new
    // docs (and lets bulk import land first versions) without a pre-create step.
    let doc = deps.db
      .select()
      .from(docs)
      .where(and(eq(docs.spaceId, space.id), eq(docs.slug, c.req.param("slug"))))
      .get();
    if (!doc) {
      const id = newId();
      deps.db
        .insert(docs)
        .values({
          id,
          spaceId: space.id,
          slug: c.req.param("slug"),
          title: body.metadata?.title ?? c.req.param("slug"),
          createdAt: Date.now(),
        })
        .run();
      doc = deps.db.select().from(docs).where(eq(docs.id, id)).get();
    }
    if (!doc) return c.json(err("failed to create doc"), 500);

    const m = body.metadata ?? {};
    const provenance: Provenance = {
      // Humans uploading from the dashboard are human authors by default;
      // tokens default to agent.
      authorType: m.author_type ?? (auth.kind === "session" ? "human" : "agent"),
      authorName: m.author ?? (auth.kind === "session" ? "dashboard" : undefined),
      tool: m.tool ?? (auth.kind === "session" ? "confer-dashboard" : undefined),
      sourceRepo: m.source_repo,
      commitSha: m.commit_sha,
      branch: m.branch,
    };

    const res = await createVersion(
      { db: deps.db, blobs: deps.blobs, appOrigin: deps.appOrigin },
      { orgId, spaceId: space.id, docId: doc.id, html: bytes, draft: body.draft, provenance },
    );

    return c.json(
      ok({ version_id: res.versionId, review_url: res.reviewUrl, deduped: res.deduped }),
      201,
    );
  });

  return r;
}