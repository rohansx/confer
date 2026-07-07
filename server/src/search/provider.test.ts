import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs, versions, users, spaceOwners, approvals } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createVersion } from "../versions/create.js";
import { approve } from "../review/approve.js";
import { Fts5Provider } from "./provider.js";

let db: DB;
let blobs: DiskBlobStore;
let provider: Fts5Provider;
let orgId: string;
let spaceId: string;
let docA: string, docB: string;
let ownerUserId: string;

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-search-")));
  db = openDb(":memory:");
  provider = new Fts5Provider(db, blobs);

  orgId = newId(); spaceId = newId();
  docA = newId(); docB = newId();
  ownerUserId = newId();

  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docA, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();
  db.insert(docs).values({ id: docB, spaceId, slug: "deploy", title: "Deployment" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();
});

async function push(docId: string, html: string, opts: { draft?: boolean; commitSha?: string; repo?: string } = {}) {
  const r = await createVersion(
    { db, blobs, appOrigin: "https://app" },
    {
      orgId, spaceId, docId,
      html: new TextEncoder().encode(html),
      draft: opts.draft,
      provenance: {
        authorType: "agent",
        authorName: "ci",
        sourceRepo: opts.repo,
        commitSha: opts.commitSha,
        branch: "main",
      },
    },
  );
  return r.versionId;
}

describe("Fts5Provider — search", () => {
  it("returns matching approved docs by default (the product invariant)", async () => {
    const a = await push(docA, "<h1>Authentication flow for our service</h1>");
    const b = await push(docB, "<h1>Deployment guide and runbook</h1>");
    // Approve auth-flow; leave deploy as in_review.
    approve(db, { versionId: a, userId: ownerUserId, now: 1000 });

    const hits = await provider.search({ query: "authentication", includeUnapproved: false });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.slug).toBe("auth-flow");
    expect(hits[0]?.state).toBe("approved");
    expect(hits[0]?.approved_by).toBe(ownerUserId);
    expect(hits[0]?.approved_at).toBe(1000);
    expect(hits[0]?.commit_sha).toBeNull(); // we didn't set one
    expect(hits[0]?.snippet).toContain("Authentication");
  });

  it("includeUnapproved=true with the provider flag returns all states", async () => {
    const a = await push(docA, "<p>alpha content</p>");
    const b = await push(docB, "<p>beta content</p>");
    approve(db, { versionId: a, userId: ownerUserId, now: 1 });

    const hits = await provider.search({ query: "content", includeUnapproved: true });
    expect(hits).toHaveLength(2);
  });

  it("includeUnapproved=false excludes the unapproved doc", async () => {
    const a = await push(docA, "<p>alpha content</p>");
    const b = await push(docB, "<p>beta content</p>");
    approve(db, { versionId: a, userId: ownerUserId, now: 1 });

    const hits = await provider.search({ query: "content", includeUnapproved: false });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.slug).toBe("auth-flow");
  });

  it("repo filter narrows to that repo", async () => {
    const a = await push(docA, "<p>matching</p>", { repo: "acme/api" });
    const b = await push(docB, "<p>matching</p>", { repo: "acme/web" });
    approve(db, { versionId: a, userId: ownerUserId, now: 1 });
    approve(db, { versionId: b, userId: ownerUserId, now: 1 });

    const hits = await provider.search({ query: "matching", includeUnapproved: false, repo: "acme/api" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.source_repo).toBe("acme/api");
  });

  it("space filter narrows to that space", async () => {
    // Create a second space (with the same owner).
    const space2 = newId();
    db.insert(spaces).values({ id: space2, orgId, slug: "frontend", name: "Frontend" }).run();
    db.insert(spaceOwners).values({ spaceId: space2, userId: ownerUserId }).run();
    const docC = newId();
    db.insert(docs).values({ id: docC, spaceId: space2, slug: "ux", title: "UX" }).run();
    const c = await push(docC, "<p>searchable</p>");
    approve(db, { versionId: c, userId: ownerUserId, now: 1 });

    const hits = await provider.search({ query: "searchable", includeUnapproved: false, space: "frontend" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.space).toBe("frontend");
  });

  it("an in_review-only doc does NOT appear in default search", async () => {
    await push(docA, "<p>beta</p>");
    // nothing approved
    const hits = await provider.search({ query: "beta", includeUnapproved: false });
    expect(hits).toEqual([]);
  });

  it("a superseded version's content is indexed but its state is superseded (not returned by default)", async () => {
    const v1 = await push(docA, "<p>old text</p>");
    approve(db, { versionId: v1, userId: ownerUserId, now: 1 });
    const v2 = await push(docA, "<p>new text</p>");
    approve(db, { versionId: v2, userId: ownerUserId, now: 2 });

    // Default: only the approved v2. "old" should not match because v1 is now superseded.
    const hits = await provider.search({ query: "old", includeUnapproved: false });
    expect(hits).toHaveLength(0);
    const hits2 = await provider.search({ query: "new", includeUnapproved: false });
    expect(hits2).toHaveLength(1);
    expect(hits2[0]?.version_number).toBe(2);
  });
});

