import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { ServerDeps } from "../deps.js";
import { users, orgMemberships, orgs } from "../db/schema.js";
import { createSessionCookie, buildSetCookie, verifySession, parseCookie } from "../auth/sessions.js";
import { createMagicLink, consumeMagicLink, purgeMagicLinks } from "../auth/magic-link.js";
import { findOrCreateUserByEmail, linkIdentity, findUserBySubject, ensurePersonalSpace } from "../auth/identity.js";
import { userOrgs, acceptPendingInvites } from "../auth/access.js";

const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

const isProd = (origin: string) => origin.startsWith("https://");
const devEcho = () => process.env.MAGIC_LINK_DEV_ECHO === "1";

/**
 * Auth routes.
 *
 * Real auth:
 *  - POST /auth/magic-link      { email }            → issue a one-time link
 *  - GET  /auth/magic-link/verify?token=…            → consume + set session, redirect
 *  - GET  /auth/oauth/start?provider=github|google    → redirect to OAuth authorize URL
 *  - GET  /auth/oauth/callback?code=…&state=…        → exchange, set session, redirect
 *
 * Dev/self-host fallback (kept so existing setups + tests keep working):
 *  - POST /auth/login          { user_id, name, email? } → sign a session for a known
 *                                    or new user. Disabled when DEV_LOGIN=0.
 *
 *  - POST /auth/logout
 *  - GET  /auth/whoami
 */
