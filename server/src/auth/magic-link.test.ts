import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DB } from "../db/client.js";
import { createMagicLink, consumeMagicLink } from "./magic-link.js";

let db: DB;

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "confer-ml-")), "test.db"));
});

describe("magic links", () => {
  it("creates a link and consumes it once for the right email", () => {
    const raw = createMagicLink(db, "Alice@Acme.test");
    const res = consumeMagicLink(db, raw);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.email).toBe("alice@acme.test");
  });

  it("a token can only be consumed once", () => {
    const raw = createMagicLink(db, "bob@acme.test");
    expect(consumeMagicLink(db, raw).ok).toBe(true);
    expect(consumeMagicLink(db, raw).ok).toBe(false);
  });

  it("rejects a bogus token", () => {
    expect(consumeMagicLink(db, "confer_ml_bogus").ok).toBe(false);
  });

  it("rejects an expired link", () => {
    const raw = createMagicLink(db, "carol@acme.test");
    (db.$client as any).exec("UPDATE magic_links SET expires_at = 0");
    const res = consumeMagicLink(db, raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("expired");
  });
});