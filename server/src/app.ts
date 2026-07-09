import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
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
  app.get("/health", (c) => c.json({ ok: true }));
  // Cookie-bearing bridge iframe for the view-origin comment overlay (maximize mode).
  app.get("/api/v1/comment-bridge", (c) => c.html(COMMENT_BRIDGE_HTML));
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
      app.use("/assets/*", serveStatic({ root: webDist }));
      app.get("*", (c) => {
        const p = new URL(c.req.url).pathname;
        if (p === "/health" || p.startsWith("/api/") || p === "/mcp") return c.notFound();
        return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
      });
    }
  }

  return app;
}