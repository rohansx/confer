import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { versions, approvals, events, docs } from "../db/schema.js";
import { assertTransition, IllegalTransitionError, type State } from "./state-machine.js";
import { isOwner } from "./queries.js";
import { ForbiddenError, NotFoundError, ConflictError } from "./approve.js";

export interface RejectResult {
  versionId: string;
  state: "rejected";
  rejectedAt: number;
}

/**
 * Reject a version transactionally. Same shape as approve(): owner check,
 * state-machine check, then state flip + approvals + events, all in one tx.
 */
export function reject(
  db: DB,
  args: { versionId: string; userId: string; reason: string; now: number },
): RejectResult {
  return db.transaction((tx) => {
    const v = tx.select().from(versions).where(eq(versions.id, args.versionId)).get();
    if (!v) throw new NotFoundError("version not found");
    const doc = tx.select().from(docs).where(eq(docs.id, v.docId)).get();
    if (!doc) throw new NotFoundError("doc not found");

    if (!isOwner(tx, doc.spaceId, args.userId)) {
      throw new ForbiddenError("not a space owner");
    }

    try {
      assertTransition(v.state as State, "rejected");
    } catch (e) {
      if (e instanceof IllegalTransitionError) {
        throw new ConflictError(`version is ${v.state}, not in_review`);
      }
      throw e;
    }

    tx.update(versions).set({ state: "rejected" }).where(eq(versions.id, v.id)).run();

    const decidedAt = args.now;
    tx.insert(approvals).values({
      id: newId(),
      versionId: v.id,
      userId: args.userId,
      action: "reject",
      reason: args.reason,
      decidedAt,
    }).run();

    tx.insert(events).values({
      id: newId(),
      orgId: "",
      kind: "version.rejected",
      payloadJson: JSON.stringify({
        versionId: v.id,
        docId: v.docId,
        spaceId: doc.spaceId,
        userId: args.userId,
        reason: args.reason,
      }),
      createdAt: decidedAt,
    }).run();

    return { versionId: v.id, state: "rejected", rejectedAt: decidedAt };
  });
}
