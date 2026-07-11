import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { createToken, listTokens, deleteToken, type Scope } from "../auth/tokens.js";
import { verifySession, parseCookie, SessionError } from "../auth/sessions.js";
import { orgRole, userOrgs, type OrgRole } from "../auth/access.js";
import { tokens } from "../db/schema.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

/**
 * Token management for the dashboard. Session-only; the user must be an admin
 * of the target org.
 *
 *  GET    /api/v1/tokens?org_id=…            — list (no hashes)
 *  POST   /api/v1/tokens    { org_id?, name, scopes }   — create; raw token returned ONCE
 *  DELETE /api/v1/tokens/:id?org_id=…                   — revoke (org admin)
 *
 * If the user belongs to exactly one org, `org_id` is optional.
 */
export function tokenRoutes(deps: ServerDeps): Hono {
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

  function adminOrgFor(userId: string, orgIdOrSlug?: string): { orgId: string; role: OrgRole } | { error: number; msg: string } {
    const orgsForUser = userOrgs(deps.db, userId);
    if (orgsForUser.length === 0) return { error: 403, msg: "no org membership" };
    const target = orgIdOrSlug ? orgsForUser.find((o) => o.id === orgIdOrSlug || o.slug === orgIdOrSlug) : orgsForUser[0];
    if (!target) return { error: 404, msg: "org not found" };
    const role = orgRole(deps.db, target.id, userId);
    if (role !== "admin") return { error: 403, msg: "org admin role required" };
    return { orgId: target.id, role };
  }

  r.get("/tokens", (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    // Personal tokens: ?owner_id=me (only own tokens). Org tokens: ?org_id=…
    const ownerId = c.req.query("owner_id");
    if (ownerId) {
      if (ownerId !== "me" && ownerId !== userId) return c.json(err("forbidden"), 403);
      const rows = listTokens(deps.db, { ownerId: userId }).map((t) => ({
        id: t.id,
        name: t.name,
        scopes: t.scopes.split(","),
        last_used_at: t.lastUsedAt,
      }));
      return c.json(ok({ tokens: rows, owner_id: userId }));
    }
    const ctx = adminOrgFor(userId, c.req.query("org_id"));
    if ("error" in ctx) return c.json(err(ctx.msg), ctx.error as 403 | 404);
    const rows = listTokens(deps.db, { orgId: ctx.orgId }).map((t) => ({
      id: t.id,
      name: t.name,
      scopes: t.scopes.split(","),
      last_used_at: t.lastUsedAt,
    }));
    return c.json(ok({ tokens: rows, org_id: ctx.orgId }));
  });

  r.post("/tokens", async (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    const body = (await c.req.json().catch(() => null)) as { name?: string; scopes?: string[]; org_id?: string; owner_id?: string } | null;
    if (!body?.name?.trim()) return c.json(err("name required"), 400);
    const scopes = (body.scopes ?? []).filter((s): s is Scope => ["push", "read", "mcp", "unapproved"].includes(s));
    if (scopes.length === 0) return c.json(err("at least one scope required (push/read/mcp/unapproved)"), 400);
    // Decide scope: owner_id wins if set, otherwise org_id
    if (body.owner_id) {
      if (body.owner_id !== "me" && body.owner_id !== userId) return c.json(err("can only create personal tokens for yourself"), 403);
      const { raw, id } = createToken(deps.db, { ownerId: userId }, body.name.trim(), scopes);
      return c.json(ok({ id, raw, name: body.name.trim(), scopes, owner_id: userId }), 201);
    }
    const ctx = adminOrgFor(userId, body.org_id);
    if ("error" in ctx) return c.json(err(ctx.msg), ctx.error as 403 | 404);
    const { raw, id } = createToken(deps.db, { orgId: ctx.orgId }, body.name.trim(), scopes);
    return c.json(ok({ id, raw, name: body.name.trim(), scopes, org_id: ctx.orgId }), 201);
  });

  r.delete("/tokens/:id", (c) => {
    const userId = sessionUserId(c);
    if (!userId) return c.json(err("authentication required"), 401);
    // Try personal-token path first (?owner_id=me or the token belongs to user)
    const ownerQ = c.req.query("owner_id");
    if (ownerQ) {
      if (ownerQ !== "me" && ownerQ !== userId) return c.json(err("forbidden"), 403);
      // Verify token belongs to user, then delete
      const row = deps.db.select().from(tokens).where(eq(tokens.id, c.req.param("id"))).get();
      if (!row || row.ownerId !== userId) return c.json(err("token not found"), 404);
      deleteToken(deps.db, c.req.param("id"));
      return c.json(ok({ ok: true }));
    }
    const ctx = adminOrgFor(userId, c.req.query("org_id"));
    if ("error" in ctx) return c.json(err(ctx.msg), ctx.error as 403 | 404);
    deleteToken(deps.db, c.req.param("id"));
    return c.json(ok({ ok: true }));
  });

  return r;
}