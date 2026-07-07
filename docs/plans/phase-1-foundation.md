# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and the server-side of `confer push` — an authenticated `push`-scoped token creates an immutable, content-addressed, deduped version row with provenance, returning a review URL, and the text is indexed for search.

**Architecture:** npm-workspace monorepo. A Hono/Node server with a content-addressed blob store (blake3 on disk), Drizzle + SQLite (WAL), token auth, and a single publish endpoint. Pure logic (hashing, dedupe, token verify) is unit-tested; the endpoint is integration-tested.

**Tech Stack:** TypeScript · Hono + `@hono/node-server` · Drizzle + `better-sqlite3` (WAL) · `@noble/hashes/blake3` · `zod` · `ulidx` · `vitest`.

## Global Constraints

Inherit everything in [../implementation-plan.md](../implementation-plan.md#global-constraints). Most relevant here:
- blake3 hash → `blobs/ab/cd/<hash>`; writes idempotent, content immutable.
- Single-file HTML, **5 MB cap** per version.
- Token scopes `push`/`read`/`mcp`; tokens hashed at rest; no scope can approve.
- Postgres-compatible schema; `id`s are application-generated ULIDs.
- Many small files (200–400 lines); TDD; frequent commits.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `shared/package.json`, `shared/tsconfig.json`, `server/package.json`, `server/tsconfig.json`
- Create: `blobs/.gitkeep`, `data/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test`, `npm run typecheck`, `npm run build` scripts at the root that fan out to workspaces.

- [ ] **Step 1: Initialize git and workspace root**

```bash
git init
```

Create `package.json`:
```json
{
  "name": "confer",
  "private": true,
  "workspaces": ["shared", "server", "web", "cli"],
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b",
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspace server"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Base TS + Vitest config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["**/*.test.ts"] } });
```

`.gitignore`:
```
node_modules
dist
data/*.db*
blobs/**
!blobs/.gitkeep
.env
```

`.env.example`:
```
APP_ORIGIN=http://localhost:5173
VIEW_ORIGIN=http://localhost:5174
DB_PATH=./data/confer.db
BLOB_DIR=./blobs
SIGNING_SECRET=dev-only-change-me
```

- [ ] **Step 3: Create the `shared` and `server` workspace packages**

`shared/package.json`:
```json
{ "name": "@confer/shared", "type": "module", "main": "src/index.ts",
  "dependencies": { "zod": "^3.23.0" } }
```

`server/package.json`:
```json
{ "name": "@confer/server", "type": "module",
  "scripts": { "dev": "node --experimental-strip-types src/index.ts" },
  "dependencies": {
    "@confer/shared": "*", "hono": "^4.5.0", "@hono/node-server": "^1.12.0",
    "drizzle-orm": "^0.33.0", "better-sqlite3": "^11.0.0",
    "@noble/hashes": "^1.4.0", "ulidx": "^2.3.0"
  },
  "devDependencies": { "@types/better-sqlite3": "^7.6.0", "drizzle-kit": "^0.24.0" } }
```

Each workspace `tsconfig.json` extends the base:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 4: Install and verify the toolchain**

Run: `npm install`
Then: `npm run typecheck`
Expected: passes (no source yet, empty build graph OK).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: monorepo scaffold with workspaces, TS, vitest"
```

---

### Task 2: Config module (fail-fast env parsing)

**Files:**
- Create: `server/src/config.ts`
- Test: `server/src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string,string|undefined>): Config` where `Config = { appOrigin, viewOrigin, dbPath, blobDir, signingSecret }`. Throws on any missing required var.

- [ ] **Step 1: Write the failing test**

`server/src/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const full = { APP_ORIGIN: "a", VIEW_ORIGIN: "v", DB_PATH: "d", BLOB_DIR: "b", SIGNING_SECRET: "s" };

