import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerDeps } from "./deps.js";
import { versionsRoutes } from "./api/versions.js";
import { versionDetailRoutes } from "./api/version-detail.js";
import { authRoutes } from "./api/auth.js";
import { reviewRoutes } from "./api/review.js";
import { diffRoutes } from "./api/diff.js";
import { commentRoutes } from "./api/comments.js";
import { docsRoutes } from "./api/docs.js";
import { spacesRoutes } from "./api/spaces.js";
import { tokenRoutes } from "./api/tokens.js";
import { starRoutes } from "./api/stars.js";
import { orgRoutes } from "./api/orgs.js";
import { meRoutes } from "./api/me.js";
import { COMMENT_BRIDGE_HTML } from "./comment-bridge.js";
import { Fts5Provider } from "./search/provider.js";
import { buildMcpHandler } from "./mcp/server.js";
import { rateLimit, keyByAuthOrIp } from "./ratelimit.js";

const mcpLimiter = rateLimit({ windowMs: 60_000, max: 200, keyFn: keyByAuthOrIp, message: "mcp rate limit exceeded — try again shortly" });

/** App-origin routes: health, publish, version detail, review, auth, MCP, diff, comments, docs, spaces, tokens, stars, + SPA. */
export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();

  // Compress text responses (HTML/JS/CSS/JSON) — big transfer-size win on the SPA
  // bundle. Skip /mcp: its streamable-HTTP SSE must not be buffered/compressed.
  app.use(async (c, next) => {
    if (c.req.path === "/mcp") return next();
    return compress()(c, next);
  });

  // Safe security headers on every response. HSTS only when serving over https
  // (prod). Deliberately NOT setting X-Frame-Options / COOP / CSP on the app
  // origin — the view-origin comment bridge is an app-origin iframe embedded
  // cross-origin, and frame/opener isolation would break it.
  const prodHttps = deps.appOrigin.startsWith("https://");
  app.use(async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (prodHttps) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\n"));

  // Auth-scoped, user-specific API responses must never be cached by the
  // browser — a stale listSpaces/me/docs response survives a login or a
  // backfill and shows the wrong data. (View-origin content sets its own
  // caching in the separate viewer app.)
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.get("/health", (c) => c.json({ ok: true }));
  // Cookie-bearing bridge iframe for the view-origin comment overlay (maximize
  // mode). It IS embedded cross-origin by the view page, so frame-ancestors must
  // name it; its own tiny inline script needs script-src 'unsafe-inline'.
  app.get("/api/v1/comment-bridge", (c) =>
    c.html(COMMENT_BRIDGE_HTML, 200, {
      "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors ${deps.viewOrigin}`,
    }),
  );
  app.route("/api/v1", versionsRoutes(deps));
  app.route("/api/v1", versionDetailRoutes(deps));
  app.route("/api/v1", authRoutes(deps));
  app.route("/api/v1", reviewRoutes(deps));
  app.route("/api/v1", diffRoutes(deps));
  app.route("/api/v1", commentRoutes(deps));

  const searchProvider = new Fts5Provider(deps.db, deps.blobs);
  app.route("/api/v1", docsRoutes(deps, searchProvider));
  app.route("/api/v1", spacesRoutes(deps));
  app.route("/api/v1", tokenRoutes(deps));
  app.route("/api/v1", starRoutes(deps));
  app.route("/api/v1", orgRoutes(deps));
  app.route("/api/v1", meRoutes(deps));

  const mcpHandler = buildMcpHandler(deps, { searchProvider });
  // Streamable HTTP: GET (SSE), POST (messages), DELETE all route to the transport.
  app.all("/mcp", mcpLimiter, (c) => mcpHandler(c.req.raw));

  // Production SPA serving. Only mounted when the built dashboard is present;
  // in dev Vite serves the SPA on its own port. The view origin (server.ts)
  // never reaches this code — it only serves /c/:hash — so app cookies stay off
  // the content origin.
  const webDist = deps.webDistDir;
  if (webDist) {
    const indexHtml = join(webDist, "index.html");
    if (existsSync(indexHtml)) {
      const index = readFileSync(indexHtml);
      // CSP for the dashboard/landing document. script-src 'self' (no inline
      // scripts — the font swap moved into the bundle); style-src allows inline
      // (React style props / framer-motion) + Google Fonts; frame-src allows the
      // view origin (the review iframe); the app itself is never framed.
      const spaCsp = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        `frame-src ${deps.viewOrigin}`,
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; ");
      // Vite fingerprints asset filenames, so they're safe to cache forever.
      app.use("/assets/*", async (c, next) => {
        await next();
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      });
      app.use("/assets/*", serveStatic({ root: webDist }));
      app.get("*", (c) => {
        const p = new URL(c.req.url).pathname;
        if (p === "/health" || p.startsWith("/api/") || p === "/mcp") return c.notFound();
        return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": spaCsp } });
      });
    }
  }

  return app;
}