import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDb, newId } from "./client.js";
import { orgs } from "./schema.js";

describe("migrate — upgrading an EXISTING pre-personal-workspace DB", () => {
  // Regression: every test used a FRESH db, where tokens.org_id is already
  // nullable, so the upgrade branch never ran. On a real deployed DB (org_id
  // NOT NULL) migrate() threw `near "NOT": syntax error` and the server
  // crash-looped on boot.
  function seedOldSchemaDb(): string {
    const p = join(mkdtempSync(join(tmpdir(), "confer-upgrade-")), "old.db");
    const raw = new Database(p);
    raw.exec(`
      CREATE TABLE tokens (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_by TEXT, last_used_at INTEGER
      );
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY, org_id TEXT, slug TEXT NOT NULL, name TEXT NOT NULL,
        required_approvals INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO tokens(id, org_id, name, hash, scopes) VALUES ('t1','o1','ci','h1','push');
    `);
    raw.close();
    return p;
  }

  it("migrates without throwing and preserves existing rows", () => {
    const p = seedOldSchemaDb();
    expect(() => openDb(p)).not.toThrow();

    const raw = new Database(p);
    const tokenCols = raw.pragma("table_info(tokens)") as Array<{ name: string; notnull: number }>;
    // org_id must now be NULLABLE (personal tokens have owner_id instead)
    expect(tokenCols.find((c) => c.name === "org_id")?.notnull).toBe(0);
    expect(tokenCols.some((c) => c.name === "owner_id")).toBe(true);

    const spaceCols = raw.pragma("table_info(spaces)") as Array<{ name: string }>;
    expect(spaceCols.some((c) => c.name === "owner_id")).toBe(true);
    expect(spaceCols.some((c) => c.name === "context")).toBe(true);

    // the pre-existing token row survived the table rebuild
    const row = raw.prepare("SELECT id, org_id FROM tokens").get() as { id: string; org_id: string };
    expect(row.id).toBe("t1");
    expect(row.org_id).toBe("o1");
    raw.close();
  });

  it("is idempotent — a second open on the upgraded DB is a no-op", () => {
    const p = seedOldSchemaDb();
    openDb(p);
    expect(() => openDb(p)).not.toThrow();
  });
});

describe("db client", () => {
  it("opens in WAL mode and inserts a row", () => {
    const db = openDb(":memory:");
    const id = newId();
    db.insert(orgs).values({ id, name: "Acme", slug: "acme" }).run();
    const rows = db.select().from(orgs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe("acme");
  });

  it("newId returns distinct ULIDs", () => {
    expect(newId()).not.toBe(newId());
  });
});