describe("loadConfig", () => {
  it("parses a full env", () => {
    expect(loadConfig(full)).toEqual({ appOrigin: "a", viewOrigin: "v", dbPath: "d", blobDir: "b", signingSecret: "s" });
  });
  it("throws when a required var is missing", () => {
    expect(() => loadConfig({ ...full, SIGNING_SECRET: undefined })).toThrow(/SIGNING_SECRET/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/config.test.ts`
Expected: FAIL — `Cannot find module './config.js'`.

- [ ] **Step 3: Write minimal implementation**

`server/src/config.ts`:
```ts
export interface Config {
  appOrigin: string; viewOrigin: string; dbPath: string; blobDir: string; signingSecret: string;
}
const REQUIRED = ["APP_ORIGIN", "VIEW_ORIGIN", "DB_PATH", "BLOB_DIR", "SIGNING_SECRET"] as const;

export function loadConfig(env: Record<string, string | undefined>): Config {
  for (const k of REQUIRED) if (!env[k]) throw new Error(`Missing required env var: ${k}`);
  return {
    appOrigin: env.APP_ORIGIN!, viewOrigin: env.VIEW_ORIGIN!, dbPath: env.DB_PATH!,
    blobDir: env.BLOB_DIR!, signingSecret: env.SIGNING_SECRET!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/config.test.ts
git commit -m "feat: fail-fast config loader"
```

---

### Task 3: Blob hashing + content-addressed disk store

**Files:**
- Create: `server/src/blob/hash.ts`, `server/src/blob/store.ts`, `server/src/blob/disk.ts`
- Test: `server/src/blob/disk.test.ts`

**Interfaces:**
- Produces:
  - `hashBytes(bytes: Uint8Array): string` — lowercase blake3 hex.
  - `interface BlobStore { put(bytes): Promise<string>; get(hash): Promise<Uint8Array>; has(hash): Promise<boolean> }`.
  - `class DiskBlobStore implements BlobStore` constructed with `blobDir`. Path: `<dir>/<h0h1>/<h2h3>/<hash>`.

- [ ] **Step 1: Write the failing test**

`server/src/blob/disk.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskBlobStore } from "./disk.js";
import { hashBytes } from "./hash.js";

let store: DiskBlobStore;
beforeEach(() => { store = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-blob-"))); });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/blob/disk.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`server/src/blob/hash.ts`:
```ts
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";
export function hashBytes(bytes: Uint8Array): string { return bytesToHex(blake3(bytes)); }
```

`server/src/blob/store.ts`:
```ts
export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>;
  get(hash: string): Promise<Uint8Array>;
  has(hash: string): Promise<boolean>;
}
```

`server/src/blob/disk.ts`:
```ts
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobStore } from "./store.js";
import { hashBytes } from "./hash.js";

export class DiskBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}
  private path(hash: string): string { return join(this.dir, hash.slice(0, 2), hash.slice(2, 4), hash); }
  async put(bytes: Uint8Array): Promise<string> {
    const hash = hashBytes(bytes);
    const p = this.path(hash);
    if (await this.has(hash)) return hash;      // idempotent: identical bytes already stored
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    return hash;
  }
  async get(hash: string): Promise<Uint8Array> { return new Uint8Array(await readFile(this.path(hash))); }
  async has(hash: string): Promise<boolean> {
    try { await access(this.path(hash)); return true; } catch { return false; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/blob/disk.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/blob
git commit -m "feat: content-addressed blob store (blake3, disk, idempotent)"
```

---

### Task 4: Drizzle schema + WAL client + migration

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`, `drizzle.config.ts`
- Test: `server/src/db/client.test.ts`

**Interfaces:**
- Produces:
  - Drizzle tables per [../data-model.md](../data-model.md#1-schema-drizzle--sql-sketch) — Phase 1 needs `orgs`, `spaces`, `docs`, `versions`, `tokens`, `events` (others added when their phase arrives).
  - `openDb(path: string): DB` — opens SQLite with `PRAGMA journal_mode = WAL` and returns a Drizzle instance.
  - `newId(): string` — ULID.

- [ ] **Step 1: Write the failing test**

`server/src/db/client.test.ts`:
```ts
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
  it("newId returns distinct ULIDs", () => { expect(newId()).not.toBe(newId()); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/db/client.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`server/src/db/schema.ts` (Phase-1 subset; extend in later phases):
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at").notNull().default(0),
});

export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  requiredApprovals: integer("required_approvals").notNull().default(1),
});

export const docs = sqliteTable("docs", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  docId: text("doc_id").notNull(),
  number: integer("number").notNull(),
  blobHash: text("blob_hash").notNull(),
  state: text("state").notNull(),            // draft|in_review|approved|superseded|rejected
  origin: text("origin").notNull(),          // push|suggestion|md_convert
  authorType: text("author_type").notNull(), // human|agent
  authorName: text("author_name"),
  tool: text("tool"),
  sourceRepo: text("source_repo"),
  commitSha: text("commit_sha"),
  branch: text("branch"),
  pushedAt: integer("pushed_at").notNull().default(0),
});

export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  hash: text("hash").notNull().unique(),
  scopes: text("scopes").notNull(),          // comma-joined: push,read,mcp
  createdBy: text("created_by"),
  lastUsedAt: integer("last_used_at"),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});
```

`server/src/db/client.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ulid } from "ulidx";
import * as schema from "./schema.js";

export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}
export function newId(): string { return ulid(); }

// Minimal inline DDL so :memory: and fresh installs work without drizzle-kit at runtime.
function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, required_approvals INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, number INTEGER NOT NULL, blob_hash TEXT NOT NULL, state TEXT NOT NULL, origin TEXT NOT NULL, author_type TEXT NOT NULL, author_name TEXT, tool TEXT, source_repo TEXT, commit_sha TEXT, branch TEXT, pushed_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_by TEXT, last_used_at INTEGER);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(version_id UNINDEXED, doc_id UNINDEXED, space_id UNINDEXED, state UNINDEXED, source_repo UNINDEXED, text);
  `);
}

export type DB = ReturnType<typeof openDb>;
```

