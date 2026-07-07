import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Phase 1 subset of the full data model (see docs/data-model.md).
// spaces/space_owners/docs/versions/tokens/events/orgs are what push needs;
// comments/approvals/llm_credentials/chat_threads arrive with their phases.

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
  state: text("state").notNull(), // draft|in_review|approved|superseded|rejected
  origin: text("origin").notNull(), // push|suggestion|md_convert
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
  scopes: text("scopes").notNull(), // comma-joined: push,read,mcp
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
