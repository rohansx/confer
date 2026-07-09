import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { newId } from "../db/client.js";
import { spaces, docs } from "../db/schema.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { userOrgs } from "../auth/access.js";
import { ensurePersonalSpace } from "../auth/identity.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

/**
 * Personal portal endpoints. Routes:
 *   GET   /me              — current user (with orgs + personal-space info)
 *   GET   /me/spaces       — list the user's personal spaces
 *   POST  /me/spaces       — create a personal space
 */
export function meRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  function sessionUserId(c: any): string | null {
    const cookie = parseCookie(c.req.header("cookie"));
    if (!cookie) return null;
    try {
      return verifySession(deps.signingSecret, cookie).userId;
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
      return null;
    }
  }

  r.get("/me", (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    // Auto-create a personal space on first /me hit (idempotent — no-op if exists).
    ensurePersonalSpace(deps.db, userId);
    const orgs = userOrgs(deps.db, userId);
    const personal = deps.db
      .select()
      .from(spaces)
      .where(eq(spaces.ownerId, userId))
      .all();
    return c.json(ok({ user_id: userId, orgs, personal_spaces: personal.map(stripSpaceToPublic) }));
  });

  r.get("/me/spaces", (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const rows = deps.db
      .select()
      .from(spaces)
      .where(eq(spaces.ownerId, userId))
      .all();
    return c.json(ok({ spaces: rows.map(stripSpaceToPublic) }));
  });

  r.post("/me/spaces", async (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const body = (await c.req.json().catch(() => null)) as { name?: string; slug?: string; required_approvals?: number } | null;
    if (!body?.name?.trim()) return c.json(err("name required"), 400);
    const slug = (body.slug ?? body.name).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) return c.json(err("slug must contain at least one alphanumeric character"), 400);
    // Uniqueness within the user's personal spaces
    const dupe = deps.db
      .select()
      .from(spaces)
      .where(and(eq(spaces.ownerId, userId), eq(spaces.slug, slug)))
      .get();
    if (dupe) return c.json(err(`a personal space with slug "${slug}" already exists`), 409);
    const id = newId();
    deps.db.insert(spaces)
      .values({
        id,
        orgId: null,
        ownerId: userId,
        slug,
        name: body.name.trim(),
        requiredApprovals: Math.max(1, Math.min(99, body.required_approvals ?? 1)),
      })
      .run();
    const created = deps.db.select().from(spaces).where(eq(spaces.id, id)).get()!;
    return c.json(ok(stripSpaceToPublic(created)), 201);
  });

  return r;
}

function stripSpaceToPublic(s: { id: string; orgId: string | null; ownerId: string | null; slug: string; name: string; requiredApprovals: number }) {
  return {
    id: s.id,
    org_id: s.orgId,
    owner_id: s.ownerId,
    slug: s.slug,
    name: s.name,
    required_approvals: s.requiredApprovals,
  };
}