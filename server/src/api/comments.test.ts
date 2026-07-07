import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import {
  orgs, spaces, docs, users, spaceOwners,
} from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createVersion } from "../versions/create.js";
import { buildApp } from "../app.js";
import { resetForTests, queue } from "../notify/index.js";

let db: DB;
let blobs: DiskBlobStore;
let app: ReturnType<typeof buildApp>;
let orgId: string;
let spaceId: string;
let docId: string;
let ownerUserId: string;
let strangerUserId: string;
let ownerSession: string;
let pushTok: string;
let readTok: string;

const APP = "https://app";
const VIEW = "https://view";

async function push(html: string) {
  const r = await createVersion(
    { db, blobs, appOrigin: APP },
    { orgId, spaceId, docId, html: new TextEncoder().encode(html), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
  );
  return r.versionId;
}

beforeEach(async () => {
  resetForTests();
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-comments-")));
  db = openDb(":memory:");
  app = buildApp({ db, blobs, appOrigin: APP, viewOrigin: VIEW, signingSecret: "s" });

  orgId = newId(); spaceId = newId(); docId = newId();
  ownerUserId = newId(); strangerUserId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(users).values({ id: strangerUserId, name: "Stranger" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();

  ownerSession = createSessionCookie("s", ownerUserId, 600).value;
  pushTok = createToken(db, orgId, "ci", ["push"]).raw;
  readTok = createToken(db, orgId, "ro", ["read"]).raw;
});

const req = (path: string, init: RequestInit & { authCookie?: string; bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

describe("POST /api/v1/spaces/:space/docs/:slug/comments", () => {
  it("owner session can create a comment with an anchor", async () => {
    const v1 = await push("<p>the quick brown fox</p>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST",
      authCookie: ownerSession,
      body: JSON.stringify({
        body: "needs more detail",
        version_id: v1,
        anchor: { quote: "brown fox", prefix: "quick ", suffix: "" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.id).toBeTruthy();

    // The notification fired.
    const last = queue.emitted[queue.emitted.length - 1];
    expect(last?.kind).toBe("comment.created");
  });

  it("token (push) cannot create a comment — 403", async () => {
    const v1 = await push("<p>test</p>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", bearer: pushTok,
      body: JSON.stringify({ body: "no", version_id: v1 }),
    });
    expect(res.status).toBe(403);
  });

  it("missing body - 400", async () => {
    const v1 = await push("<p>test</p>");
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ version_id: v1 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/spaces/:space/docs/:slug/comments", () => {
  it("returns comments with re-resolved anchors", async () => {
    const v1 = await push("<p>the quick brown fox</p>");
    // Create a comment anchored to "brown fox".
    const post = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({
        body: "fixme",
        version_id: v1,
        anchor: { quote: "brown fox", prefix: "quick ", suffix: "" },
      }),
    });
    const cid = (await post.json() as any).data.id;
    const list = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, { authCookie: ownerSession });
    const body = await list.json() as any;
    expect(body.data.comments).toHaveLength(1);
    expect(body.data.comments[0].id).toBe(cid);
    expect(body.data.comments[0].anchor_resolved.lost).toBe(false);
  });

  it("anchor carries across versions: lost when the quote is gone in a later version", async () => {
    const v1 = await push("<p>the quick brown fox</p>");
    await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({
        body: "old comment",
        version_id: v1,
        anchor: { quote: "brown fox", prefix: "quick ", suffix: "" },
      }),
    });
    await push("<p>totally different content here</p>");
    const list = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, { authCookie: ownerSession });
    const body = await list.json() as any;
    expect(body.data.comments[0].anchor_resolved.lost).toBe(true);
    expect(body.data.comments[0].is_carried_over).toBe(true);
  });

  it("read token can list comments", async () => {
    const v1 = await push("<p>test</p>");
    await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "x", version_id: v1 }),
    });
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, { bearer: readTok });
    expect(res.status).toBe(200);
  });

  it("push token cannot list comments - 403", async () => {
    const res = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, { bearer: pushTok });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/comments/:id/resolve", () => {
  it("space owner can resolve a comment", async () => {
    const v1 = await push("<p>test</p>");
    const post = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "x", version_id: v1 }),
    });
    const cid = (await post.json() as any).data.id;
    const res = await req(`/api/v1/comments/${cid}/resolve`, { method: "POST", authCookie: ownerSession });
    expect(res.status).toBe(200);
    // By default the list excludes resolved.
    const list = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, { authCookie: ownerSession });
    expect((await list.json() as any).data.comments).toHaveLength(0);
    // include_resolved=true brings it back.
    const listAll = await req(`/api/v1/spaces/backend/docs/auth-flow/comments?include_resolved=true`, { authCookie: ownerSession });
    expect((await listAll.json() as any).data.comments).toHaveLength(1);
  });

  it("non-owner session cannot resolve - 403", async () => {
    const v1 = await push("<p>test</p>");
    const post = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "x", version_id: v1 }),
    });
    const cid = (await post.json() as any).data.id;
    const otherSession = createSessionCookie("s", strangerUserId, 600).value;
    const res = await req(`/api/v1/comments/${cid}/resolve`, { method: "POST", authCookie: otherSession });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/comments/:id/replies", () => {
  it("replying to a root creates a child comment with the right parent_id", async () => {
    const v1 = await push("<p>test</p>");
    const post = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "root", version_id: v1 }),
    });
    const cid = (await post.json() as any).data.id;
    const reply = await req(`/api/v1/comments/${cid}/replies`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "reply" }),
    });
    expect(reply.status).toBe(201);
    const list = await req(`/api/v1/spaces/backend/docs/auth-flow/comments?include_resolved=true`, { authCookie: ownerSession });
    const body = (await list.json() as any).data;
    expect(body.comments).toHaveLength(2);
    const reply2 = body.comments.find((c: any) => c.parent_id === cid);
    expect(reply2).toBeTruthy();
  });

  it("replying to a reply is rejected - 400", async () => {
    const v1 = await push("<p>test</p>");
    const post = await req(`/api/v1/spaces/backend/docs/auth-flow/comments`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "root", version_id: v1 }),
    });
    const cid = (await post.json() as any).data.id;
    const reply = await req(`/api/v1/comments/${cid}/replies`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "reply" }),
    });
    const rid = (await reply.json() as any).data.id;
    const reply2 = await req(`/api/v1/comments/${rid}/replies`, {
      method: "POST", authCookie: ownerSession,
      body: JSON.stringify({ body: "no" }),
    });
    expect(reply2.status).toBe(400);
  });
});
