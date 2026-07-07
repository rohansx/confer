import { Hono } from "hono";
import type { ServerDeps } from "./deps.js";
import { versionsRoutes } from "./api/versions.js";
import { versionDetailRoutes } from "./api/version-detail.js";
import { authRoutes } from "./api/auth.js";
import { reviewRoutes } from "./api/review.js";
import { diffRoutes } from "./api/diff.js";
import { commentRoutes } from "./api/comments.js";
import { Fts5Provider } from "./search/provider.js";
import { buildMcpHandler } from "./mcp/server.js";

/** App-origin routes: health, publish, version detail, review, auth, MCP, diff, comments. */
export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api/v1", versionsRoutes(deps));
  app.route("/api/v1", versionDetailRoutes(deps));
  app.route("/api/v1", authRoutes(deps));
  app.route("/api/v1", reviewRoutes(deps));
  app.route("/api/v1", diffRoutes(deps));
  app.route("/api/v1", commentRoutes(deps));

  const searchProvider = new Fts5Provider(deps.db, deps.blobs);
  const mcpHandler = buildMcpHandler(deps, { searchProvider });
  // Streamable HTTP: GET (SSE), POST (messages), DELETE all route to the transport.
  app.all("/mcp", (c) => mcpHandler(c.req.raw));

  return app;
}
