export interface Provenance {
  author_type: string;
  author_name: string | null;
  tool: string | null;
  source_repo: string | null;
  commit_sha: string | null;
  branch: string | null;
  pushed_at: number;
}

export interface VersionDetail {
  id: string;
  number: number;
  state: string;
  origin: string;
  title: string;
  slug: string;
  space: string;
  provenance: Provenance;
  content_url: string;
}

export interface HistoryRow {
  id: string;
  number: number;
  state: string;
  origin: string;
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
}

interface Envelope<T> { success: boolean; data: T | null; error: string | null }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
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
