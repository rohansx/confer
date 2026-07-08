/**
 * Production two-origin server. Binds the app port and the view port in one
 * process; Caddy (or any reverse proxy) routes by Host header to the right
 * port. Used by the Docker image and by `node server/dist/serve-both.js`
 * in self-host deployments.
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { createBlobStore } from "./blob/create.js";
import { buildServer } from "./server.js";
import { bootNotify } from "./notify/index.js";

bootNotify(process.env);

const cfg = loadConfig(process.env);
const deps = {
  db: openDb(cfg.dbPath),
  blobs: createBlobStore(cfg),
  appOrigin: cfg.appOrigin,
  viewOrigin: cfg.viewOrigin,
  signingSecret: cfg.signingSecret,
  webDistDir: process.env.WEB_DIST_DIR ?? "./web/dist",
};
const app = buildServer(deps);

const appPort = Number(process.env.PORT ?? (new URL(cfg.appOrigin).port || 5173));
const viewPort = Number(process.env.VIEW_PORT ?? (new URL(cfg.viewOrigin).port || 5174));

serve({ fetch: app.fetch, port: appPort }, (info) => {
  console.log(`confer app  on :${info.port}  (${cfg.appOrigin})`);
});

serve({ fetch: app.fetch, port: viewPort }, (info) => {
  console.log(`confer view on :${info.port}  (${cfg.viewOrigin})`);
});