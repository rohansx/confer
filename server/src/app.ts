import { Hono } from "hono";
import type { ServerDeps } from "./deps.js";
import { versionsRoutes } from "./api/versions.js";
import { versionDetailRoutes } from "./api/version-detail.js";
import { authRoutes } from "./api/auth.js";
import { reviewRoutes } from "./api/review.js";

/** App-origin routes: health, publish, version detail, review, auth. */
export function buildApp(deps: ServerDeps): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api/v1", versionsRoutes(deps));
  app.route("/api/v1", versionDetailRoutes(deps));
  app.route("/api/v1", authRoutes(deps));
  app.route("/api/v1", reviewRoutes(deps));
  return app;
}
