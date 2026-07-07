import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { DiskBlobStore } from "./blob/disk.js";
import { buildApp } from "./app.js";

const cfg = loadConfig(process.env);
const app = buildApp({
  db: openDb(cfg.dbPath),
  blobs: new DiskBlobStore(cfg.blobDir),
  appOrigin: cfg.appOrigin,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`confer server listening on :${port}`);
