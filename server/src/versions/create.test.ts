import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { spaces, docs, versions } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createVersion } from "./create.js";

let db: DB;
let blobs: DiskBlobStore;
let docId: string;
let spaceId: string;
const orgId = "org1";

beforeEach(() => {
  db = openDb(":memory:");
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-cv-")));
  spaceId = newId();
  docId = newId();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();
});

const deps = () => ({ db, blobs, appOrigin: "https://app.tryconfer.com" });
const html = (s: string) => new TextEncoder().encode(s);
const prov = {
  authorType: "agent" as const,
  tool: "claude-code",
  sourceRepo: "acme/api",
  commitSha: "abc123",
  branch: "main",
};

describe("createVersion — session transcript", () => {
  const sess = (s: string) => new TextEncoder().encode(s);

  it("stores the session blob and sets session_hash", async () => {
    const r = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>a</h1>"), provenance: prov, session: sess("PROMPT: build auth\nDECISION: use magic links") });
    const row = db.select().from(versions).get()!;
    expect(row.sessionHash).not.toBeNull();
    expect(new TextDecoder().decode(await blobs.get(row.sessionHash!))).toContain("magic links");
  });

  it("leaves session_hash NULL when no session is attached", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>b</h1>"), provenance: prov });
    expect(db.select().from(versions).get()!.sessionHash).toBeNull();
  });

  it("rejects a session over 2 MB", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    await expect(createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>c</h1>"), provenance: prov, session: big })).rejects.toThrow(/2 MB/);
  });

  it("dedupe: backfills a session onto the existing version if it had none", async () => {
    const first = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov });
    expect(db.select().from(versions).get()!.sessionHash).toBeNull();
    const again = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov, session: sess("the why") });
    expect(again.deduped).toBe(true);
    expect(again.versionId).toBe(first.versionId);
    const rows = db.select().from(versions).all();
    expect(rows).toHaveLength(1); // no spurious version
    expect(rows[0]!.sessionHash).not.toBeNull();
  });

  it("dedupe: does NOT overwrite an existing version's session", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>x</h1>"), provenance: prov, session: sess("original") });
    const h1 = db.select().from(versions).get()!.sessionHash;
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>x</h1>"), provenance: prov, session: sess("replacement") });
    expect(db.select().from(versions).get()!.sessionHash).toBe(h1); // unchanged
  });
});

describe("createVersion", () => {
  it("creates an in_review version with a monotonic number and a review URL", async () => {
    const r = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>v1</h1>"), provenance: prov });
    expect(r.number).toBe(1);
    expect(r.deduped).toBe(false);
    expect(r.reviewUrl).toContain(r.versionId);
    const row = db.select().from(versions).get();
    expect(row!.state).toBe("in_review");
    expect(row!.commitSha).toBe("abc123");
  });

  it("honors --draft", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>d</h1>"), draft: true, provenance: prov });
    expect(db.select().from(versions).get()!.state).toBe("draft");
  });

  it("is idempotent by content hash (no duplicate row for identical bytes)", async () => {
    const a = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov });
    const b = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov });
    expect(b.deduped).toBe(true);
    expect(b.versionId).toBe(a.versionId);
    expect(db.select().from(versions).all()).toHaveLength(1);
  });

  it("assigns increasing numbers for different content", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>1</h1>"), provenance: prov });
    const two = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>2</h1>"), provenance: prov });
    expect(two.number).toBe(2);
  });

  it("indexes extracted text into FTS", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>Refresh token TTL</h1>"), provenance: prov });
    const hit = db.$client
      .prepare("SELECT text FROM docs_fts WHERE text MATCH 'refresh'")
      .all() as { text: string }[];
    expect(hit.length).toBe(1);
  });
});