describe("Fts5Provider — getDoc", () => {
  it("returns the latest approved version by default", async () => {
    const v1 = await push(docA, "<p>v1 content</p>");
    approve(db, { versionId: v1, userId: ownerUserId, now: 1 });
    const v2 = await push(docA, "<p>v2 content</p>");

    const got = await provider.getDoc({ space: "backend", slug: "auth-flow", includeUnapproved: false });
    expect(got).not.toBeNull();
    expect(got?.version_id).toBe(v1); // only v1 is approved
    expect(got?.state).toBe("approved");
    expect(got?.approved_by).toBe(ownerUserId);
    expect(got?.html).toContain("v1 content");
  });

  it("returns null when nothing is approved and includeUnapproved is false", async () => {
    await push(docA, "<p>draft</p>");
    const got = await provider.getDoc({ space: "backend", slug: "auth-flow", includeUnapproved: false });
    expect(got).toBeNull();
  });

  it("returns the in_review version when includeUnapproved is true", async () => {
    const v1 = await push(docA, "<p>wip</p>");
    const got = await provider.getDoc({ space: "backend", slug: "auth-flow", includeUnapproved: true });
    expect(got?.version_id).toBe(v1);
    expect(got?.state).toBe("in_review");
  });

  it("explicit version lookup respects the state filter", async () => {
    const v1 = await push(docA, "<p>v1</p>");
    approve(db, { versionId: v1, userId: ownerUserId, now: 1 });
    const v2 = await push(docA, "<p>v2</p>");
    // v2 is in_review, v1 is approved.
    // includeUnapproved: false → v2 should NOT be returned.
    const got1 = await provider.getDoc({ space: "backend", slug: "auth-flow", version: 2, includeUnapproved: false });
    expect(got1).toBeNull();
    const got2 = await provider.getDoc({ space: "backend", slug: "auth-flow", version: 2, includeUnapproved: true });
    expect(got2?.version_number).toBe(2);
  });

  it("returns null for missing slug", async () => {
    const got = await provider.getDoc({ space: "backend", slug: "nope", includeUnapproved: false });
    expect(got).toBeNull();
  });
});

describe("Fts5Provider — listDocs", () => {
  it("returns one row per doc, the latest approved by default", async () => {
    const a1 = await push(docA, "<p>auth v1</p>");
    approve(db, { versionId: a1, userId: ownerUserId, now: 1 });
    const a2 = await push(docA, "<p>auth v2</p>"); // not approved
    const b1 = await push(docB, "<p>deploy v1</p>");
    approve(db, { versionId: b1, userId: ownerUserId, now: 1 });

    const list = await provider.listDocs({ includeUnapproved: false });
    expect(list).toHaveLength(2);
    const authRow = list.find((l) => l.slug === "auth-flow")!;
    expect(authRow.state).toBe("approved");
    expect(authRow.version_number).toBe(1); // v1 is the only approved; v2 is in_review and excluded
  });

  it("space/repo filters narrow the list", async () => {
    const a = await push(docA, "<p>x</p>", { repo: "r1" });
    approve(db, { versionId: a, userId: ownerUserId, now: 1 });
    const b = await push(docB, "<p>x</p>", { repo: "r2" });
    approve(db, { versionId: b, userId: ownerUserId, now: 1 });

    const list = await provider.listDocs({ includeUnapproved: false, repo: "r1" });
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe("auth-flow");
  });

  it("includeUnapproved=true includes docs whose only version is in_review", async () => {
    await push(docA, "<p>x</p>");
    const list = await provider.listDocs({ includeUnapproved: true });
    expect(list).toHaveLength(1);
    expect(list[0]?.state).toBe("in_review");
  });
});
