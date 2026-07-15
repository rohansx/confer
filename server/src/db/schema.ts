import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Identity is keyed by EMAIL. A user can sign in via GitHub, Google, or an
// email magic link — all merging into one account when the email matches.
// Access to docs is gated by org membership (org spaces) or personal ownership
// (personal spaces), replacing the v0 "first-org / owns-any-space" proxy.

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdById: text("created_by"),
  createdAt: integer("created_at").notNull().default(0),
});

// email is nullable so legacy v0 users (and tests) that don't set it keep
// working; new auth flows always set it (unique among non-null values).
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull().default(0),
});

// (provider, subject) → user. provider ∈ github | google | email.
export const identities = sqliteTable(
  "identities",
  {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.subject] }) }),
);

export const orgMemberships = sqliteTable(
  "org_memberships",
  {
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(), // admin | member
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.userId] }) }),
);

// Pending invite by email, before the user has signed in. Accepting = a user
// with this email signs in → auto-joined (role member) + invitation.acceptedAt.
export const orgInvitations = sqliteTable(
  "org_invitations",
  {
    orgId: text("org_id").notNull(),
    email: text("email").notNull(),
    invitedBy: text("invited_by").notNull(),
    createdAt: integer("created_at").notNull().default(0),
    acceptedAt: integer("accepted_at"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.email] }) }),
);

// Legacy v0 per-space approvers. Kept as an access grant (grandfathered) so
// existing setups keep working; new orgs use org membership instead.
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

// A space belongs to an org (orgId set) OR is personal (ownerId set, orgId null).
export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  orgId: text("org_id"),
  ownerId: text("owner_id"),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  requiredApprovals: integer("required_approvals").notNull().default(1),
  // Free-text context / system prompt for the space. Surfaced to agents over
  // MCP (get_context) so they can chat with the space's docs with the intended
  // framing. Editable by space admins/owners in Settings.
  context: text("context"),
});

export const docs = sqliteTable("docs", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});

// A personal doc shared with an org → that org's members can read it.
export const docShares = sqliteTable(
  "doc_shares",
  {
    docId: text("doc_id").notNull(),
    orgId: text("org_id").notNull(),
    sharedBy: text("shared_by").notNull(),
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.docId, t.orgId] }) }),
);

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
  // Blob hash of the raw agent session / prompt transcript that produced this
  // version — provenance, like commit_sha. NULL when no session was attached.
  sessionHash: text("session_hash"),
});

// A token is scoped to EITHER an org (org_id set) OR a personal owner
// (owner_id set). Exactly one is populated — the other is NULL.
export const tokens = sqliteTable("tokens", {
  id: text("id").primaryKey(),
  orgId: text("org_id"),
  ownerId: text("owner_id"),
  name: text("name").notNull(),
  hash: text("hash").notNull().unique(),
  scopes: text("scopes").notNull(),
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
  parentId: text("parent_id"),
  authorUserId: text("author_user_id").notNull(),
  body: text("body").notNull(),
  anchorQuote: text("anchor_quote"),
  anchorPrefix: text("anchor_prefix"),
  anchorSuffix: text("anchor_suffix"),
  anchorSelector: text("anchor_selector"),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull().default(0),
});

export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    hash: text("hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(0),
  },
);

export const stars = sqliteTable(
  "stars",
  {
    docId: text("doc_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.docId, t.userId] }) }),
);