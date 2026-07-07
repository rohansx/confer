import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../../server/src/db/client.js";
import { orgs, spaces, docs, users, spaceOwners } from "../../server/src/db/schema.js";
import { DiskBlobStore } from "../../server/src/blob/disk.js";
import { createToken } from "../../server/src/auth/tokens.js";
import { createVersion } from "../../server/src/versions/create.js";
import { approve } from "../../server/src/review/approve.js";
import { push } from "./push.js";
import { openCmd } from "./open.js";
import { status } from "./status.js";
import { skillInstall } from "./skill-install.js";
import { loadConfig, saveConfig, defaultConfigPath } from "./config.js";

let tmp: string;
let cfgPath: string;
let db: DB;
let blobs: DiskBlobStore;
let server: ReturnType<typeof import("@hono/node-server").serve> | null = null;
let port = 0;
let pushTok: string;
let mcpTok: string;
let ownerUserId: string;
let orgId: string;
let spaceId: string;
let docId: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "confer-cli-it-"));
  cfgPath = join(tmp, "config.json");
  blobs = new DiskBlobStore(join(tmp, "blobs"));
  db = openDb(join(tmp, "confer.db"));

  orgId = newId();
  const userId = newId();
  ownerUserId = userId;
  spaceId = newId();
  docId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(users).values({ id: userId, name: "Owner" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(spaceOwners).values({ spaceId, userId }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  pushTok = createToken(db, orgId, "ci", ["push"]).raw;
  mcpTok = createToken(db, orgId, "mcp", ["mcp"]).raw;

  // Boot the real server on a random port.
  const { serve } = await import("@hono/node-server");
  const { buildServer } = await import("../../server/src/server.js");
  const { loadConfig } = await import("../../server/src/config.js");
  const cfg = loadConfig({
    APP_ORIGIN: "http://placeholder",
    VIEW_ORIGIN: "http://view.placeholder",
    DB_PATH: join(tmp, "confer.db"),
    BLOB_DIR: join(tmp, "blobs"),
    SIGNING_SECRET: "test-secret",
  });
  port = 9400 + Math.floor(Math.random() * 200);
  const app = buildServer({ db, blobs, appOrigin: `http://localhost:${port}`, viewOrigin: cfg.viewOrigin, signingSecret: cfg.signingSecret });
  server = serve({ fetch: app.fetch, port });
  // Tiny wait for the listener.
  await new Promise((r) => setTimeout(r, 50));

  // Pre-write the config the CLI will use.
  writeFileSync(cfgPath, JSON.stringify({
    server: `http://localhost:${port}`,
    pushToken: pushTok,
  }, null, 2));
  process.env.CONFER_CONFIG = cfgPath;
});

afterEach(async () => {
  if (server) {
    server.close();
    server = null;
  }
  db.$client.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Capture process.stdout.write during a callback. */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ out: string; result: T }> {
  const original = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: any) => { buf += String(chunk); return true; };
  try {
    const result = await fn();
    return { out: buf, result };
  } finally {
    (process.stdout as any).write = original;
  }
}

describe("confer push", () => {
  it("publishes a version and persists lastPush to config", async () => {
    const file = join(tmp, "doc.html");
    writeFileSync(file, "<h1>Hello</h1>");
    const { out } = await captureStdout(() => push({
      file, space: "backend", slug: "auth-flow",
      server: `http://localhost:${port}`,
      token: pushTok,
    }));
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.version_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(parsed.review_url).toContain(parsed.version_id);

    const cfg = await loadConfig(cfgPath);
    expect(cfg.lastPush?.versionId).toBe(parsed.version_id);
  });
});

describe("confer open", () => {
  it("prints the last push's review URL with --print", async () => {
    const file = join(tmp, "doc.html");
    writeFileSync(file, "<h1>For open</h1>");
    await push({ file, space: "backend", slug: "auth-flow", server: `http://localhost:${port}`, token: pushTok });
    const { out } = await captureStdout(() => openCmd({ print: true }));
    expect(out.trim()).toMatch(/^http:\/\/localhost:\d+\/v\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("throws when there's no last push", async () => {
    await expect(openCmd({ print: true })).rejects.toThrow(/no last push/);
  });
});

describe("confer status (MCP path)", () => {
  it("returns 0 docs when nothing is approved", async () => {
    const file = join(tmp, "doc.html");
    writeFileSync(file, "<h1>For status</h1>");
    await push({ file, space: "backend", slug: "auth-flow", server: `http://localhost:${port}`, token: pushTok });
    // Token has mcp scope so it can call list_docs.
    process.env.CONFER_MCP_TOKEN = mcpTok;
    const { out } = await captureStdout(() => status({ space: "backend" }));
    expect(out).toMatch(/\(no docs found/);
  });

  it("returns the doc once it's approved", async () => {
    const file = join(tmp, "doc.html");
    writeFileSync(file, "<h1>For status approved</h1>");
    const { out: pushOut } = await captureStdout(() => push({
      file, space: "backend", slug: "auth-flow",
      server: `http://localhost:${port}`, token: pushTok,
    }));
    const pushed = JSON.parse(pushOut);
    approve(db, { versionId: pushed.version_id, userId: ownerUserId, now: 1 });
    process.env.CONFER_MCP_TOKEN = mcpTok;
    const { out } = await captureStdout(() => status({ space: "backend" }));
    expect(out).toContain("1 doc");
    expect(out).toContain("auth-flow");
  });
});

describe("confer skill install", () => {
  it("copies SKILL.md to the target directory", async () => {
    const target = join(tmp, "skills");
    const installed = await skillInstall({ dir: target });
    expect(installed).toBe(join(target, "SKILL.md"));
    expect(existsSync(installed)).toBe(true);
    const content = readFileSync(installed, "utf8");
    expect(content).toContain("name: confer");
    expect(content).toContain("GitHub PRs for docs");
    expect(content).toContain("product invariant");
  });
});

describe("config helpers", () => {
  it("defaultConfigPath honors CONFER_CONFIG", () => {
    process.env.CONFER_CONFIG = "/tmp/cfg.json";
    expect(defaultConfigPath()).toBe("/tmp/cfg.json");
    delete process.env.CONFER_CONFIG;
  });

  it("saveConfig + loadConfig roundtrip", async () => {
    const path = join(tmp, "x.json");
    await saveConfig({ server: "http://x", pushToken: "confer_x" }, path);
    const back = await loadConfig(path);
    expect(back.server).toBe("http://x");
    expect(back.pushToken).toBe("confer_x");
  });
});