export function authRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  // ---- Magic link: request ------------------------------------------------
  r.post("/auth/magic-link", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) return c.json(err("valid email required"), 400);

    purgeMagicLinks(deps.db);
    const raw = createMagicLink(deps.db, email);

    // Delivery: no SMTP wired yet — log to the server console in dev/self-host.
    // When MAGIC_LINK_DEV_ECHO=1, also return it in the response (dev convenience).
    const verifyUrl = `${deps.appOrigin}/api/v1/auth/magic-link/verify?token=${encodeURIComponent(raw)}`;
    // eslint-disable-next-line no-console
    console.log(`[confer] magic link for ${email}: ${verifyUrl}`);

    return c.json(ok({ sent: true, ...(devEcho() ? { verify_url: verifyUrl } : {}) }));
  });

  // ---- Magic link: verify (consumes the token) ---------------------------
  r.get("/auth/magic-link/verify", async (c) => {
    const token = c.req.query("token") ?? "";
    const res = consumeMagicLink(deps.db, token);
    if (!res.ok) {
      return c.redirect(`${deps.appOrigin}/#/login?error=${encodeURIComponent(res.reason)}`);
    }
    const { userId } = findOrCreateUserByEmail(deps.db, res.email, res.email.split("@")[0]);
    linkIdentity(deps.db, userId, "email", res.email);
    ensurePersonalSpace(deps.db, userId);

    const sess = createSessionCookie(deps.signingSecret, userId);
    c.header("Set-Cookie", buildSetCookie(sess.value, sess.exp, isProd(deps.appOrigin)));
    return c.redirect(`${deps.appOrigin}/#/app`);
  });

  // ---- OAuth: start (GitHub / Google) -------------------------------------
  r.get("/auth/oauth/start", (c) => {
    const provider = c.req.query("provider") ?? "github";
    const cfg = oauthConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return c.json(err(`${provider} OAuth not configured (set ${provider.toUpperCase()}_CLIENT_ID / ${githubOrGoogleSecretEnv(provider)})`), 503);
    }
    const state = (c.req.query("next") ?? "/app");
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: `${deps.appOrigin}/api/v1/auth/oauth/callback?provider=${provider}`,
      scope: provider === "github" ? "read:user user:email" : "openid email profile",
      state,
    });
    const authUrl = provider === "github"
      ? `https://github.com/login/oauth/authorize?${params}`
      : `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    return c.redirect(authUrl);
  });

  // ---- OAuth: callback ---------------------------------------------------
  r.get("/auth/oauth/callback", async (c) => {
    const provider = c.req.query("provider") ?? "github";
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "/app";
    if (!code) return c.redirect(`${deps.appOrigin}/#/login?error=oauth_no_code`);

    const cfg = oauthConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return c.redirect(`${deps.appOrigin}/#/login?error=oauth_not_configured`);
    }
    try {
      const tok = await exchangeOAuthCode(provider, cfg, code, `${deps.appOrigin}/api/v1/auth/oauth/callback?provider=${provider}`);
      const profile = await fetchOAuthProfile(provider, tok);
      // Email is the identity key; require it.
      const email = profile.email?.toLowerCase().trim();
      if (!email) return c.redirect(`${deps.appOrigin}/#/login?error=oauth_no_email`);

      // Prefer an existing identity (same provider+subject), else find by email.
      const bySubject = findUserBySubject(deps.db, provider, profile.subject);
      let userId: string;
      if (bySubject) {
        userId = bySubject.id;
      } else {
        userId = findOrCreateUserByEmail(deps.db, email, profile.name ?? undefined, profile.avatar ?? undefined).userId;
      }
      linkIdentity(deps.db, userId, provider, profile.subject);
      ensurePersonalSpace(deps.db, userId);

      const sess = createSessionCookie(deps.signingSecret, userId);
      c.header("Set-Cookie", buildSetCookie(sess.value, sess.exp, isProd(deps.appOrigin)));
      return c.redirect(`${deps.appOrigin}/#${state}`);
    } catch (e) {
      return c.redirect(`${deps.appOrigin}/#/login?error=oauth_failed`);
    }
  });

  // ---- Dev/self-host login (kept for existing setups + tests) ------------
  r.post("/auth/login", async (c) => {
    if (process.env.DEV_LOGIN === "0") return c.json(err("dev login disabled"), 403);
    const body = (await c.req.json().catch(() => null)) as { user_id?: string; name?: string; email?: string } | null;
    if (!body?.user_id || !body?.name) return c.json(err("user_id and name required"), 400);

    let user = deps.db.select().from(users).where(eq(users.id, body.user_id)).get();
    if (!user) {
      deps.db.insert(users).values({
        id: body.user_id,
        name: body.name,
        email: body.email ?? null,
        createdAt: Date.now(),
      }).run();
      user = deps.db.select().from(users).where(eq(users.id, body.user_id)).get()!;
      if (user.email) acceptPendingInvites(deps.db, user.id, user.email);
    }

    const sess = createSessionCookie(deps.signingSecret, user.id);
    c.header("Set-Cookie", buildSetCookie(sess.value, sess.exp, isProd(deps.appOrigin)));
    return c.json(ok({ user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatarUrl } }));
  });

  r.post("/auth/logout", (c) => {
    c.header("Set-Cookie", `${"confer_session"}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    return c.json(ok({ ok: true }));
  });

  r.get("/auth/whoami", (c) => {
    const raw = parseCookie(c.req.header("cookie"));
    try {
      const { userId } = verifySession(deps.signingSecret, raw);
      const u = deps.db.select().from(users).where(eq(users.id, userId)).get();
      if (!u) return c.json(err("not found"), 404);
      const orgsForUser = userOrgs(deps.db, u.id);
      return c.json(ok({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar_url: u.avatarUrl,
        orgs: orgsForUser,
      }));
    } catch {
      return c.json(err("unauthenticated"), 401);
    }
  });

  return r;
}

// ---------------------------------------------------------------------------
// OAuth helpers — read-only against env; no-op when unconfigured.
// ---------------------------------------------------------------------------

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

function githubOrGoogleSecretEnv(provider: string): string {
  return provider === "github" ? "GITHUB_CLIENT_SECRET" : "GOOGLE_CLIENT_SECRET";
}

function oauthConfig(provider: string): OAuthClientConfig {
  if (provider === "github") {
    return {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    };
  }
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  };
}

async function exchangeOAuthCode(provider: string, cfg: OAuthClientConfig, code: string, redirectUri: string): Promise<string> {
  const url = provider === "github"
    ? "https://github.com/login/oauth/access_token"
    : "https://oauth2.googleapis.com/token";
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(json.error ?? "no access_token");
  return json.access_token;
}

interface OAuthProfile {
  subject: string;
  email?: string;
  name?: string;
  avatar?: string;
}

async function fetchOAuthProfile(provider: string, token: string): Promise<OAuthProfile> {
  if (provider === "github") {
    const me = (await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    }).then((r) => r.json())) as { id: number; name?: string; avatar_url?: string; email?: string | null };
    let email = me.email ?? undefined;
    if (!email) {
      const emails = (await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      }).then((r) => r.json())) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email;
    }
    return { subject: String(me.id), email, name: me.name ?? undefined, avatar: me.avatar_url };
  }
  // Google
  const me = (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())) as { sub: string; email?: string; name?: string; picture?: string };
  return { subject: me.sub, email: me.email, name: me.name, avatar: me.picture };
}