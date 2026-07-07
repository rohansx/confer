import { loadConfig } from "./config.js";
import { mcpCall, ConferApiError, type ListDocItem } from "./api.js";
import { getProvenance } from "./git.js";

/**
 * confer status [--space <s>] [--repo <r>]
 *
 * Lists docs this repo has pushed (or all docs if --space/--repo is given).
 * Implemented as a `list_docs` MCP call so we get the approved-only invariant
 * for free. Requires an mcp-scoped token.
 */
export async function status(opts: { space?: string; repo?: string } = {}): Promise<void> {
  const config = await loadConfig();
  const server = config.server;
  if (!server) throw new Error("no server configured — run `confer login` first");
  // Prefer an mcp-scoped token if it's been stored as such; fall back to the
  // push token (which may or may not have mcp scope — if not, the call will
  // 403 and we surface the error).
  const mcpToken = process.env.CONFER_MCP_TOKEN ?? config.pushToken;
  if (!mcpToken) throw new Error("no token configured — run `confer login` first");

  const repo = opts.repo ?? config.lastPush?.repo ?? (await getProvenance()).sourceRepo;
  const { text } = await mcpCall(server, mcpToken, "list_docs", {
    space: opts.space,
    repo: repo || undefined,
  });
  let body: { count: number; docs: ListDocItem[]; included_unapproved: boolean };
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new ConferApiError(500, `unparseable MCP response: ${text.slice(0, 200)}`);
  }

  if (body.count === 0) {
    process.stdout.write(`(no docs found${repo ? ` for repo ${repo}` : ""})\n`);
    return;
  }
  process.stdout.write(`${body.count} doc${body.count === 1 ? "" : "s"} (approved-only):\n`);
  for (const d of body.docs) {
    const state = d.state.padEnd(10);
    const approved = d.approved_at ? `@${new Date(d.approved_at).toISOString().slice(0, 10)}` : "          ";
    process.stdout.write(`  ${d.space}/${d.slug}  v${d.version_number}  ${state} ${approved}\n`);
  }
}
