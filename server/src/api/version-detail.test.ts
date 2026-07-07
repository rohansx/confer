import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createVersion } from "../versions/create.js";
import { buildApp } from "../app.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
let readTok: string;
let versionId: string;
const orgId = "org1";
const secret = "s3cr3t";
const view = "http://view.local";

beforeEach(async () => {
  db = openDb(":memory:");
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-vd-")));
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  const spaceId = newId();
  const docId = newId();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();

  const deps = { db, blobs, appOrigin: "http://app.local", viewOrigin: view, signingSecret: secret };
  const r = await createVersion(deps, {
    orgId,
    spaceId,
    docId,
    html: new TextEncoder().encode("<h1>v1</h1>"),
    provenance: { authorType: "agent", tool: "claude-code", sourceRepo: "acme/api", commitSha: "abc", branch: "main" },
  });
  versionId = r.versionId;
  readTok = createToken(db, orgId, "ro", ["read"]).raw;
  app = buildApp(deps);
});

const get = (id: string, auth?: string) =>
  app.request(`/api/v1/versions/${id}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });

describe("GET version detail", () => {
  it("returns metadata + provenance + a signed content_url", async () => {
    const res = await get(versionId, readTok);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.data.title).toBe("Auth Flow");
    expect(j.data.state).toBe("in_review");
    expect(j.data.provenance.commit_sha).toBe("abc");
    expect(j.data.content_url).toContain(`${view}/c/`);
  });

  it("requires a read token (401 without)", async () => {
    expect((await get(versionId)).status).toBe(401);
  });

  it("rejects a token from another org (404)", async () => {
    db.insert(orgs).values({ id: "org2", name: "Other", slug: "other" }).run();
    const otherTok = createToken(db, "org2", "ro", ["read"]).raw;
    expect((await get(versionId, otherTok)).status).toBe(404);
  });
});
