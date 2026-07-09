import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../auth.js";
import type { DB } from "../../db/client.js";
import type { BlobStore } from "../../blob/store.js";
import { spaces, docs, versions } from "../../db/schema.js";
import { createVersion, type Provenance } from "../../versions/create.js";
import { ProvenanceMetadataSchema } from "@confer/shared";

const inputSchema = {
  space: z.string().min(1).describe("Space slug. The doc's space."),
  slug: z.string().min(1).describe("Doc slug. The doc under that space."),
  html: z.string().min(1).max(5 * 1024 * 1024).describe("The full HTML of the new version. Single-file, inline assets, ≤ 5 MB."),
  title: z.string().min(1).optional().describe("Title used when creating the doc for the first time."),
  metadata: ProvenanceMetadataSchema.optional().describe("Provenance metadata."),
};

export interface PushDocDeps {
  db: DB;
  blobs: BlobStore;
  appOrigin: string;
}

/**
 * Register push_doc. Creates a new in_review version (NEVER approved). If the
 * doc doesn't exist yet, creates it under the named space.
 */
export function registerPushDoc(server: McpServer, deps: PushDocDeps, ctx: McpContext): void {
  server.tool(
    "push_doc",
    "Publish a new version of a doc. Always creates state=in_review; a human owner must approve it. If the doc doesn't exist yet, it's created (with the given title). Returns the version_id and a review_url.",
    inputSchema,
    async (args) => {
      // 1) Find or create the doc.
      const spaceWhere = ctx.orgId
        ? and(eq(spaces.orgId, ctx.orgId), eq(spaces.slug, args.space))
        : and(eq(spaces.ownerId, ctx.ownerId!), eq(spaces.slug, args.space));
      const space = deps.db.select().from(spaces).where(spaceWhere).get();
      if (!space) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "space_not_found" }) }],
        };
      }
      let doc = deps.db
        .select()
        .from(docs)
        .where(and(eq(docs.spaceId, space.id), eq(docs.slug, args.slug)))
        .get();
      if (!doc) {
        const newDocId = crypto.randomUUID();
        deps.db.insert(docs).values({
          id: newDocId,
          spaceId: space.id,
          slug: args.slug,
          title: args.title ?? args.slug,
          createdAt: Date.now(),
        }).run();
        doc = deps.db.select().from(docs).where(eq(docs.id, newDocId)).get();
      }
      if (!doc) {
        return { isError: true, content: [{ type: "text" as const, text: "failed to create or find doc" }] };
      }

      const m = args.metadata ?? {};
      const provenance: Provenance = {
        authorType: m.author_type ?? "agent",
        authorName: m.author,
        tool: m.tool,
        sourceRepo: m.source_repo,
        commitSha: m.commit_sha,
        branch: m.branch,
      };

      const res = await createVersion(
        { db: deps.db, blobs: deps.blobs, appOrigin: deps.appOrigin },
        { orgId: ctx.orgId, spaceId: space.id, docId: doc.id, html: new TextEncoder().encode(args.html), draft: false, provenance },
      );

      // 3) Post-condition: state must be in_review. Defense in depth — even
      // if createVersion is ever changed, the MCP path must never produce
      // approved.
      const inserted = deps.db.select().from(versions).where(eq(versions.id, res.versionId)).get();
      if (inserted?.state !== "in_review") {
        return { isError: true, content: [{ type: "text" as const, text: `MCP invariant violated: push_doc must create in_review, got ${inserted?.state}` }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          version_id: res.versionId,
          number: res.number,
          state: inserted.state,
          review_url: res.reviewUrl,
          deduped: res.deduped,
        }, null, 2) }],
      };
    },
  );
}
