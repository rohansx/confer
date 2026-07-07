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

/** Fetch version metadata + a signed content URL from the app origin. */
export async function fetchVersion(id: string, token: string): Promise<VersionDetail> {
  const res = await fetch(`/api/v1/versions/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    success: boolean;
    data: VersionDetail | null;
    error: string | null;
  };
  if (!json.success || !json.data) throw new Error(json.error ?? "request failed");
  return json.data;
}
