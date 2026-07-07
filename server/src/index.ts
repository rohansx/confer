import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { DiskBlobStore } from "./blob/disk.js";
import { buildServer } from "./server.js";

const cfg = loadConfig(process.env);
const server = buildServer({
  db: openDb(cfg.dbPath),
  blobs: new DiskBlobStore(cfg.blobDir),
  appOrigin: cfg.appOrigin,
  viewOrigin: cfg.viewOrigin,
  signingSecret: cfg.signingSecret,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: server.fetch, port });
console.log(
  `confer server on :${port}  (app=${cfg.appOrigin}  view=${cfg.viewOrigin})`,
);
