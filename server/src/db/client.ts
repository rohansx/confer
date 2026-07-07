import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ulid } from "ulidx";
import * as schema from "./schema.js";

/**
 * Opens SQLite in WAL mode and returns a Drizzle instance.
 * Runs inline DDL so `:memory:` and fresh installs work without a migration
 * step. Real migration files (drizzle-kit) replace this before cloud/Postgres.
 */
export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

/** Application-generated, sortable, Postgres-portable id. */
export function newId(): string {
  return ulid();
}

function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, slug TEXT NOT NULL,
      name TEXT NOT NULL, required_approvals INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS space_owners (
      space_id TEXT NOT NULL, user_id TEXT NOT NULL,
      PRIMARY KEY (space_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL, slug TEXT NOT NULL,
      title TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, number INTEGER NOT NULL,
      blob_hash TEXT NOT NULL, state TEXT NOT NULL, origin TEXT NOT NULL,
      author_type TEXT NOT NULL, author_name TEXT, tool TEXT,
      source_repo TEXT, commit_sha TEXT, branch TEXT,
      pushed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_by TEXT,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY, version_id TEXT NOT NULL, user_id TEXT NOT NULL,
      action TEXT NOT NULL, reason TEXT,
      decided_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS approvals_version_idx ON approvals(version_id);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      version_id_created_on TEXT NOT NULL,
      parent_id TEXT,
      author_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      anchor_quote TEXT,
      anchor_prefix TEXT,
      anchor_suffix TEXT,
      anchor_selector TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS comments_doc_idx ON comments(doc_id);
    CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments(parent_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      version_id UNINDEXED, doc_id UNINDEXED, space_id UNINDEXED,
      state UNINDEXED, source_repo UNINDEXED, text
    );
  `);
}

export type DB = ReturnType<typeof openDb>;
