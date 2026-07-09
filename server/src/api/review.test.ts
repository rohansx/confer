import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import {
  orgs, spaces, docs, versions, users, spaceOwners, orgMemberships,
} from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { createSessionCookie, buildSetCookie } from "../auth/sessions.js";
import { buildApp } from "../app.js";
import { createVersion } from "../versions/create.js";

let db: DB;
let blobs: DiskBlobStore;
let app: ReturnType<typeof buildApp>;
let orgId: string;
let spaceId: string;
let docId: string;
let ownerUserId: string;
let strangerUserId: string;
let ownerSession: string;
let strangerSession: string;
let pushTok: string;
let readTok: string;

const SECRET = "test-secret";
const APP = "https://app";
const VIEW = "https://view";

async function pushInReview(html: string): Promise<string> {
  const r = await createVersion(
    { db, blobs, appOrigin: APP },
    { orgId, spaceId, docId, html: new TextEncoder().encode(html), draft: false, provenance: { authorType: "agent", authorName: "ci" } },
  );
  return r.versionId;
}

beforeEach(async () => {
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-review-")));
  db = openDb(":memory:");
  app = buildApp({ db, blobs, appOrigin: APP, viewOrigin: VIEW, signingSecret: SECRET });

  orgId = newId(); spaceId = newId(); docId = newId();
  ownerUserId = newId(); strangerUserId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  db.insert(users).values({ id: ownerUserId, name: "Owner" }).run();
  db.insert(users).values({ id: strangerUserId, name: "Stranger" }).run();
  db.insert(spaceOwners).values({ spaceId, userId: ownerUserId }).run();
  // Stranger is an org member (can read) but NOT an admin (cannot approve/reject).
  db.insert(orgMemberships).values({ orgId, userId: strangerUserId, role: "member", createdAt: 0 }).run();
  ownerSession = createSessionCookie(SECRET, ownerUserId, 600).value;
  strangerSession = createSessionCookie(SECRET, strangerUserId, 600).value;
  pushTok = createToken(db, { orgId }, "ci", ["push"]).raw;
  readTok = createToken(db, { orgId }, "ro", ["read"]).raw;
});

