import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Phase 3 adds: users, space_owners, approvals, sessions — the human-side of review.
// comments/llm_credentials/chat_threads still land with their phases.

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at").notNull().default(0),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt: integer("created_at").notNull().default(0),
});

export const spaceOwners = sqliteTable(
  "space_owners",
  {
    spaceId: text("space_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.spaceId, t.userId] }) }),
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
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

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(), // approve | reject
  reason: text("reason"),
  decidedAt: integer("decided_at").notNull().default(0),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  docId: text("doc_id").notNull(),
  versionIdCreatedOn: text("version_id_created_on").notNull(),
  parentId: text("parent_id"), // null = root thread
  authorUserId: text("author_user_id").notNull(),
  body: text("body").notNull(),
  anchorQuote: text("anchor_quote"),
  anchorPrefix: text("anchor_prefix"),
  anchorSuffix: text("anchor_suffix"),
  anchorSelector: text("anchor_selector"),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull().default(0),
});
