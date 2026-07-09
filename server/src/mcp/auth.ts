import type { DB } from "../db/client.js";
import { verifyToken, type Scope } from "../auth/tokens.js";

/**
 * Authentication context for an MCP call. The authz layer is responsible for
 * refusing unapproved content unless the caller explicitly opts in AND holds
 * the `unapproved` scope.
 */
export interface McpContext {
  orgId: string | null;
  ownerId: string | null;
  scopes: Scope[];
  /** True if the token has the `unapproved` scope — pre-resolved for the tool layer. */
  canReadUnapproved: boolean;
}

export class McpAuthError extends Error {
  readonly status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; this.name = "McpAuthError"; }
}

/** Extract and validate the bearer token from an incoming request. */
export async function authenticate(db: DB, req: Request): Promise<McpContext> {
  const header = req.headers.get("authorization") ?? "";
  const raw = header.replace(/^Bearer\s+/i, "").trim();
  if (!raw) throw new McpAuthError(401, "missing bearer token");

  const t = await verifyToken(db, raw);
  if (!t) throw new McpAuthError(401, "invalid token");
  if (!t.scopes.includes("mcp")) throw new McpAuthError(403, "mcp scope required");

  return {
    orgId: t.orgId,
    ownerId: t.ownerId,
    scopes: t.scopes,
    canReadUnapproved: t.scopes.includes("unapproved"),
  };
}

/**
 * Resolve the `includeUnapproved` flag in a way that's safe even if the client
 * lies. If the token can't read unapproved, the flag is forced to `false` —
 * the client input is ignored.
 */
export function resolveIncludeUnapproved(ctx: McpContext, requested: unknown): boolean {
  if (!ctx.canReadUnapproved) return false;
  return requested === true;
}
