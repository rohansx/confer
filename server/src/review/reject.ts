import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { newId } from "../db/client.js";
import { versions, approvals, events, docs, spaces } from "../db/schema.js";
import { assertTransition, IllegalTransitionError, type State } from "./state-machine.js";
import { isOwner } from "./queries.js";
import { isOrgAdmin } from "../auth/access.js";
import { ForbiddenError, NotFoundError, ConflictError } from "./approve.js";
import { notify } from "../notify/index.js";

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
    const space = tx.select().from(spaces).where(eq(spaces.id, doc.spaceId)).get();

    // Review privilege: org admin, or a space_owner (legacy grant).
    if (!isOwner(tx, doc.spaceId, args.userId) && !(space?.orgId ? isOrgAdmin(db, space.orgId, args.userId) : false)) {
      throw new ForbiddenError("not an org admin / space owner");
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
      orgId: space?.orgId ?? "",
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

    queueMicrotask(() => {
      notify({
        kind: "version.rejected",
        orgId: space?.orgId ?? "",
        payload: {
          versionId: v.id,
          versionNumber: v.number,
          docId: v.docId,
          docSlug: doc.slug,
          spaceId: doc.spaceId,
          spaceSlug: space?.slug,
          approverId: args.userId,
          reason: args.reason,
        },
      });
    });

    return { versionId: v.id, state: "rejected", rejectedAt: decidedAt };
  });
}
