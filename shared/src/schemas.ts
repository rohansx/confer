// Runtime zod schemas shared by the server's MCP tools and (where useful) the
// REST input validation. Pure validation, no business logic.

import { z } from "zod";

/**
 * Provenance metadata accepted on push (REST `metadata` body field + MCP
 * `push_doc` `metadata` arg). All fields optional — the server fills defaults.
 */
export const ProvenanceMetadataSchema = z.object({
  author_type: z.enum(["human", "agent"]).optional(),
  author: z.string().optional(),
  tool: z.string().optional(),
  source_repo: z.string().optional(),
  commit_sha: z.string().optional(),
  branch: z.string().optional(),
});

/** A text-quote anchor for a comment. `quote` is required; the rest are hints. */
export const AnchorSchema = z.object({
  quote: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  selector: z.string().optional(),
});

export type ProvenanceMetadata = z.infer<typeof ProvenanceMetadataSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;