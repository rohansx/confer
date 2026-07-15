import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, users, orgMemberships, spaces } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createToken } from "../auth/tokens.js";
import { buildApp } from "../app.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
let adminSession: string, outsiderSession: string;
let orgId: string, otherOrgId: string;
let readTok: string, otherOrgTok: string;
const SECRET = "s";

const req = (path: string, init: RequestInit & { authCookie?: string; bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.request(path, { ...init, headers });
};

/** Publish a version to backend/:slug via the admin session; returns its id. */
async function publish(slug: string, body: Record<string, unknown>): Promise<string> {
  const res = await req(`/api/v1/spaces/backend/docs/${slug}/versions`, {
    method: "POST",
    authCookie: adminSession,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).data.version_id;
}

beforeEach(() => {
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-sess-b-")));
  db = openDb(":memory:");
  app = buildApp({ db, blobs, appOrigin: "https://app", viewOrigin: "https://view", signingSecret: SECRET });

  const adminId = newId(), outsiderId = newId();
  orgId = newId(); otherOrgId = newId();
  db.insert(users).values({ id: adminId, name: "Admin", email: "a@x.test" }).run();
  db.insert(users).values({ id: outsiderId, name: "Out", email: "o@x.test" }).run();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme", createdById: adminId }).run();
  db.insert(orgs).values({ id: otherOrgId, name: "Globex", slug: "globex", createdById: outsiderId }).run();
  db.insert(orgMemberships).values({ orgId, userId: adminId, role: "admin", createdAt: 0 }).run();
  db.insert(spaces).values({ id: newId(), orgId, slug: "backend", name: "Backend" }).run();
  adminSession = createSessionCookie(SECRET, adminId, 600).value;
  outsiderSession = createSessionCookie(SECRET, outsiderId, 600).value;
  readTok = createToken(db, { orgId }, "read", ["read"]).raw;
  otherOrgTok = createToken(db, { orgId: otherOrgId }, "read", ["read"]).raw;
});

describe("version session provenance", () => {
  const TRANSCRIPT = "user: build a login page\nassistant: sure, here it is\n";

  it("an authorized reader gets the raw transcript back", async () => {
    const id = await publish("login", { html: "<h1>hi</h1>", session: TRANSCRIPT });

    const cookieRes = await req(`/api/v1/versions/${id}/session`, { authCookie: adminSession });
    expect(cookieRes.status).toBe(200);
    expect(cookieRes.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(cookieRes.headers.get("cache-control")).toBe("no-store");
    expect(await cookieRes.text()).toBe(TRANSCRIPT);

    // Same authz path also works for an org read token.
    const tokRes = await req(`/api/v1/versions/${id}/session`, { bearer: readTok });
    expect(tokRes.status).toBe(200);
    expect(await tokRes.text()).toBe(TRANSCRIPT);
  });

  it("an outsider (other org session or token) gets 404", async () => {
    const id = await publish("login", { html: "<h1>hi</h1>", session: TRANSCRIPT });
    expect((await req(`/api/v1/versions/${id}/session`, { authCookie: outsiderSession })).status).toBe(404);
    expect((await req(`/api/v1/versions/${id}/session`, { bearer: otherOrgTok })).status).toBe(404);
  });

  it("a version with no session gets 404", async () => {
    const id = await publish("plain", { html: "<h1>no session</h1>" });
    expect((await req(`/api/v1/versions/${id}/session`, { authCookie: adminSession })).status).toBe(404);
  });

  it("GET /versions/:id reports has_session correctly", async () => {
    const withSession = await publish("a", { html: "<p>a</p>", session: TRANSCRIPT });
    const without = await publish("b", { html: "<p>b</p>" });

    const w = (await (await req(`/api/v1/versions/${withSession}`, { authCookie: adminSession })).json()) as any;
    expect(w.data.has_session).toBe(true);
    const n = (await (await req(`/api/v1/versions/${without}`, { authCookie: adminSession })).json()) as any;
    expect(n.data.has_session).toBe(false);
  });

  it("a session transcript over 2 MB is rejected with 413", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    const res = await req(`/api/v1/spaces/backend/docs/big/versions`, {
      method: "POST",
      authCookie: adminSession,
      body: JSON.stringify({ html: "<p>hi</p>", session: big }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error).toBe("session exceeds 2 MB");
  });
});
