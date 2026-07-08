import type { ApiEnvelope, PushResponse } from "@confer/shared";

/**
 * Typed HTTP client for the Confer REST + MCP APIs. The CLI talks to the server
 * exclusively through this module — no other network code in the CLI.
 */

export interface PublishVersionInput {
  space: string;
  slug: string;
  html: string;
  draft?: boolean;
  metadata?: {
    author_type?: "human" | "agent";
    author?: string;
    tool?: string;
    source_repo?: string | null;
    commit_sha?: string | null;
    branch?: string | null;
  };
}

export interface PublishVersionResult {
  versionId: string;
  number: number;
  reviewUrl: string;
  deduped: boolean;
}

export interface ListDocItem {
  slug: string;
  title: string;
  space: string;
  state: string;
  approved_by: string | null;
  approved_at: number | null;
  commit_sha: string | null;
  updated_at: number;
  version_id: string;
  version_number: number;
}

export class ConferApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`confer api ${status}: ${body.slice(0, 200)}`);
    this.name = "ConferApiError";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new ConferApiError(res.status, text);
  const j = JSON.parse(text) as ApiEnvelope<T>;
  if (!j.success || j.data === null) {
    throw new ConferApiError(res.status, j.error ?? "no data");
  }
  return j.data;
}

export async function publishVersion(
  server: string,
  token: string,
  input: PublishVersionInput,
): Promise<PublishVersionResult> {
  const url = `${server.replace(/\/$/, "")}/api/v1/spaces/${encodeURIComponent(input.space)}/docs/${encodeURIComponent(input.slug)}/versions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      html: input.html,
      draft: input.draft ?? false,
      metadata: {
        author_type: input.metadata?.author_type ?? "agent",
        author: input.metadata?.author,
        tool: input.metadata?.tool,
        source_repo: input.metadata?.source_repo,
        commit_sha: input.metadata?.commit_sha,
        branch: input.metadata?.branch,
      },
    }),
  });
  const data = await readJson<PushResponse>(res);
  return {
    versionId: data.version_id,
    number: 0, // server doesn't return number in the public shape; OK for the CLI
    reviewUrl: data.review_url,
    deduped: data.deduped,
  };
}

export async function listDocs(
  server: string,
  token: string,
  opts: { space?: string; repo?: string; include_unapproved?: boolean } = {},
): Promise<ListDocItem[]> {
  const params = new URLSearchParams();
  // Note: the REST list endpoint takes a (space, slug) pair. For "list all
  // docs this repo has pushed" we use the MCP endpoint instead, which the
  // CLI can also call. This helper is the REST shape for completeness.
  if (opts.space) params.set("space", opts.space);
  if (opts.repo) params.set("repo", opts.repo);
  if (opts.include_unapproved) params.set("include_unapproved", "true");
  const url = `${server.replace(/\/$/, "")}/api/v1/spaces/${encodeURIComponent(opts.space ?? "_")}/docs/_list?${params}`;
  // We don't actually call this — the CLI uses mcpCall for status. Kept for
  // future REST expansion.
  void url;
  return [];
}

/**
 * Call an MCP tool over streamable HTTP. The MCP server requires an mcp-scoped
 * bearer token. Returns the parsed text content of the tool's first
 * `text`-typed content block, with optional raw payload.
 */
export async function mcpCall(
  server: string,
  token: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; result: any }> {
  const url = `${server.replace(/\/$/, "")}/mcp`;
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };

  // 1) initialize
  await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "confer-cli", version: "0.0.0" } },
    }),
  }).then((r) => r.text());
  await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).then((r) => r.text());

  // 2) tools/call
  const res = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const body = await res.text();
  let last: any = null;
  for (const e of body.split("\n\n").map((s) => s.trim()).filter(Boolean)) {
    for (const line of e.split("\n")) {
      if (line.startsWith("data: ")) {
        try { last = JSON.parse(line.slice("data: ".length)); } catch { /* skip */ }
      }
    }
  }
  if (!last) throw new Error(`no JSON-RPC response: ${body.slice(0, 200)}`);
  if (last.error) throw new ConferApiError(500, JSON.stringify(last.error));
  const text = last.result?.content?.[0]?.text ?? "";
  return { text, result: last.result };
}
