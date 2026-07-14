import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDb, newId } from "./client.js";
import { orgs, users } from "./schema.js";

describe("migrate — personal-space invariant", () => {
  // Regression: ensurePersonalSpace only runs at LOGIN. A user with a live
  // session (or one created before the feature) never re-hits /auth/login, so
  // they had ZERO spaces and the Upload page showed "— no spaces yet —".
  it("backfills a personal space for a user that has none, idempotently", () => {
    const p = join(mkdtempSync(join(tmpdir(), "confer-backfill-")), "t.db");
    const db = openDb(p);
    db.insert(users).values({ id: "u1", name: "Rohan" }).run();

    const count = () => {
      const raw = new Database(p);
      const n = (raw.prepare("SELECT count(*) AS n FROM spaces WHERE owner_id = 'u1'").get() as { n: number }).n;
      raw.close();
      return n;
    };
    expect(count()).toBe(0); // user exists with no personal space

    openDb(p); // reboot → migrate() backfills
    expect(count()).toBe(1);

    const raw = new Database(p);
    const row = raw.prepare("SELECT slug, org_id FROM spaces WHERE owner_id = 'u1'").get() as { slug: string; org_id: string | null };
    raw.close();
    expect(row.slug).toBe("personal");
    expect(row.org_id).toBeNull();

    openDb(p); // reboot again → no duplicate
    expect(count()).toBe(1);
  });
});

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
