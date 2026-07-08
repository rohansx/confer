import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { spaces, spaceOwners, orgMemberships } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";

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
      const list = deps.db
        .select({ id: spaces.id, slug: spaces.slug, name: spaces.name, orgId: spaces.orgId, ownerId: spaces.ownerId })
        .from(spaces)
        .where(eq(spaces.orgId, t.orgId))
        .all();
      return c.json(ok({ spaces: list }));
    }
    return c.json(err("authentication required"), 401);
  });

  return r;
}