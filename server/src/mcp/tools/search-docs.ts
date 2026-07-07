import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../auth.js";
import { resolveIncludeUnapproved } from "../auth.js";
import type { SearchProvider } from "../../search/provider.js";

const inputSchema = {
  query: z.string().min(1).describe("Full-text search query. Matches against extracted text in approved docs (or all states if the token has the unapproved scope and include_unapproved=true)."),
  space: z.string().optional().describe("Filter to a specific space slug."),
  repo: z.string().optional().describe("Filter to versions pushed from a specific source repo."),
  include_unapproved: z.boolean().optional().describe("Include non-approved versions. Requires the token's `unapproved` scope; ignored otherwise."),
  limit: z.number().int().min(1).max(100).optional().describe("Max results. Default 20."),
};

export function registerSearchDocs(server: McpServer, provider: SearchProvider, ctx: McpContext): void {
  server.tool(
    "search_docs",
    "Full-text search over approved Confer docs. Returns snippets, provenance, and approval metadata. By default returns ONLY approved content — this is the product invariant. Pass include_unapproved=true only if the token has the unapproved scope.",
    inputSchema,
    async (args) => {
      const includeUnapproved = resolveIncludeUnapproved(ctx, args.include_unapproved);
      const hits = await provider.search({
        query: args.query,
        space: args.space,
        repo: args.repo,
        includeUnapproved,
        limit: args.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ count: hits.length, hits, included_unapproved: includeUnapproved }, null, 2) }],
      };
    },
  );
}
