import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.js";
import { spaces } from "../../db/schema.js";
import type { McpContext } from "../auth.js";

const inputSchema = {
  space: z.string().min(1).describe("Space slug to fetch the context / system prompt for."),
};

/**
 * get_context — return the free-text context / system prompt a space owner set
 * for the space. The intended framing for an agent chatting with the space's
 * approved docs: call this first, then read docs via get_doc / search_docs.
 * Scoped to the token's org (or personal owner); never leaks another scope.
 */
export function registerGetContext(server: McpServer, db: DB, ctx: McpContext): void {
  server.tool(
    "get_context",
    "Return the space's context / system prompt — the intended framing for chatting with this space's approved docs. Call this first, then read docs with get_doc / search_docs.",
    inputSchema,
    async (args) => {
      const where = ctx.orgId
        ? and(eq(spaces.orgId, ctx.orgId), eq(spaces.slug, args.space))
        : and(eq(spaces.ownerId, ctx.ownerId ?? "__none__"), eq(spaces.slug, args.space));
      const space = db.select().from(spaces).where(where).get();
      if (!space) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "not_found", message: `No space '${args.space}' is visible to this token.` }) }],
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ type: "confer_context", space: space.slug, context: space.context ?? "" }, null, 2) }],
      };
    },
  );
}
