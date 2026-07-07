import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { versions, approvals, events, docs } from "../db/schema.js";
import { assertTransition, IllegalTransitionError, type State } from "./state-machine.js";
import { isOwner } from "./queries.js";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(msg = "forbidden") { super(msg); this.name = "ForbiddenError"; }
}
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(msg = "not found") { super(msg); this.name = "NotFoundError"; }
}
export class ConflictError extends Error {
  readonly status = 409;
  constructor(msg: string) { super(msg); this.name = "ConflictError"; }
}

export interface ApproveResult {
  versionId: string;
  state: "approved";
  supersededId: string | null;
  approvedAt: number;
}

/**
 * Approve a version transactionally:
 *  1) assert caller is a space owner
 *  2) assert the version is in_review
 *  3) supersede any currently-approved sibling version
 *  4) flip this version to approved
 *  5) record an approvals row + an events row
 *
 * All in a single transaction — count of approved per doc is always 0 or 1.
 */
export function approve(
  db: DB,
  args: { versionId: string; userId: string; now: number },
): ApproveResult {
  return db.transaction((tx) => {
    const v = tx.select().from(versions).where(eq(versions.id, args.versionId)).get();
    if (!v) throw new NotFoundError("version not found");
    const doc = tx.select().from(docs).where(eq(docs.id, v.docId)).get();
    if (!doc) throw new NotFoundError("doc not found");

    if (!isOwner(tx, doc.spaceId, args.userId)) {
      throw new ForbiddenError("not a space owner");
    }

    try {
      assertTransition(v.state as State, "approved");
    } catch (e) {
      if (e instanceof IllegalTransitionError) {
        throw new ConflictError(`version is ${v.state}, not in_review`);
      }
      throw e;
    }

    // Supersede the previously-approved version, if any, in the same transaction.
    const prev = tx
      .select()
      .from(versions)
      .where(and(eq(versions.docId, v.docId), eq(versions.state, "approved")))
      .get();
    let supersededId: string | null = null;
    if (prev) {
      assertTransition(prev.state as State, "superseded");
      tx.update(versions).set({ state: "superseded" }).where(eq(versions.id, prev.id)).run();
      supersededId = prev.id;
    }

    tx.update(versions).set({ state: "approved" }).where(eq(versions.id, v.id)).run();

    const decidedAt = args.now;
    tx.insert(approvals).values({
      id: newId(),
      versionId: v.id,
      userId: args.userId,
      action: "approve",
      reason: null,
      decidedAt,
    }).run();

    tx.insert(events).values({
      id: newId(),
      orgId: "", // orgId is filled in via a join at query time; not used by review loop
      kind: "version.approved",
      payloadJson: JSON.stringify({
        versionId: v.id,
        docId: v.docId,
        spaceId: doc.spaceId,
        supersededId,
        userId: args.userId,
      }),
      createdAt: decidedAt,
    }).run();

    return { versionId: v.id, state: "approved", supersededId, approvedAt: decidedAt };
  });
}
