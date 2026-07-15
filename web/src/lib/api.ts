import type {
  Provenance,
  VersionDetail,
  HistoryRow,
  HistoryResponse,
  User,
  CommentRow,
  CommentListResponse,
  AnchorPayload,
  ApiEnvelope,
} from "@confer/shared";

// Re-export the wire DTOs so existing imports (`import { type VersionDetail } from "../lib/api"`)
// keep working without touching every component.
export type {
  Provenance,
  VersionDetail,
  HistoryRow,
  HistoryResponse,
  User,
  CommentRow,
  CommentListResponse,
  AnchorPayload,
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!json || !json.success || json.data === null) {
    const msg = json?.error ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json.data;
}

export async function fetchVersion(id: string, token: string): Promise<VersionDetail> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return call<VersionDetail>(`/api/v1/versions/${id}`, { headers });
}

export async function login(user_id: string, name: string, email?: string): Promise<User> {
  return call<User>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id, name, email }),
  });
}

export async function logout(): Promise<void> {
  await call<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" });
}

export async function whoami(): Promise<User> {
  return call<User>("/api/v1/auth/whoami");
}

export async function listHistory(space: string, slug: string): Promise<HistoryResponse> {
  return call<HistoryResponse>(`/api/v1/spaces/${space}/docs/${slug}/versions`);
}

export async function approveVersion(versionId: string): Promise<{ versionId: string; state: "approved"; supersededId: string | null; approvedAt: number }> {
  return call(`/api/v1/versions/${versionId}/approve`, { method: "POST" });
}

export async function rejectVersion(versionId: string, reason: string): Promise<{ versionId: string; state: "rejected"; rejectedAt: number }> {
  return call(`/api/v1/versions/${versionId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export async function listComments(space: string, slug: string, opts: { includeResolved?: boolean } = {}): Promise<CommentListResponse> {
  const params = opts.includeResolved ? "?include_resolved=true" : "";
  return call<CommentListResponse>(`/api/v1/spaces/${space}/docs/${slug}/comments${params}`);
}

export async function createComment(
  space: string,
  slug: string,
  args: { body: string; version_id: string; parent_id?: string; anchor?: AnchorPayload | null },
): Promise<{ id: string }> {
  return call<{ id: string }>(`/api/v1/spaces/${space}/docs/${slug}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export async function resolveComment(commentId: string): Promise<{ id: string; resolved_at: number }> {
  return call(`/api/v1/comments/${commentId}/resolve`, { method: "POST" });
}

export async function replyToComment(commentId: string, body: string): Promise<{ id: string }> {
  return call(`/api/v1/comments/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export interface DiffSegment {
  op: "equal" | "insert" | "delete";
  text: string;
}
export interface DiffResponse {
  from: { id: string; number: number; state: string };
  to: { id: string; number: number; state: string };
  segments: DiffSegment[];
  aText: string;
  bText: string;
}

export async function fetchDiff(space: string, slug: string, opts: { from?: number; to?: number } = {}): Promise<DiffResponse> {
  const params = new URLSearchParams();
  if (opts.from != null) params.set("from", String(opts.from));
  if (opts.to != null) params.set("to", String(opts.to));
  const q = params.toString() ? `?${params}` : "";
  return call<DiffResponse>(`/api/v1/spaces/${space}/docs/${slug}/diff${q}`);
}

// ---- Upload (session-auth push) + per-space doc listing -------------------

export interface UploadResult {
  version_id: string;
  review_url: string;
  deduped: boolean;
}

export interface SpaceDocRow {
  slug: string;
  title: string;
  space: string;
  state: string;
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  source_repo: string | null;
  updated_at: number;
  doc_id: string;
  starred: boolean;
  version_id: string;
  version_number: number;
}

export interface SpaceDocsResponse {
  docs: SpaceDocRow[];
  is_owner: boolean;
  include_unapproved: boolean;
}

export async function uploadVersion(
  space: string,
  slug: string,
  args: {
    html: string;
    draft?: boolean;
    session?: string;
    metadata?: {
      title?: string;
      author_type?: "human" | "agent";
      author?: string;
      tool?: string;
      source_repo?: string;
      commit_sha?: string;
      branch?: string;
    };
  },
): Promise<UploadResult> {
  return call<UploadResult>(`/api/v1/spaces/${space}/docs/${slug}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html: args.html, draft: args.draft ?? false, metadata: args.metadata, session: args.session }),
  });
}

export async function listSpaceDocs(space: string, opts: { repo?: string } = {}): Promise<SpaceDocsResponse> {
  const params = new URLSearchParams();
  if (opts.repo) params.set("repo", opts.repo);
  const q = params.toString() ? `?${params}` : "";
  return call<SpaceDocsResponse>(`/api/v1/spaces/${space}/docs${q}`);
}

export interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  orgId: string;
}

export async function listSpaces(): Promise<SpaceRow[]> {
  const res = await call<{ spaces: SpaceRow[] }>("/api/v1/spaces");
  return res.spaces;
}

// ---- Per-space context / system prompt (chat-with-docs) -------------------

export interface SpaceContext {
  space: string;
  context: string;
  can_edit?: boolean;
}

export async function getSpaceContext(space: string): Promise<SpaceContext> {
  return call<SpaceContext>(`/api/v1/spaces/${space}/context`);
}

export async function setSpaceContext(space: string, context: string): Promise<SpaceContext> {
  return call<SpaceContext>(`/api/v1/spaces/${space}/context`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });
}

// ---- Token management (Settings) ------------------------------------------

export interface TokenRow {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: number | null;
}

export interface CreatedToken {
  id: string;
  raw: string;
  name: string;
  scopes: string[];
}

// `personal: true` manages the caller's own personal (owner-scoped) tokens;
// otherwise org tokens (caller must be an org admin).
export async function listTokens(personal = false): Promise<TokenRow[]> {
  const res = await call<{ tokens: TokenRow[] }>(`/api/v1/tokens${personal ? "?owner_id=me" : ""}`);
  return res.tokens;
}

export async function createToken(name: string, scopes: string[], personal = false): Promise<CreatedToken> {
  return call<CreatedToken>("/api/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, scopes, ...(personal ? { owner_id: "me" } : {}) }),
  });
}

export async function revokeToken(id: string, personal = false): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/v1/tokens/${id}${personal ? "?owner_id=me" : ""}`, { method: "DELETE" });
}

// ---- Search (⌘K) ----------------------------------------------------------

export interface SearchHit {
  slug: string;
  title: string;
  space: string;
  snippet: string;
  state: string;
  source_repo: string | null;
  version_id: string;
  version_number: number;
  updated_at: number;
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  doc_id: string;
  starred: boolean;
}

export async function searchDocs(query: string, opts: { space?: string; repo?: string; limit?: number } = {}): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (opts.space) params.set("space", opts.space);
  if (opts.repo) params.set("repo", opts.repo);
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await call<{ hits: SearchHit[] }>(`/api/v1/search?${params}`);
  return res.hits;
}

// ---- Starred docs (bookmarks) --------------------------------------------

export async function starDoc(docId: string): Promise<{ starred: boolean }> {
  return call<{ starred: boolean }>(`/api/v1/docs/${docId}/star`, { method: "POST" });
}

export async function unstarDoc(docId: string): Promise<{ starred: boolean }> {
  return call<{ starred: boolean }>(`/api/v1/docs/${docId}/star`, { method: "DELETE" });
}

export async function listStarred(): Promise<SpaceDocRow[]> {
  const res = await call<{ docs: SpaceDocRow[] }>("/api/v1/starred");
  return res.docs;
}

// ---- Orgs / members / invites -------------------------------------------

export interface OrgMembership {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
}

export interface OrgMember {
  user_id: string;
  name: string;
  email: string | null;
  role: "admin" | "member";
}

export interface OrgInvite {
  email: string;
  created_at: number;
  accepted_at: number | null;
}

export async function listOrgs(): Promise<OrgMembership[]> {
  const res = await call<{ orgs: OrgMembership[] }>("/api/v1/orgs");
  return res.orgs;
}

export async function createOrg(name: string, slug?: string): Promise<OrgMembership> {
  return call<OrgMembership>("/api/v1/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug }),
  });
}

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const res = await call<{ members: OrgMember[] }>(`/api/v1/orgs/${orgId}/members`);
  return res.members;
}

export async function inviteMember(orgId: string, email: string, role?: "admin" | "member"): Promise<unknown> {
  return call(`/api/v1/orgs/${orgId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(orgId: string, userId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/v1/orgs/${orgId}/members/${userId}`, { method: "DELETE" });
}

export async function listInvites(orgId: string): Promise<OrgInvite[]> {
  const res = await call<{ invites: OrgInvite[] }>(`/api/v1/orgs/${orgId}/invites`);
  return res.invites;
}

export async function revokeInvite(orgId: string, email: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/v1/orgs/${orgId}/invites/${encodeURIComponent(email)}`, { method: "DELETE" });
}

// ---- Magic-link auth -----------------------------------------------------

export async function requestMagicLink(email: string): Promise<{ sent: boolean; verify_url?: string }> {
  return call<{ sent: boolean; verify_url?: string }>("/api/v1/auth/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}
