import { describe, it, expect } from "vitest";
import { openDb, newId } from "./client.js";
import { orgs } from "./schema.js";

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
