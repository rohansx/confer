import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ServerDeps } from "../deps.js";
import type { SearchProvider } from "../search/provider.js";
import { authenticate, type McpContext, McpAuthError } from "./auth.js";
import { readableSpaceIds } from "../auth/access.js";
import { registerSearchDocs } from "./tools/search-docs.js";
import { registerGetDoc } from "./tools/get-doc.js";
import { registerListDocs } from "./tools/list-docs.js";
import { registerPushDoc } from "./tools/push-doc.js";
import { registerGetContext } from "./tools/get-context.js";

export interface BuildMcpOptions {
  /** The FTS-backed search provider. */
  searchProvider: SearchProvider;
}

/**
 * Build a Hono-compatible request handler for the `/mcp` streamable HTTP endpoint.
 * One McpServer is constructed per request (stateless mode), authenticated via
 * the bearer token, and torn down after the response is sent.
 */
export function buildMcpHandler(deps: ServerDeps, opts: BuildMcpOptions) {
  return async function handleMcp(req: Request): Promise<Response> {
    let ctx: McpContext;
    try {
      ctx = await authenticate(deps.db, req);
    } catch (e) {
      if (e instanceof McpAuthError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw e;
    }

    const mcp = new McpServer(
      { name: "confer", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    // Tenant boundary for reads: the spaces this token may see (org token → its
    // org's spaces; owner token → its owner's personal spaces).
    const scope = { spaceIds: readableSpaceIds(deps.db, { kind: "token", orgId: ctx.orgId, ownerId: ctx.ownerId }) };
    registerSearchDocs(mcp, opts.searchProvider, ctx, scope);
    registerGetDoc(mcp, opts.searchProvider, ctx, scope);
    registerListDocs(mcp, opts.searchProvider, ctx, scope);
    registerPushDoc(mcp, { db: deps.db, blobs: deps.blobs, appOrigin: deps.appOrigin }, ctx);
    registerGetContext(mcp, deps.db, ctx);

    // Stateless transport: no session IDs. Each request is independent.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await mcp.connect(transport);
    // Don't close the transport here — that would terminate the SSE response
    // stream before the body is fully consumed. The transport and server are
    // garbage-collected when the response is consumed. For long-running
    // production we'd hook into the response's `end` event to release refs.
    return transport.handleRequest(req);
  };
}
