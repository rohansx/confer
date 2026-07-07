/**
 * Dev-only: run the two-origin server on BOTH the app port and the view port,
 * so a browser gets genuinely different origins (localhost:5173 vs :5174)
 * without editing /etc/hosts. Routing is by Host header (see server.ts).
 * Run: tsx --env-file=.env server/src/dev/serve-both.ts
 */
import { serve } from "@hono/node-server";
import { loadConfig } from "../config.js";
import { openDb } from "../db/client.js";
import { DiskBlobStore } from "../blob/disk.js";
import { buildServer } from "../server.js";

const cfg = loadConfig(process.env);
const server = buildServer({
  db: openDb(cfg.dbPath),
  blobs: new DiskBlobStore(cfg.blobDir),
  appOrigin: cfg.appOrigin,
  viewOrigin: cfg.viewOrigin,
  signingSecret: cfg.signingSecret,
});

const appPort = Number(new URL(cfg.appOrigin).port || 5173);
const viewPort = Number(new URL(cfg.viewOrigin).port || 5174);

serve({ fetch: server.fetch, port: appPort });
serve({ fetch: server.fetch, port: viewPort });
console.log(`app on :${appPort}  ·  view on :${viewPort}`);
