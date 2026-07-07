import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskBlobStore } from "./disk.js";
import { hashBytes } from "./hash.js";

let store: DiskBlobStore;
beforeEach(() => {
  store = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-blob-")));
});

const bytes = (s: string) => new TextEncoder().encode(s);

describe("DiskBlobStore", () => {
  it("hashes deterministically", () => {
    expect(hashBytes(bytes("hello"))).toBe(hashBytes(bytes("hello")));
    expect(hashBytes(bytes("hello"))).not.toBe(hashBytes(bytes("world")));
  });

  it("put returns the content hash and get round-trips", async () => {
    const h = await store.put(bytes("<h1>doc</h1>"));
    expect(h).toBe(hashBytes(bytes("<h1>doc</h1>")));
    expect(new TextDecoder().decode(await store.get(h))).toBe("<h1>doc</h1>");
  });

  it("put is idempotent (same bytes, same hash, no error)", async () => {
    const a = await store.put(bytes("x"));
    const b = await store.put(bytes("x"));
    expect(a).toBe(b);
    expect(await store.has(a)).toBe(true);
  });
});
