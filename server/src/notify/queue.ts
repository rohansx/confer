/**
 * In-process notification queue with pluggable transports. Every event that
 * matters for the user (review requested, approved, rejected, comment) is
 * pushed onto this queue and dispatched to all registered transports in a
 * microtask. If a transport throws, the others continue.
 */

export type NotifyKind =
  | "version.pushed"
  | "version.approved"
  | "version.rejected"
  | "comment.created";

export interface Notification {
  kind: NotifyKind;
  orgId: string;
  payload: Record<string, unknown>;
  at: number;
}

export interface Transport {
  name: string;
  send(n: Notification): Promise<void> | void;
}

class NotifyQueue {
  private transports: Transport[] = [];
  /** For tests: a captured list of all emitted notifications. */
  public readonly emitted: Notification[] = [];

  register(t: Transport): void {
    if (this.transports.find((x) => x.name === t.name)) return;
    this.transports.push(t);
  }

  emit(kind: NotifyKind, orgId: string, payload: Record<string, unknown>): void {
    const n: Notification = { kind, orgId, payload, at: Date.now() };
    this.emitted.push(n);
    // Fire-and-forget; transports must not throw past their own boundary.
    queueMicrotask(async () => {
      for (const t of this.transports) {
        try { await t.send(n); } catch { /* ignore */ }
      }
    });
  }

  reset(): void {
    this.transports = [];
    this.emitted.length = 0;
  }

  transportCount(): number { return this.transports.length; }
}

export const queue = new NotifyQueue();

/** Public emit API. */
export function notify(args: { kind: NotifyKind; orgId: string; payload: Record<string, unknown> }): void {
  queue.emit(args.kind, args.orgId, args.payload);
}