const req = (path: string, init: RequestInit & { authCookie?: string; bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

describe("POST /api/v1/versions/:id/approve", () => {
  it("session owner can approve an in_review version", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.state).toBe("approved");
    expect(body.data.supersededId).toBeNull();
  });

  it("non-owner gets 403", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", authCookie: strangerSession,
    });
    expect(res.status).toBe(403);
  });

  it("token (push scope) cannot approve - 403", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", bearer: pushTok,
    });
    expect(res.status).toBe(403);
  });

  it("token (read scope) cannot approve - 403", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", bearer: readTok,
    });
    expect(res.status).toBe(403);
  });

  it("no auth - 401", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("approving twice is 409 (state machine)", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const ok = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    expect(ok.status).toBe(200);
    const again = await req(`/api/v1/versions/${vid}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    expect(again.status).toBe(409);
  });

  it("approving v2 supersedes v1 in the same call", async () => {
    const v1 = await pushInReview("<p>v1</p>");
    await req(`/api/v1/versions/${v1}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const v2 = await pushInReview("<p>v2</p>");
    const res = await req(`/api/v1/versions/${v2}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const body = await res.json() as any;
    expect(body.data.supersededId).toBe(v1);
  });
});

describe("POST /api/v1/versions/:id/reject", () => {
  it("session owner can reject with a reason", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/reject`, {
      method: "POST", body: JSON.stringify({ reason: "needs more detail" }), authCookie: ownerSession,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.state).toBe("rejected");
  });

  it("missing reason - 400", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/reject`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    expect(res.status).toBe(400);
  });

  it("non-owner - 403", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/reject`, {
      method: "POST", body: JSON.stringify({ reason: "no" }), authCookie: strangerSession,
    });
    expect(res.status).toBe(403);
  });

  it("token cannot reject - 403", async () => {
    const vid = await pushInReview("<p>v1</p>");
    const res = await req(`/api/v1/versions/${vid}/reject`, {
      method: "POST", body: JSON.stringify({ reason: "no" }), bearer: pushTok,
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/spaces/:space/docs/:slug/versions (history)", () => {
  it("session can read history; is_owner reflects ownership", async () => {
    const v1 = await pushInReview("<p>v1</p>");
    await req(`/api/v1/versions/${v1}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const v2 = await pushInReview("<p>v2</p>");
    await req(`/api/v1/versions/${v2}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const v3 = await pushInReview("<p>v3</p>");

    const ownerRes = await req("/api/v1/spaces/backend/docs/auth-flow/versions", {
      authCookie: ownerSession,
    });
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json() as any;
    expect(ownerBody.data.versions).toHaveLength(3);
    expect(ownerBody.data.is_owner).toBe(true);
    // Newest first
    expect(ownerBody.data.versions[0].id).toBe(v3);
    expect(ownerBody.data.versions[0].state).toBe("in_review");
    expect(ownerBody.data.versions[1].id).toBe(v2);
    expect(ownerBody.data.versions[1].state).toBe("approved");
    expect(ownerBody.data.versions[2].id).toBe(v1);
    expect(ownerBody.data.versions[2].state).toBe("superseded");

    const strangerRes = await req("/api/v1/spaces/backend/docs/auth-flow/versions", {
      authCookie: strangerSession,
    });
    const strangerBody = await strangerRes.json() as any;
    expect(strangerBody.data.is_owner).toBe(false);
  });

  it("read token can read history", async () => {
    await pushInReview("<p>v1</p>");
    const res = await req("/api/v1/spaces/backend/docs/auth-flow/versions", {
      bearer: readTok,
    });
    expect(res.status).toBe(200);
  });

  it("push token cannot read history - 403", async () => {
    const res = await req("/api/v1/spaces/backend/docs/auth-flow/versions", {
      bearer: pushTok,
    });
    expect(res.status).toBe(403);
  });

  it("history includes approved_by/approved_at on the approved row, and the superseded row retains it too", async () => {
    const v1 = await pushInReview("<p>v1</p>");
    await req(`/api/v1/versions/${v1}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const v2 = await pushInReview("<p>v2</p>");
    await req(`/api/v1/versions/${v2}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const res = await req("/api/v1/spaces/backend/docs/auth-flow/versions", {
      authCookie: ownerSession,
    });
    const body = await res.json() as any;
    const approved = body.data.versions.find((v: any) => v.state === "approved");
    const superseded = body.data.versions.find((v: any) => v.state === "superseded");
    expect(approved).toBeTruthy();
    expect(approved.approvedBy).toBe(ownerUserId);
    expect(approved.approvedAt).toBeGreaterThan(0);
    // The superseded row keeps its approval metadata (it was approved first).
    expect(superseded.approvedBy).toBe(ownerUserId);
    expect(superseded.approvedAt).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/spaces/:space/docs/:slug (latest approved)", () => {
  it("returns null latest_approved when nothing approved", async () => {
    await pushInReview("<p>v1</p>");
    const res = await req("/api/v1/spaces/backend/docs/auth-flow", { authCookie: ownerSession });
    const body = await res.json() as any;
    expect(body.data.latest_approved).toBeNull();
  });

  it("returns the latest approved version metadata", async () => {
    const v1 = await pushInReview("<p>v1</p>");
    await req(`/api/v1/versions/${v1}/approve`, {
      method: "POST", body: "{}", authCookie: ownerSession,
    });
    const res = await req("/api/v1/spaces/backend/docs/auth-flow", { authCookie: ownerSession });
    const body = await res.json() as any;
    expect(body.data.latest_approved.id).toBe(v1);
    expect(body.data.latest_approved.state).toBe("approved");
  });
});

describe("POST /api/v1/auth/login (dev)", () => {
  it("issues a Set-Cookie session for a known user_id (or auto-creates)", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: ownerUserId, name: "Owner" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("confer_session=");
    const body = await res.json() as any;
    expect(body.data.user.id).toBe(ownerUserId);
  });

  it("whoami returns the session user", async () => {
    const res = await req("/api/v1/auth/whoami", { authCookie: ownerSession });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.id).toBe(ownerUserId);
  });

  it("whoami with no session - 401", async () => {
    const res = await req("/api/v1/auth/whoami");
    expect(res.status).toBe(401);
  });
});
