import { Hono } from "hono";
import type { ServerDeps } from "./deps.js";
import { buildApp } from "./app.js";
import { viewerRoutes } from "./viewer/serve.js";

/**
 * The two-origin dispatcher. One process, two hostnames: requests to the view
 * host get ONLY the viewer (user content), everything else gets the app (API,
 * auth, dashboard). This is what keeps app cookies structurally off the content
 * origin — see docs/security.md §1.
 */
export function buildServer(deps: ServerDeps): Hono {
  const appApp = buildApp(deps);
  const viewerApp = new Hono();
  viewerApp.route("/", viewerRoutes(deps));

  const viewHost = new URL(deps.viewOrigin).host;

  const server = new Hono();
  server.all("*", (c) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (host === viewHost) return viewerApp.fetch(c.req.raw);
    return appApp.fetch(c.req.raw);
  });
  return server;
}
