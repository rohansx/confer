import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, newId, type DB } from "../db/client.js";
import { users, spaces } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createToken } from "../auth/tokens.js";
import { buildApp } from "../app.js";

let db: DB;
let app: ReturnType<typeof buildApp>;
const SECRET = "s";

const req = (path: string, init: RequestInit & { authCookie?: string; bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.authCookie) headers.set("Cookie", `confer_session=${init.authCookie}`);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  return app.request(path, { ...init, headers });
};

beforeEach(() => {
  db = openDb(":memory:");
  app = buildApp({
    db,
    blobs: new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-spaces-b-"))),
    appOrigin: "https://app",
    viewOrigin: "https://view",
    signingSecret: SECRET,
  });
});

describe("GET /api/v1/spaces — personal-space invariant", () => {
  it("self-heals: a signed-in user with NO personal space still gets one back", async () => {
    // A user whose session predates the feature: exists, never re-hit /auth/login.
    const userId = newId();
    db.insert(users).values({ id: userId, name: "Rohan" }).run();
    expect(db.select().from(spaces).where(eq(spaces.ownerId, userId)).all()).toHaveLength(0);

    const session = createSessionCookie(SECRET, userId, 600).value;
    const res = await req("/api/v1/spaces", { authCookie: session });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { spaces: Array<{ slug: string; ownerId: string | null }> } };

    // must NOT be empty — this is what produced "— no spaces yet —" on the Upload page
    expect(body.data.spaces.length).toBeGreaterThan(0);
    const personal = body.data.spaces.find((s) => s.slug === "personal");
    expect(personal).toBeDefined();
    expect(personal!.ownerId).toBe(userId);

    // and it was actually persisted, not just synthesized in the response
    expect(db.select().from(spaces).where(eq(spaces.ownerId, userId)).all()).toHaveLength(1);
  });

  it("is idempotent — a second call does not create a duplicate", async () => {
    const userId = newId();
    db.insert(users).values({ id: userId, name: "Rohan" }).run();
    const session = createSessionCookie(SECRET, userId, 600).value;

    await req("/api/v1/spaces", { authCookie: session });
    await req("/api/v1/spaces", { authCookie: session });

    expect(db.select().from(spaces).where(eq(spaces.ownerId, userId)).all()).toHaveLength(1);
  });

  it("a personal (owner-scoped) token sees the owner's personal space", async () => {
    const userId = newId();
    db.insert(users).values({ id: userId, name: "Rohan" }).run();
    // heal it via the session path first
    await req("/api/v1/spaces", { authCookie: createSessionCookie(SECRET, userId, 600).value });

    const tok = createToken(db, { ownerId: userId }, "agent", ["read"]).raw;
    const res = await req("/api/v1/spaces", { bearer: tok });
    const body = (await res.json()) as { data: { spaces: Array<{ slug: string }> } };
    expect(body.data.spaces.map((s) => s.slug)).toContain("personal");
  });
});
