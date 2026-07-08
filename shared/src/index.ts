// Shared types + zod schemas across web, server, and cli.
//
// These are the CANONICAL types for everything that crosses a workspace
// boundary: the REST/MCP wire DTOs (snake_case, as emitted by the server),
// the API envelope, and the domain enums (VersionState / TokenScope / origin).
// web and cli consume these directly; server re-uses the enums and the
// envelope. Runtime zod schemas live in ./schemas.ts and are re-exported below.

export const CONFER_API_VERSION = "v1" as const;

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export type VersionState =
  | "draft"
  | "in_review"
  | "approved"
  | "superseded"
  | "rejected";

export type VersionOrigin = "push" | "suggestion" | "md_convert";

/** Every scope a token may carry. `unapproved` gates opt-in read of non-approved content. */
export type TokenScope = "push" | "read" | "mcp" | "unapproved";

// ---------------------------------------------------------------------------
// REST API envelope
// ---------------------------------------------------------------------------

/** Every /api/v1 response is wrapped in this shape. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Wire DTOs (snake_case, exactly as returned by /api/v1)
// ---------------------------------------------------------------------------

/** Provenance as sent by the CLI/MCP on push (all fields optional). */
export interface ProvenanceMetadata {
  author_type?: "human" | "agent";
  author?: string;
  tool?: string;
  source_repo?: string;
  commit_sha?: string;
  branch?: string;
}

/** Provenance as returned by the server (all fields present). */
export interface Provenance {
  author_type: "human" | "agent";
  author_name: string | null;
  tool: string | null;
  source_repo: string | null;
  commit_sha: string | null;
  branch: string | null;
  pushed_at: number;
}

export interface VersionDetail {
  id: string;
  doc_id: string;
  number: number;
  state: VersionState;
  origin: VersionOrigin;
  title: string;
  slug: string;
  space: string;
  provenance: Provenance;
  content_url: string;
}

export interface HistoryRow {
  id: string;
  number: number;
  state: VersionState;
  origin: VersionOrigin;
  authorType: string;
  authorName: string | null;
  tool: string | null;
  sourceRepo: string | null;
  commitSha: string | null;
  branch: string | null;
  pushedAt: number;
  approvedBy: string | null;
  approvedAt: number | null;
  rejectedBy: string | null;
  rejectedAt: number | null;
  rejectReason: string | null;
}

export interface HistoryResponse {
  doc: { id: string; slug: string; title: string; space: string };
  versions: HistoryRow[];
  is_owner: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  orgs: { id: string; name: string; slug: string; role: "admin" | "member" }[];
}

export interface AnchorPayload {
  quote: string;
  prefix?: string;
  suffix?: string;
  selector?: string;
}

export interface ResolvedAnchor {
  start: number;
  end: number;
  lost: boolean;
  ambiguous?: boolean;
}

export interface CommentRow {
  id: string;
  doc_id: string;
  version_id_created_on: string;
  parent_id: string | null;
  author_user_id: string;
  author_name: string | null;
  body: string;
  anchor_quote: string | null;
  anchor_prefix: string | null;
  anchor_suffix: string | null;
  anchor_selector: string | null;
  resolved_at: number | null;
  created_at: number;
  anchor_resolved: ResolvedAnchor;
  is_carried_over: boolean;
}

export interface CommentListResponse {
  comments: CommentRow[];
}

/** POST /api/v1/spaces/:space/docs/:slug/versions response. */
export interface PushResponse {
  version_id: string;
  review_url: string;
  deduped: boolean;
}

// ---------------------------------------------------------------------------
// Runtime zod schemas (re-exported for the server's MCP tools / input parsing)
// ---------------------------------------------------------------------------

export { ProvenanceMetadataSchema, AnchorSchema } from "./schemas.js";