import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { orgs, orgMemberships, orgInvitations, spaces, users } from "../db/schema.js";
import { newId } from "../db/client.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { isOrgAdmin, isOrgMember, orgRole, userOrgs } from "../auth/access.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

/** Resolve the session user, or null. */
function sessionUser(deps: ServerDeps, c: any): string | null {
  const cookie = parseCookie(c.req.header("cookie"));
  if (!cookie) return null;
  try {
    return verifySession(deps.signingSecret, cookie).userId;
  } catch (e) {
    if (!(e instanceof SessionError)) throw e;
    return null;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
}

/**
 * Org + members + invites + spaces management. Session-only.
 *
 *  GET    /orgs                                  — orgs the session user belongs to (+ role)
 *  POST   /orgs            { name, slug? }       — create an org (creator = admin)
 *  GET    /orgs/:orgId                            — org detail (member only)
 *  GET    /orgs/:orgId/members                    — list members (member)
 *  POST   /orgs/:orgId/members   { email, role? } — invite by email (admin)
 *  DELETE /orgs/:orgId/members/:userId             — remove member (admin)
 *  GET    /orgs/:orgId/invites                     — list pending invites (member)
 *  DELETE /orgs/:orgId/invites/:email              — revoke an invite (admin)
 *  GET    /orgs/:orgId/spaces                      — list the org's spaces (member)
 *  POST   /orgs/:orgId/spaces  { slug, name }      — create a space (admin)
 */
export function orgRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.get("/orgs", (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    return c.json(ok({ orgs: userOrgs(deps.db, userId) }));
  });

  r.post("/orgs", async (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const body = (await c.req.json().catch(() => null)) as { name?: string; slug?: string } | null;
    if (!body?.name?.trim()) return c.json(err("name required"), 400);
    const slug = slugify(body.slug ?? body.name);
    if (deps.db.select().from(orgs).where(eq(orgs.slug, slug)).get()) {
      return c.json(err("slug already taken"), 409);
    }
    const id = newId();
    const now = Date.now();
    deps.db.transaction((tx) => {
      tx.insert(orgs).values({ id, name: body.name!.trim(), slug, createdById: userId, createdAt: now }).run();
      tx.insert(orgMemberships).values({ orgId: id, userId, role: "admin", createdAt: now }).run();
    });
    return c.json(ok({ id, name: body.name!.trim(), slug, role: "admin" }), 201);
  });

  r.get("/orgs/:orgId", (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgMember(deps.db, orgId, userId)) return c.json(err("not a member"), 403);
    const org = deps.db.select().from(orgs).where(eq(orgs.id, orgId)).get();
    if (!org) return c.json(err("not found"), 404);
    return c.json(ok({ id: org.id, name: org.name, slug: org.slug, role: orgRole(deps.db, orgId, userId) }));
  });

  r.get("/orgs/:orgId/members", (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgMember(deps.db, orgId, userId)) return c.json(err("not a member"), 403);
    const rows = deps.db.select().from(orgMemberships).where(eq(orgMemberships.orgId, orgId)).all();
    const userIds = rows.map((r) => r.userId);
    const usersList = deps.db.select().from(users).all().filter((u) => userIds.includes(u.id));
    const byId = new Map(usersList.map((u) => [u.id, u]));
    return c.json(ok({
      members: rows.map((m) => ({
        user_id: m.userId,
        name: byId.get(m.userId)?.name ?? "?",
        email: byId.get(m.userId)?.email ?? null,
        role: m.role,
      })),
    }));
  });

  r.post("/orgs/:orgId/members", async (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgAdmin(deps.db, orgId, userId)) return c.json(err("org admin required"), 403);
    const body = (await c.req.json().catch(() => null)) as { email?: string; role?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return c.json(err("valid email required"), 400);
    const role = body?.role === "admin" ? "admin" : "member";

    // If a user with this email already exists, add them directly.
    const existing = deps.db.select().from(users).all().find((u) => (u.email ?? "").toLowerCase() === email);
    if (existing) {
      const already = deps.db.select().from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, existing.id))).get();
      if (already) {
        if (role !== already.role) {
          deps.db.update(orgMemberships).set({ role }).where(eq(orgMemberships.orgId, orgId)).run();
        }
        return c.json(ok({ member: { user_id: existing.id, email, role }, already: true }));
      }
      deps.db.insert(orgMemberships).values({ orgId, userId: existing.id, role, createdAt: Date.now() }).run();
      return c.json(ok({ member: { user_id: existing.id, email, role } }), 201);
    }

    // Otherwise record a pending invitation by email (idempotent).
    const inv = deps.db.select().from(orgInvitations).where(and(eq(orgInvitations.orgId, orgId), eq(orgInvitations.email, email))).get();
    if (inv) return c.json(ok({ invite: { email, role, pending: true }, already: true }));
    deps.db.insert(orgInvitations).values({ orgId, email, invitedBy: userId, createdAt: Date.now(), acceptedAt: null }).run();
    return c.json(ok({ invite: { email, role, pending: true } }), 201);
  });

  r.delete("/orgs/:orgId/members/:userId", (c) => {
    const actor = sessionUser(deps, c);
    if (!actor) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgAdmin(deps.db, orgId, actor)) return c.json(err("org admin required"), 403);
    const target = c.req.param("userId");
    if (target === actor) {
      // Prevent removing the last admin.
      const admins = deps.db.select().from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin"))).all();
      if (admins.length <= 1) return c.json(err("cannot remove the last admin"), 400);
    }
    deps.db.delete(orgMemberships).where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, target))).run();
    return c.json(ok({ ok: true }));
  });

  r.get("/orgs/:orgId/invites", (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgMember(deps.db, orgId, userId)) return c.json(err("not a member"), 403);
    const rows = deps.db.select().from(orgInvitations).where(eq(orgInvitations.orgId, orgId)).all();
    return c.json(ok({
      invites: rows.map((i) => ({ email: i.email, created_at: i.createdAt, accepted_at: i.acceptedAt })),
    }));
  });

  r.delete("/orgs/:orgId/invites/:email", (c) => {
    const actor = sessionUser(deps, c);
    if (!actor) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgAdmin(deps.db, orgId, actor)) return c.json(err("org admin required"), 403);
    const email = decodeURIComponent(c.req.param("email")).toLowerCase();
    deps.db.delete(orgInvitations).where(and(eq(orgInvitations.orgId, orgId), eq(orgInvitations.email, email))).run();
    return c.json(ok({ ok: true }));
  });

  r.get("/orgs/:orgId/spaces", (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgMember(deps.db, orgId, userId)) return c.json(err("not a member"), 403);
    const list = deps.db.select().from(spaces).where(eq(spaces.orgId, orgId)).all();
    return c.json(ok({ spaces: list.map((s) => ({ id: s.id, slug: s.slug, name: s.name, required_approvals: s.requiredApprovals })) }));
  });

  r.post("/orgs/:orgId/spaces", async (c) => {
    const userId = sessionUser(deps, c);
    if (!userId) return c.json(err("authentication required"), 401);
    const orgId = c.req.param("orgId");
    if (!isOrgAdmin(deps.db, orgId, userId)) return c.json(err("org admin required"), 403);
    const body = (await c.req.json().catch(() => null)) as { slug?: string; name?: string } | null;
    if (!body?.name?.trim()) return c.json(err("name required"), 400);
    const slug = slugify(body.slug ?? body.name);
    const id = newId();
    deps.db.insert(spaces).values({ id, orgId, slug, name: body.name.trim(), requiredApprovals: 1 }).run();
    return c.json(ok({ id, slug, name: body.name.trim() }), 201);
  });

  return r;
}