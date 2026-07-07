import { describe, it, expect, beforeEach } from "vitest";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, tokens } from "../db/schema.js";
import { createToken, verifyToken, hasScope } from "./tokens.js";

let db: DB;
let orgId: string;

beforeEach(() => {
  db = openDb(":memory:");
  orgId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
});

describe("tokens", () => {
  it("verifies a freshly created token and returns its scopes", async () => {
    const { raw } = createToken(db, orgId, "ci", ["push"]);
    expect(await verifyToken(db, raw)).toEqual({ orgId, scopes: ["push"] });
  });

  it("rejects an unknown token", async () => {
    expect(await verifyToken(db, "confer_bogus")).toBeNull();
  });

  it("stores only a hash, never the plaintext", () => {
    const { raw } = createToken(db, orgId, "ci", ["push"]);
    const stored = db.select({ hash: tokens.hash }).from(tokens).all();
    expect(stored[0]!.hash).not.toBe(raw);
    expect(stored[0]!.hash).toHaveLength(64); // sha256 hex
  });

  it("updates lastUsedAt on verify", async () => {
    const { raw } = createToken(db, orgId, "ci", ["read"]);
    await verifyToken(db, raw);
    const row = db.select({ last: tokens.lastUsedAt }).from(tokens).all()[0]!;
    expect(row.last!).toBeGreaterThan(0);
  });

  it("hasScope checks membership", () => {
    expect(hasScope(["push", "mcp"], "mcp")).toBe(true);
    expect(hasScope(["push"], "mcp")).toBe(false);
  });
});
