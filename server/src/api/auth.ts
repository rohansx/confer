import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { users } from "../db/schema.js";
import { newId } from "../db/client.js";
import { createSessionCookie, buildSetCookie, verifySession, parseCookie } from "../auth/sessions.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

interface LoginBody {
  user_id?: string;
  name?: string;
  email?: string;
}

/**
 * DEV-ONLY login. In v0 there's no password / OAuth — this is the placeholder
 * for magic-link or GitHub OAuth. Body: { user_id, name, email }.
 * If the user exists, sign a session cookie; else auto-create.
 */
export function authRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.post("/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginBody | null;
    if (!body?.user_id || !body?.name) {
      return c.json(err("user_id and name required"), 400);
    }

    let user = deps.db.select().from(users).where(eq(users.id, body.user_id)).get();
    if (!user) {
      deps.db.insert(users).values({
        id: body.user_id,
        name: body.name,
        email: body.email ?? null,
        createdAt: Date.now(),
      }).run();
      user = { id: body.user_id, name: body.name, email: body.email ?? null, createdAt: Date.now() };
    }

    const sess = createSessionCookie(deps.signingSecret, user.id);
    const isProd = deps.appOrigin.startsWith("https://");
    c.header("Set-Cookie", buildSetCookie(sess.value, sess.exp, isProd));
    return c.json(ok({ user: { id: user.id, name: user.name, email: user.email } }));
  });

  r.post("/auth/logout", (c) => {
    c.header("Set-Cookie", `${"confer_session"}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    return c.json(ok({ ok: true }));
  });

  /** "whoami" — returns the current user, or 401. */
  r.get("/auth/whoami", (c) => {
    const raw = parseCookie(c.req.header("cookie"));
    try {
      const { userId } = verifySession(deps.signingSecret, raw);
      const u = deps.db.select().from(users).where(eq(users.id, userId)).get();
      if (!u) return c.json(err("not found"), 404);
      return c.json(ok({ id: u.id, name: u.name, email: u.email }));
    } catch {
      return c.json(err("unauthenticated"), 401);
    }
  });

  return r;
}
