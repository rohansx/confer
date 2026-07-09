import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq as eq0 } from "drizzle-orm";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, users, spaceOwners, orgMemberships, orgInvitations } from "../db/schema.js";
import {
  isOrgMember, isOrgAdmin, canReadSpace, canReviewSpace, canPushToSpace,
  acceptPendingInvites, userOrgIds,
} from "./access.js";

let db: DB;
let orgId: string;
let personalSpaceId: string;
let orgSpaceId: string;
let adminId: string;
let memberId: string;
let outsiderId: string;
let ownerOfPersonalId: string;

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "confer-access-")), "t.db"));
  orgId = newId();
  orgSpaceId = newId();
  personalSpaceId = newId();
  adminId = newId();
  memberId = newId();
  outsiderId = newId();
  ownerOfPersonalId = newId();

  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  db.insert(spaces).values({ id: orgSpaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(spaces).values({ id: personalSpaceId, ownerId: ownerOfPersonalId, slug: "my", name: "My" }).run();
  db.insert(users).values({ id: adminId, name: "Admin" }).run();
  db.insert(users).values({ id: memberId, name: "Member" }).run();
  db.insert(users).values({ id: outsiderId, name: "Outsider" }).run();
  db.insert(users).values({ id: ownerOfPersonalId, name: "Owner" }).run();
  db.insert(orgMemberships).values({ orgId, userId: adminId, role: "admin", createdAt: 0 }).run();
  db.insert(orgMemberships).values({ orgId, userId: memberId, role: "member", createdAt: 0 }).run();
});

const orgSpace = () => db.select().from(spaces).where(eq0(spaces.id, orgSpaceId)).get()!;
const personalSpace = () => db.select().from(spaces).where(eq0(spaces.id, personalSpaceId)).get()!;

describe("org membership", () => {
  it("admin and member are members; outsider is not", () => {
    expect(isOrgMember(db, orgId, adminId)).toBe(true);
    expect(isOrgMember(db, orgId, memberId)).toBe(true);
    expect(isOrgMember(db, orgId, outsiderId)).toBe(false);
    expect(isOrgAdmin(db, orgId, adminId)).toBe(true);
    expect(isOrgAdmin(db, orgId, memberId)).toBe(false);
  });

  it("userOrgIds lists the user's orgs", () => {
    expect([...userOrgIds(db, adminId)]).toEqual([orgId]);
    expect([...userOrgIds(db, outsiderId)]).toEqual([]);
  });
});

describe("canReadSpace", () => {
  it("token must match the space's org", () => {
    expect(canReadSpace(db, orgSpace(), { kind: "token", orgId, ownerId: null})).toBe(true);
    expect(canReadSpace(db, orgSpace(), { kind: "token", orgId: "other", ownerId: null })).toBe(false);
  });

  it("members and admins can read org spaces; outsider cannot", () => {
    expect(canReadSpace(db, orgSpace(), { kind: "session", userId: adminId })).toBe(true);
    expect(canReadSpace(db, orgSpace(), { kind: "session", userId: memberId })).toBe(true);
    expect(canReadSpace(db, orgSpace(), { kind: "session", userId: outsiderId })).toBe(false);
  });

  it("space_owner (legacy grant) can read even without org membership", () => {
    db.insert(spaceOwners).values({ spaceId: orgSpaceId, userId: outsiderId }).run();
    expect(canReadSpace(db, orgSpace(), { kind: "session", userId: outsiderId })).toBe(true);
  });

  it("personal space: only the owner can read", () => {
    expect(canReadSpace(db, personalSpace(), { kind: "session", userId: ownerOfPersonalId })).toBe(true);
    expect(canReadSpace(db, personalSpace(), { kind: "session", userId: memberId })).toBe(false);
  });
});

describe("canReviewSpace (approve/reject)", () => {
  it("admin can review; member cannot; space_owner can (legacy)", () => {
    expect(canReviewSpace(db, orgSpace(), adminId)).toBe(true);
    expect(canReviewSpace(db, orgSpace(), memberId)).toBe(false);
    db.insert(spaceOwners).values({ spaceId: orgSpaceId, userId: memberId }).run();
    expect(canReviewSpace(db, orgSpace(), memberId)).toBe(true);
  });

  it("personal space: only the owner can review", () => {
    expect(canReviewSpace(db, personalSpace(), ownerOfPersonalId)).toBe(true);
    expect(canReviewSpace(db, personalSpace(), memberId)).toBe(false);
  });
});

describe("canPushToSpace", () => {
  it("members/admins can push to org spaces; outsider cannot", () => {
    expect(canPushToSpace(db, orgSpace(), { kind: "session", userId: adminId })).toBe(true);
    expect(canPushToSpace(db, orgSpace(), { kind: "session", userId: memberId })).toBe(true);
    expect(canPushToSpace(db, orgSpace(), { kind: "session", userId: outsiderId })).toBe(false);
  });

  it("token push requires matching org", () => {
    expect(canPushToSpace(db, orgSpace(), { kind: "token", orgId, ownerId: null})).toBe(true);
    expect(canPushToSpace(db, orgSpace(), { kind: "token", orgId: "other", ownerId: null })).toBe(false);
  });
});

describe("acceptPendingInvites", () => {
  it("auto-joins an org when a user with the invited email signs in", () => {
    db.insert(orgInvitations).values({ orgId, email: "new@acme.test", invitedBy: adminId, createdAt: 0, acceptedAt: null }).run();
    const newUserId = newId();
    db.insert(users).values({ id: newUserId, name: "New", email: "new@acme.test" }).run();
    const joined = acceptPendingInvites(db, newUserId, "new@acme.test");
    expect(joined).toEqual([orgId]);
    expect(isOrgMember(db, orgId, newUserId)).toBe(true);
    // The invite is now marked accepted (not re-joinable).
    expect(acceptPendingInvites(db, newUserId, "new@acme.test")).toEqual([]);
  });
});