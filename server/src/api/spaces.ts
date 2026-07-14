import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { spaces, spaceOwners, orgMemberships } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { resolveReadableSpace, canManageSpace, readableSpaceIds } from "../auth/access.js";
import { ensurePersonalSpace } from "../auth/identity.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

/**
 * GET /api/v1/spaces — list spaces visible to the caller.
 *  - session: org spaces in the user's orgs (member/admin) + personal spaces
 *    they own + spaces they're a space_owner of (legacy grant).
 *  - read-scope token: all spaces in the token's org.
 */
export function spacesRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.get("/spaces", async (c) => {
    // session path
    const cookie = parseCookie(c.req.header("cookie"));
    if (cookie) {
      let userId: string;
      try {
        userId = verifySession(deps.signingSecret, cookie).userId;
      } catch (e) {
        if (!(e instanceof SessionError)) throw e;
        userId = "";
      }
      if (userId) {
        // Self-heal: a signed-in human always has a personal space. Covers users
        // whose session predates the feature (they never re-hit /auth/login).
        ensurePersonalSpace(deps.db, userId);
        const orgIds = deps.db
          .select({ orgId: orgMemberships.orgId })
          .from(orgMemberships)
          .where(eq(orgMemberships.userId, userId))
          .all()
          .map((r) => r.orgId);
        const ownedSpaceIds = deps.db
          .select({ id: spaceOwners.spaceId })
          .from(spaceOwners)
          .where(eq(spaceOwners.userId, userId))
          .all()
          .map((r) => r.id);

        const all = deps.db.select().from(spaces).all();
        const visible = all.filter((s) => {
          if (s.ownerId === userId) return true; // personal space owned
          if (s.orgId && orgIds.includes(s.orgId)) return true; // org member
          if (ownedSpaceIds.includes(s.id)) return true; // legacy space_owner grant
          return false;
        });
        return c.json(ok({
          spaces: visible.map((s) => ({ id: s.id, slug: s.slug, name: s.name, orgId: s.orgId, ownerId: s.ownerId })),
        }));
      }
    }
    // token path
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (raw) {
      const t = await verifyToken(deps.db, raw);
      if (!t) return c.json(err("invalid token"), 401);
      if (!hasScope(t.scopes as Scope[], "read")) return c.json(err("read scope required"), 403);
      // Org token → its org's spaces; owner token → the owner's personal spaces.
      const ids = readableSpaceIds(deps.db, { kind: "token", orgId: t.orgId, ownerId: t.ownerId });
      const list = deps.db.select().from(spaces).all()
        .filter((s) => ids.has(s.id))
        .map((s) => ({ id: s.id, slug: s.slug, name: s.name, orgId: s.orgId, ownerId: s.ownerId }));
      return c.json(ok({ spaces: list }));
    }
    return c.json(err("authentication required"), 401);
  });

  function sessionUser(c: any): string | null {
    const cookie = parseCookie(c.req.header("cookie"));
    if (!cookie) return null;
    try { return verifySession(deps.signingSecret, cookie).userId; }
    catch (e) { if (!(e instanceof SessionError)) throw e; return null; }
  }

  // GET a space's context / system prompt. Any reader of the space.
  r.get("/spaces/:space/context", (c) => {
    const userId = sessionUser(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const space = resolveReadableSpace(deps.db, userId, c.req.param("space"));
    if (!space) return c.json(err("space not found"), 404);
    return c.json(ok({ space: space.slug, context: space.context ?? "", can_edit: canManageSpace(deps.db, space, userId) }));
  });

  // PUT a space's context (space admin / personal owner only).
  r.put("/spaces/:space/context", async (c) => {
    const userId = sessionUser(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const space = resolveReadableSpace(deps.db, userId, c.req.param("space"));
    if (!space) return c.json(err("space not found"), 404);
    if (!canManageSpace(deps.db, space, userId)) return c.json(err("space admin or owner required"), 403);
    const body = (await c.req.json().catch(() => null)) as { context?: string } | null;
    const context = (body?.context ?? "").slice(0, 20_000);
    deps.db.update(spaces).set({ context: context || null }).where(eq(spaces.id, space.id)).run();
    return c.json(ok({ space: space.slug, context }));
  });

  return r;
}