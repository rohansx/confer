// Shared types + schemas across web, server, and cli.
// Phase 1 keeps this minimal; zod schemas for version/provenance/mcp-io land as their phases arrive.

export const CONFER_API_VERSION = "v1" as const;

export type VersionState =
  | "draft"
  | "in_review"
  | "approved"
  | "superseded"
  | "rejected";

export type VersionOrigin = "push" | "suggestion" | "md_convert";

export type TokenScope = "push" | "read" | "mcp";
