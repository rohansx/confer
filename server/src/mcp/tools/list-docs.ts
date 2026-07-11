import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../auth.js";
import { resolveIncludeUnapproved } from "../auth.js";
import type { SearchProvider, SearchScope } from "../../search/provider.js";

const inputSchema = {
  space: z.string().optional().describe("Filter to a specific space slug."),
  repo: z.string().optional().describe("Filter to versions from a specific source repo."),
  include_unapproved: z.boolean().optional().describe("Include docs whose only version is unapproved. Requires the unapproved scope."),
  limit: z.number().int().min(1).max(500).optional().describe("Max results. Default 100."),
};

export function registerListDocs(server: McpServer, provider: SearchProvider, ctx: McpContext, scope: SearchScope): void {
  server.tool(
    "list_docs",
    "List docs in the org, one row per doc (the latest allowed-state version). Default returns approved-only. Use this for browsing the corpus; use search_docs to find by content.",
    inputSchema,
    async (args) => {
      const includeUnapproved = resolveIncludeUnapproved(ctx, args.include_unapproved);
      const docs = await provider.listDocs({
        space: args.space,
        repo: args.repo,
        includeUnapproved,
        limit: args.limit,
      }, scope);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ count: docs.length, docs, included_unapproved: includeUnapproved }, null, 2) }],
      };
    },
  );
}
