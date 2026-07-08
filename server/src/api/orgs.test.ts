import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, users, orgInvitations, orgMemberships } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createSessionCookie, buildSetCookie } from "../auth/sessions.js";
import { buildApp } from "../app.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
let adminSession: string;
let adminId: string;
let otherSession: string;
let otherId: string;
let orgId: string;
const SECRET = "s";

const req = (path: string, init: RequestInit & { authCookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "confer-orgs-")), "t.db"));
  app = buildApp({ db, blobs: new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-orgs-b-"))), appOrigin: "https://app", viewOrigin: "https://view", signingSecret: SECRET });
  adminId = newId();
  otherId = newId();
  orgId = newId();
  db.insert(users).values({ id: adminId, name: "Admin", email: "admin@acme.test" }).run();
  db.insert(users).values({ id: otherId, name: "Other", email: "other@acme.test" }).run();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme", createdById: adminId }).run();
  db.insert(orgMemberships).values({ orgId, userId: adminId, role: "admin", createdAt: 0 }).run();
  adminSession = createSessionCookie(SECRET, adminId, 600).value;
  otherSession = createSessionCookie(SECRET, otherId, 600).value;
});

describe("POST /api/v1/orgs", () => {
  it("creates an org and makes the creator an admin", async () => {
    const res = await req("/api/v1/orgs", { method: "POST", authCookie: otherSession, body: JSON.stringify({ name: "Globex" }) });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.role).toBe("admin");
    expect(body.data.slug).toBe("globex");
  });

  it("requires a session (401)", async () => {
    expect((await req("/api/v1/orgs", { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("GET /api/v1/orgs", () => {
  it("lists the user's orgs with role", async () => {
    const res = await req("/api/v1/orgs", { authCookie: adminSession });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.orgs).toHaveLength(1);
    expect(body.data.orgs[0].role).toBe("admin");
  });

  it("outsider sees no orgs", async () => {
    const res = await req("/api/v1/orgs", { authCookie: otherSession });
    expect((await res.json() as any).data.orgs).toHaveLength(0);
  });
});

describe("POST /api/v1/orgs/:orgId/members (invite)", () => {
  it("admin can invite by email; a pending invite is recorded", async () => {
    const res = await req(`/api/v1/orgs/${orgId}/members`, {
      method: "POST", authCookie: adminSession,
      body: JSON.stringify({ email: "newbie@acme.test" }),
    });
    expect(res.status).toBe(201);
    const pending = db.select().from(orgInvitations).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.email).toBe("newbie@acme.test");
  });

  it("non-admin cannot invite (403)", async () => {
    // Make 'other' a member first.
    db.insert(orgMemberships).values({ orgId, userId: otherId, role: "member", createdAt: 0 }).run();
    const res = await req(`/api/v1/orgs/${orgId}/members`, {
      method: "POST", authCookie: otherSession,
      body: JSON.stringify({ email: "x@acme.test" }),
    });
    expect(res.status).toBe(403);
  });

  it("inviting an existing user adds them as a member directly", async () => {
    const res = await req(`/api/v1/orgs/${orgId}/members`, {
      method: "POST", authCookie: adminSession,
      body: JSON.stringify({ email: "OTHER@acme.test" }),
    });
    expect(res.status).toBe(201);
    expect(isOrgMemberRow(orgId, otherId)).toBe(true);
  });
});

describe("DELETE /api/v1/orgs/:orgId/members/:userId", () => {
  it("admin can remove a member", async () => {
    db.insert(orgMemberships).values({ orgId, userId: otherId, role: "member", createdAt: 0 }).run();
    const res = await req(`/api/v1/orgs/${orgId}/members/${otherId}`, { method: "DELETE", authCookie: adminSession });
    expect(res.status).toBe(200);
    expect(isOrgMemberRow(orgId, otherId)).toBe(false);
  });

  it("cannot remove the last admin", async () => {
    const res = await req(`/api/v1/orgs/${orgId}/members/${adminId}`, { method: "DELETE", authCookie: adminSession });
    expect(res.status).toBe(400);
  });
});

function isOrgMemberRow(orgId: string, userId: string): boolean {
  const row = db.select().from(orgMemberships).all().find((m) => m.orgId === orgId && m.userId === userId);
  return !!row;
}