import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { createBlobStore } from "./blob/create.js";
import { buildServer } from "./server.js";
import { bootNotify } from "./notify/index.js";

bootNotify(process.env);

const cfg = loadConfig(process.env);
const server = buildServer({
  db: openDb(cfg.dbPath),
  blobs: createBlobStore(cfg),
  appOrigin: cfg.appOrigin,
  viewOrigin: cfg.viewOrigin,
  signingSecret: cfg.signingSecret,
  webDistDir: process.env.WEB_DIST_DIR ?? "./web/dist",
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: server.fetch, port });
console.log(
  `confer server on :${port}  (app=${cfg.appOrigin}  view=${cfg.viewOrigin})`,
);