`drizzle.config.ts` (for generating real migration files later; runtime uses inline DDL above):
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./server/src/db/schema.ts", out: "./server/src/db/migrations", dialect: "sqlite" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/db/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db drizzle.config.ts
git commit -m "feat: drizzle schema + WAL sqlite client + FTS5 table"
```

---

### Task 5: Token auth (hash, verify, requireScope)

**Files:**
- Create: `server/src/auth/tokens.ts`
- Test: `server/src/auth/tokens.test.ts`

**Interfaces:**
- Produces:
  - `type Scope = "push" | "read" | "mcp"`.
  - `createToken(db, orgId, name, scopes: Scope[]): { raw: string; id: string }` — stores only the hash; returns the plaintext once.
  - `verifyToken(db, raw): Promise<{ orgId: string; scopes: Scope[] } | null>` — updates `lastUsedAt`.
  - `hasScope(scopes: Scope[], want: Scope): boolean`.

- [ ] **Step 1: Write the failing test**

`server/src/auth/tokens.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs } from "../db/schema.js";
import { createToken, verifyToken, hasScope } from "./tokens.js";

let db: DB; let orgId: string;
beforeEach(() => {
  db = openDb(":memory:"); orgId = newId();
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
});

describe("tokens", () => {
  it("verifies a freshly created token and returns its scopes", async () => {
    const { raw } = createToken(db, orgId, "ci", ["push"]);
    const res = await verifyToken(db, raw);
    expect(res).toEqual({ orgId, scopes: ["push"] });
  });
  it("rejects an unknown token", async () => {
    expect(await verifyToken(db, "confer_bogus")).toBeNull();
  });
  it("stores only a hash, never the plaintext", () => {
    const { raw } = createToken(db, orgId, "ci", ["push"]);
    const row = db.query.tokens?.findFirst?.() ?? null; // fallback below if query API differs
    // Assert plaintext is absent from the stored hash column:
    const all = db.$client.prepare("SELECT hash FROM tokens").all() as { hash: string }[];
    expect(all[0]!.hash).not.toBe(raw);
  });
  it("hasScope checks membership", () => {
    expect(hasScope(["push", "mcp"], "mcp")).toBe(true);
    expect(hasScope(["push"], "mcp")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/auth/tokens.test.ts`
Expected: FAIL — `./tokens.js` not found.

- [ ] **Step 3: Write minimal implementation**

`server/src/auth/tokens.ts`:
```ts
import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { tokens } from "../db/schema.js";

export type Scope = "push" | "read" | "mcp";

function hashRaw(raw: string): string { return bytesToHex(sha256(new TextEncoder().encode(raw))); }

export function createToken(db: DB, orgId: string, name: string, scopes: Scope[]): { raw: string; id: string } {
  const raw = "confer_" + randomBytes(24).toString("base64url");
  const id = newId();
  db.insert(tokens).values({ id, orgId, name, hash: hashRaw(raw), scopes: scopes.join(",") }).run();
  return { raw, id };
}

export async function verifyToken(db: DB, raw: string): Promise<{ orgId: string; scopes: Scope[] } | null> {
  const row = db.select().from(tokens).where(eq(tokens.hash, hashRaw(raw))).get();
  if (!row) return null;
  db.update(tokens).set({ lastUsedAt: Date.now() }).where(eq(tokens.id, row.id)).run();
  return { orgId: row.orgId, scopes: row.scopes.split(",") as Scope[] };
}

export function hasScope(scopes: Scope[], want: Scope): boolean { return scopes.includes(want); }
```

> Note: the test's `db.$client` accessor exposes the underlying `better-sqlite3` handle for the raw-SQL assertion; if the Drizzle version names it differently, use `openDb`'s returned handle. Keep the assertion "stored value ≠ plaintext".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/auth/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/auth/tokens.ts server/src/auth/tokens.test.ts
git commit -m "feat: scoped API tokens (hashed at rest, verify, scope check)"
```

---

### Task 6: `createVersion` — hash → dedupe → blob → row → provenance → FTS

**Files:**
- Create: `server/src/search/extract.ts`, `server/src/versions/create.ts`
- Test: `server/src/versions/create.test.ts`

**Interfaces:**
- Consumes: `DiskBlobStore.put`, `openDb`, `newId`, `versions`/`docs`/`spaces` tables.
- Produces:
  - `extractText(html: string): string` — strips tags to a searchable text blob.
  - `createVersion(deps, input): Promise<{ versionId: string; number: number; reviewUrl: string; deduped: boolean }>` where
    `input = { orgId, spaceId, docId, html: Uint8Array, draft?: boolean, provenance: { authorType, authorName?, tool?, sourceRepo?, commitSha?, branch? } }`
    and `deps = { db, blobs, appOrigin }`.
  - Dedupe: if a version with the same `blobHash` already exists for the doc, return it with `deduped: true` and **no new row**.

- [ ] **Step 1: Write the failing test**

`server/src/versions/create.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { spaces, docs, versions } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createVersion } from "./create.js";

let db: DB; let blobs: DiskBlobStore; let docId: string; let spaceId: string; const orgId = "org1";
beforeEach(() => {
  db = openDb(":memory:");
  blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-cv-")));
  spaceId = newId(); docId = newId();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();
});
const deps = () => ({ db, blobs, appOrigin: "https://app.tryconfer.com" });
const html = (s: string) => new TextEncoder().encode(s);
const prov = { authorType: "agent" as const, tool: "claude-code", sourceRepo: "acme/api", commitSha: "abc123", branch: "main" };

describe("createVersion", () => {
  it("creates an in_review version with a monotonic number and a review URL", async () => {
    const r = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>v1</h1>"), provenance: prov });
    expect(r.number).toBe(1);
    expect(r.deduped).toBe(false);
    expect(r.reviewUrl).toContain(r.versionId);
    const row = db.select().from(versions).get();
    expect(row!.state).toBe("in_review");
    expect(row!.commitSha).toBe("abc123");
  });
  it("honors --draft", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>d</h1>"), draft: true, provenance: prov });
    expect(db.select().from(versions).get()!.state).toBe("draft");
  });
  it("is idempotent by content hash (no duplicate row for identical bytes)", async () => {
    const a = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov });
    const b = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>same</h1>"), provenance: prov });
    expect(b.deduped).toBe(true);
    expect(b.versionId).toBe(a.versionId);
    expect(db.select().from(versions).all()).toHaveLength(1);
  });
  it("assigns increasing numbers for different content", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>1</h1>"), provenance: prov });
    const two = await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>2</h1>"), provenance: prov });
    expect(two.number).toBe(2);
  });
  it("indexes extracted text into FTS", async () => {
    await createVersion(deps(), { orgId, spaceId, docId, html: html("<h1>Refresh token TTL</h1>"), provenance: prov });
    const hit = db.$client.prepare("SELECT text FROM docs_fts WHERE text MATCH 'refresh'").all() as { text: string }[];
    expect(hit.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/versions/create.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`server/src/search/extract.ts`:
```ts
// Deterministic, dependency-free tag strip. A readability-grade extractor replaces this in Phase 4/6.
export function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

`server/src/versions/create.ts`:
```ts
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { versions } from "../db/schema.js";
import type { BlobStore } from "../blob/store.js";
import { hashBytes } from "../blob/hash.js";
import { extractText } from "../search/extract.js";

export interface Provenance {
  authorType: "human" | "agent";
  authorName?: string; tool?: string; sourceRepo?: string; commitSha?: string; branch?: string;
}
export interface CreateVersionDeps { db: DB; blobs: BlobStore; appOrigin: string; }
export interface CreateVersionInput {
  orgId: string; spaceId: string; docId: string; html: Uint8Array; draft?: boolean; provenance: Provenance;
}
export interface CreateVersionResult { versionId: string; number: number; reviewUrl: string; deduped: boolean; }

export async function createVersion(deps: CreateVersionDeps, input: CreateVersionInput): Promise<CreateVersionResult> {
  const { db, blobs, appOrigin } = deps;
  const bytes = input.html;
  const blobHash = hashBytes(bytes);

  // Dedupe: identical content for this doc → return existing version, no new row.
  const existing = db.select().from(versions)
    .where(and(eq(versions.docId, input.docId), eq(versions.blobHash, blobHash))).get();
  if (existing) return { versionId: existing.id, number: existing.number, reviewUrl: reviewUrl(appOrigin, existing.id), deduped: true };

  await blobs.put(bytes);

  const last = db.select().from(versions).where(eq(versions.docId, input.docId)).orderBy(desc(versions.number)).get();
  const number = (last?.number ?? 0) + 1;
  const id = newId();
  const state = input.draft ? "draft" : "in_review";
  const p = input.provenance;

  db.insert(versions).values({
    id, docId: input.docId, number, blobHash, state, origin: "push",
    authorType: p.authorType, authorName: p.authorName, tool: p.tool,
    sourceRepo: p.sourceRepo, commitSha: p.commitSha, branch: p.branch, pushedAt: Date.now(),
  }).run();

  // Index for search (raw SQL against the FTS5 virtual table).
  db.$client.prepare(
    "INSERT INTO docs_fts (version_id, doc_id, space_id, state, source_repo, text) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, input.docId, input.spaceId, state, p.sourceRepo ?? "", extractText(new TextDecoder().decode(bytes)));

  return { versionId: id, number, reviewUrl: reviewUrl(appOrigin, id), deduped: false };
}

function reviewUrl(appOrigin: string, versionId: string): string { return `${appOrigin}/v/${versionId}`; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/versions/create.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/versions server/src/search/extract.ts
git commit -m "feat: createVersion with dedupe, provenance, and FTS indexing"
```

---

### Task 7: Publish endpoint — Hono route, 5 MB cap, scope enforcement

**Files:**
- Create: `server/src/api/versions.ts`, `server/src/app.ts`, `server/src/index.ts`
- Test: `server/src/api/versions.test.ts`

**Interfaces:**
- Consumes: `verifyToken`/`hasScope` (Task 5), `createVersion` (Task 6), `openDb`/`DiskBlobStore`.
- Produces: `buildApp(deps): Hono` mounting `POST /api/v1/spaces/:space/docs/:slug/versions`. `index.ts` wires real config and calls `serve`.

- [ ] **Step 1: Write the failing test**

`server/src/api/versions.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, newId, type DB } from "../db/client.js";
import { orgs, spaces, docs } from "../db/schema.js";
import { DiskBlobStore } from "../blob/disk.js";
import { createToken } from "../auth/tokens.js";
import { buildApp } from "../app.js";

let db: DB; let app: ReturnType<typeof buildApp>; let pushTok: string; let readTok: string;
const orgId = "org1"; const url = "/api/v1/spaces/backend/docs/auth-flow/versions";

beforeEach(() => {
  db = openDb(":memory:");
  const blobs = new DiskBlobStore(mkdtempSync(join(tmpdir(), "confer-api-")));
  db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
  const spaceId = newId(), docId = newId();
  db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
  db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth" }).run();
  pushTok = createToken(db, orgId, "ci", ["push"]).raw;
  readTok = createToken(db, orgId, "ro", ["read"]).raw;
  app = buildApp({ db, blobs, appOrigin: "https://app.tryconfer.com" });
});

const post = (body: object, auth?: string) => app.request(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  body: JSON.stringify(body),
});
const meta = { author_type: "agent", tool: "claude-code", source_repo: "acme/api", commit_sha: "abc", branch: "main" };

describe("POST versions", () => {
  it("creates a version with a push token", async () => {
    const res = await post({ html: "<h1>doc</h1>", metadata: meta }, pushTok);
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.data.version_id).toBeDefined();
    expect(json.data.review_url).toContain(json.data.version_id);
  });
  it("rejects a missing token (401)", async () => { expect((await post({ html: "<h1>x</h1>", metadata: meta })).status).toBe(401); });
  it("rejects a read-only token (403)", async () => { expect((await post({ html: "<h1>x</h1>", metadata: meta }, readTok)).status).toBe(403); });
  it("rejects a body over 5 MB (413)", async () => {
    const big = "<h1>" + "a".repeat(5 * 1024 * 1024 + 1) + "</h1>";
    expect((await post({ html: big, metadata: meta }, pushTok)).status).toBe(413);
  });
  it("is idempotent: same content returns the same version_id", async () => {
    const a = await (await post({ html: "<h1>same</h1>", metadata: meta }, pushTok)).json() as any;
    const b = await (await post({ html: "<h1>same</h1>", metadata: meta }, pushTok)).json() as any;
    expect(b.data.version_id).toBe(a.data.version_id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/api/versions.test.ts`
Expected: FAIL — `../app.js` not found.

- [ ] **Step 3: Write minimal implementation**

`server/src/api/versions.ts`:
```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type { BlobStore } from "../blob/store.js";
import { spaces, docs } from "../db/schema.js";
import { verifyToken, hasScope, type Scope } from "../auth/tokens.js";
import { createVersion, type Provenance } from "../versions/create.js";

const MAX_BYTES = 5 * 1024 * 1024;
const ok = (data: unknown) => ({ success: true, data, error: null });
const err = (msg: string) => ({ success: false, data: null, error: msg });

export interface ApiDeps { db: DB; blobs: BlobStore; appOrigin: string; }

export function versionsRoutes(deps: ApiDeps): Hono {
  const r = new Hono();
  r.post("/spaces/:space/docs/:slug/versions", async (c) => {
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return c.json(err("missing token"), 401);
    const auth = await verifyToken(deps.db, raw);
    if (!auth) return c.json(err("invalid token"), 401);
    if (!hasScope(auth.scopes as Scope[], "push")) return c.json(err("push scope required"), 403);

    const body = await c.req.json().catch(() => null) as { html?: string; metadata?: Record<string, unknown>; draft?: boolean } | null;
    if (!body?.html) return c.json(err("html required"), 400);
    const bytes = new TextEncoder().encode(body.html);
    if (bytes.byteLength > MAX_BYTES) return c.json(err("body exceeds 5 MB"), 413);

    const space = deps.db.select().from(spaces)
      .where(and(eq(spaces.orgId, auth.orgId), eq(spaces.slug, c.req.param("space")))).get();
    if (!space) return c.json(err("space not found"), 404);
    const doc = deps.db.select().from(docs)
      .where(and(eq(docs.spaceId, space.id), eq(docs.slug, c.req.param("slug")))).get();
    if (!doc) return c.json(err("doc not found"), 404);

    const m = body.metadata ?? {};
    const provenance: Provenance = {
      authorType: (m.author_type as "human" | "agent") ?? "agent",
      authorName: m.author as string | undefined, tool: m.tool as string | undefined,
      sourceRepo: m.source_repo as string | undefined, commitSha: m.commit_sha as string | undefined,
      branch: m.branch as string | undefined,
    };
    const res = await createVersion(
      { db: deps.db, blobs: deps.blobs, appOrigin: deps.appOrigin },
      { orgId: auth.orgId, spaceId: space.id, docId: doc.id, html: bytes, draft: body.draft, provenance },
    );
    return c.json(ok({ version_id: res.versionId, review_url: res.reviewUrl, deduped: res.deduped }), 201);
  });
  return r;
}
```

`server/src/app.ts`:
```ts
import { Hono } from "hono";
import { versionsRoutes, type ApiDeps } from "./api/versions.js";

export function buildApp(deps: ApiDeps): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api/v1", versionsRoutes(deps));
  return app;
}
```

`server/src/index.ts`:
```ts
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { DiskBlobStore } from "./blob/disk.js";
import { buildApp } from "./app.js";

const cfg = loadConfig(process.env);
const app = buildApp({ db: openDb(cfg.dbPath), blobs: new DiskBlobStore(cfg.blobDir), appOrigin: cfg.appOrigin });
serve({ fetch: app.fetch, port: 8787 });
console.log("confer server on :8787");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/src/api/versions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add server/src/api server/src/app.ts server/src/index.ts
git commit -m "feat: publish endpoint with token scope + 5MB cap + idempotency"
```

---

## Phase 1 Definition of Done (matches [../implementation-plan.md](../implementation-plan.md#phase-1--foundation-scaffold-schema-blob-store-push-api-token-auth))

- [ ] `POST /api/v1/spaces/:space/docs/:slug/versions` with a `push` token returns `{ version_id, review_url }` (201).
- [ ] Re-posting identical bytes returns the **same** version (idempotency).
- [ ] Version rows immutable; provenance persisted; text indexed into FTS5.
- [ ] >5 MB rejected (413); missing token (401); non-`push` scope (403).
- [ ] `npm test` and `npm run typecheck` green.

## Self-review notes

- **Type consistency:** `Scope`, `Provenance`, `CreateVersionDeps`/`CreateVersionResult`, `ApiDeps` are defined once and reused across tasks — no drift.
- **No placeholders:** every step ships real code and an exact command with expected output.
- **Postgres-compat caveat:** the raw-SQL FTS insert and `db.$client` access are the one SQLite-specific seam; they live behind `createVersion` and the `SearchProvider` interface arrives in Phase 4 to formalize the boundary before the Postgres migration.
- **Deferred to their phases:** `read`/`mcp` enforcement paths (Phase 4), signed content URLs (Phase 2), approve/supersede (Phase 3). Phase 1 stops at "a version exists, in_review, searchable."
