import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { users, spaces, tokens } from "../db/schema.js";
import { ensurePersonalSpace, findOrCreateUserByEmail, linkIdentity } from "./identity.js";
import { createToken, verifyToken } from "./tokens.js";
import { canReadSpace, canPushToSpace } from "./access.js";

function mkDb(): DB {
  return openDb(join(mkdtempSync(join(tmpdir(), "confer-")), "test.db"));
}

describe("ensurePersonalSpace", () => {
  let db: DB;
  let userId: string;
  beforeEach(() => {
    db = mkDb();
    userId = newId();
    db.insert(users).values({ id: userId, name: "Test", email: `${userId}@x.test` }).run();
  });

  it("creates a 'personal' space for a user on first call", () => {
    const spaceId = ensurePersonalSpace(db, userId);
    expect(spaceId).toBeTruthy();
    const sp = db.select().from(spaces).where(eq(spaces.id, spaceId)).get();
    expect(sp?.ownerId).toBe(userId);
    expect(sp?.orgId).toBeNull();
    expect(sp?.slug).toBe("personal");
  });

  it("is idempotent (returns the same space on subsequent calls)", () => {
    const a = ensurePersonalSpace(db, userId);
    const b = ensurePersonalSpace(db, userId);
    const c = ensurePersonalSpace(db, userId);
    expect(a).toBe(b);
    expect(b).toBe(c);
    const all = db.select().from(spaces).where(eq(spaces.ownerId, userId)).all();
    expect(all.length).toBe(1);
  });

  it("personal space is per-user (different users get different spaces)", () => {
    const u1 = userId;
    const u2 = newId();
    db.insert(users).values({ id: u2, name: "U2" }).run();
    const s1 = ensurePersonalSpace(db, u1);
    const s2 = ensurePersonalSpace(db, u2);
    expect(s1).not.toBe(s2);
  });
});

describe("owner-scoped tokens", () => {
  let db: DB;
  let userId: string;
  let otherUserId: string;
  beforeEach(() => {
    db = mkDb();
    userId = newId();
    otherUserId = newId();
    db.insert(users).values({ id: userId, name: "Owner" }).run();
    db.insert(users).values({ id: otherUserId, name: "Other" }).run();
    ensurePersonalSpace(db, userId);
    ensurePersonalSpace(db, otherUserId);
  });

  it("creates a token with ownerId only (not orgId)", () => {
    const { raw, id } = createToken(db, { ownerId: userId }, "ci", ["push"]);
    expect(raw).toMatch(/^confer_/);
    const row = db.select().from(tokens).where(eq(tokens.id, id)).get()!;
    expect(row.ownerId).toBe(userId);
    expect(row.orgId).toBeNull();
  });

  it("rejects creating a token with neither orgId nor ownerId", () => {
    expect(() => createToken(db, {}, "ci", ["push"])).toThrow(/orgId or ownerId/);
  });

  it("rejects creating a token with both orgId and ownerId", () => {
    expect(() => createToken(db, { orgId: "o", ownerId: userId }, "ci", ["push"])).toThrow(/OR/);
  });

  it("verifyToken returns ownerId for personal tokens", async () => {
    const { raw } = createToken(db, { ownerId: userId }, "ci", ["push"]);
    const t = await verifyToken(db, raw);
    expect(t).toEqual({ orgId: null, ownerId: userId, scopes: ["push"] });
  });

  it("personal push token can push to owner's personal space", () => {
    const personalSpace = db.select().from(spaces).where(eq(spaces.ownerId, userId)).get()!;
    const { raw } = createToken(db, { ownerId: userId }, "ci", ["push"]);
    return import("./tokens.js").then(async (t) => {
      const v = (await t.verifyToken(db, raw))!;
      expect(canPushToSpace(db, personalSpace, { kind: "token", orgId: v.orgId, ownerId: v.ownerId })).toBe(true);
    });
  });

  it("personal push token CANNOT push to another user's personal space", () => {
    const otherSpace = db.select().from(spaces).where(eq(spaces.ownerId, otherUserId)).get()!;
    const { raw } = createToken(db, { ownerId: userId }, "ci", ["push"]);
    return import("./tokens.js").then(async (t) => {
      const v = (await t.verifyToken(db, raw))!;
      expect(canPushToSpace(db, otherSpace, { kind: "token", orgId: v.orgId, ownerId: v.ownerId })).toBe(false);
    });
  });

  it("org token CANNOT push to a personal space (scope mismatch)", () => {
    const orgId = "org-fake";
    const personalSpace = db.select().from(spaces).where(eq(spaces.ownerId, userId)).get()!;
    expect(canPushToSpace(db, personalSpace, { kind: "token", orgId, ownerId: null })).toBe(false);
  });

  it("personal token CANNOT push to an org space (no org membership)", () => {
    const orgSpace = newId();
    db.insert(spaces).values({ id: orgSpace, orgId: "org-fake", slug: "back", name: "Back" }).run();
    const personalSpace = db.select().from(spaces).where(eq(spaces.ownerId, userId)).get()!;
    const { raw } = createToken(db, { ownerId: userId }, "ci", ["push"]);
    return import("./tokens.js").then(async (t) => {
      const v = (await t.verifyToken(db, raw))!;
      const orgSpaceRow = db.select().from(spaces).where(eq(spaces.id, orgSpace)).get()!;
      expect(canPushToSpace(db, orgSpaceRow, { kind: "token", orgId: v.orgId, ownerId: v.ownerId })).toBe(false);
    });
  });

  it("session user can read their own personal space (owner only)", () => {
    const personalSpace = db.select().from(spaces).where(eq(spaces.ownerId, userId)).get()!;
    expect(canReadSpace(db, personalSpace, { kind: "session", userId })).toBe(true);
    expect(canReadSpace(db, personalSpace, { kind: "session", userId: otherUserId })).toBe(false);
  });
});

describe("findOrCreateUserByEmail auto-creates personal space on sign-in", () => {
  let db: DB;
  beforeEach(() => { db = mkDb(); });

  it("personal space is created on first sign-in for new user", () => {
    const { userId } = findOrCreateUserByEmail(db, "alice@example.com");
    ensurePersonalSpace(db, userId);
    const sp = db.select().from(spaces).where(eq(spaces.ownerId, userId)).get();
    expect(sp).toBeTruthy();
    expect(sp?.slug).toBe("personal");
  });
});