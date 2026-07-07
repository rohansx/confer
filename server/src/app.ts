import { Hono } from "hono";
import { versionsRoutes, type ApiDeps } from "./api/versions.js";

export function buildApp(deps: ApiDeps): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api/v1", versionsRoutes(deps));
  return app;
}
