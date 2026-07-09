import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs, users, spaceOwners } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createVersion } from "../versions/create.js";
import { approve } from "../review/approve.js";
import { buildApp } from "../app.js";
import { diffRoutes } from "./diff.js";

let db: DB;
let blobs: DiskBlobStore;
let app: Hono;
let orgId: string;
let spaceId: string;
let docId: string;
let ownerUserId: string;
let pushTok: string;
let readTok: string;

const APP = "https://app";

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-diff-")));
  db = openDb(":memory:");
  app = buildApp({ db, blobs, appOrigin: APP, viewOrigin: "https://view", signingSecret: "s" });
  app.route("/api/v1", diffRoutes({ db, blobs, appOrigin: APP, viewOrigin: "https://view", signingSecret: "s" }));

  orgId = newId(); spaceId = newId(); docId = newId();
  ownerUserId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();
  pushTok = createToken(db, { orgId }, "ci", ["push"]).raw;
  readTok = createToken(db, { orgId }, "ro", ["read"]).raw;
});

async function push(html: string) {
  const r = await createVersion(
    { db, blobs, appOrigin: APP },
    { orgId, spaceId, docId, html: new TextEncoder().encode(html), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
  );
  return r.versionId;
}

const req = (path: string, init: RequestInit & { bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

describe("GET /api/v1/spaces/:space/docs/:slug/diff", () => {
  it("returns word-level segments between two versions", async () => {
    const v1 = await push("<h1>Hello world</h1>");
    const v2 = await push("<h1>Hello brave world</h1>");

    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?from=1&to=2`, { bearer: readTok });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.from.number).toBe(1);
    expect(body.data.to.number).toBe(2);
    expect(body.data.segments).toBeDefined();
    expect(Array.isArray(body.data.segments)).toBe(true);
    const inserts = body.data.segments.filter((s: any) => s.op === "insert").map((s: any) => s.text).join("");
    expect(inserts).toContain("brave");
  });

  it("auto-selects from = prior version when not specified", async () => {
    await push("<h1>One</h1>");
    await push("<h1>Two</h1>");
    await push("<h1>Three</h1>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?to=3`, { bearer: readTok });
    const body = await res.json() as any;
    expect(body.data.from.number).toBe(2);
    expect(body.data.to.number).toBe(3);
  });

  it("returns aText and bText for side-by-side rendering", async () => {
    await push("<p>foo</p>");
    await push("<p>foo bar</p>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?from=1&to=2`, { bearer: readTok });
    const body = await res.json() as any;
    expect(body.data.aText).toBe("foo");
    expect(body.data.bText).toBe("foo bar");
  });

  it("401 with no auth, 403 with no read scope, 404 on missing", async () => {
    const noAuth = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?from=1&to=2`);
    expect(noAuth.status).toBe(401);
    const pushOnly = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?from=1&to=2`, { bearer: pushTok });
    expect(pushOnly.status).toBe(403);
    const missing = await req(`/api/v1/spaces/nope/docs/x/diff?from=1&to=2`, { bearer: readTok });
    expect(missing.status).toBe(404);
  });

  it("404 when from version doesn't exist", async () => {
    await push("<p>only</p>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/diff?from=99&to=1`, { bearer: readTok });
    expect(res.status).toBe(404);
  });
});
