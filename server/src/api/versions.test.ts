import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { buildApp } from "../app.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
let pushTok: string;
let readTok: string;
const orgId = "org1";
const url = "/api/v1/spaces/backend/docs/auth-flow/versions";

beforeEach(() => {
  db = openDb(":memory:");
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-api-")));
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  const spaceId = newId();
  const docId = newId();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  pushTok = createToken(db, orgId, "ci", ["push"]).raw;
  readTok = createToken(db, orgId, "ro", ["read"]).raw;
  app = buildApp({ db, blobs, appOrigin: "https://app.tryconfer.com" });
});

const post = (body: object, auth?: string) =>
  app.request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });

const meta = {
  author_type: "agent",
  tool: "claude-code",
  source_repo: "acme/api",
  commit_sha: "abc",
  branch: "main",
};

describe("POST versions", () => {
  it("creates a version with a push token", async () => {
    const res = await post({ html: "<h1>doc</h1>", metadata: meta }, pushTok);
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.version_id).toBeDefined();
    expect(json.data.review_url).toContain(json.data.version_id);
  });

  it("rejects a missing token (401)", async () => {
    expect((await post({ html: "<h1>x</h1>", metadata: meta })).status).toBe(401);
  });

  it("rejects a read-only token (403)", async () => {
    expect((await post({ html: "<h1>x</h1>", metadata: meta }, readTok)).status).toBe(403);
  });

  it("rejects a body over 5 MB (413)", async () => {
    const big = "<h1>" + "a".repeat(5 * 1024 * 1024 + 1) + "</h1>";
    expect((await post({ html: big, metadata: meta }, pushTok)).status).toBe(413);
  });

  it("is idempotent: same content returns the same version_id", async () => {
    const a = (await (await post({ html: "<h1>same</h1>", metadata: meta }, pushTok)).json()) as any;
    const b = (await (await post({ html: "<h1>same</h1>", metadata: meta }, pushTok)).json()) as any;
    expect(b.data.version_id).toBe(a.data.version_id);
  });
});
