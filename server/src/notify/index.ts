import { queue, notify, type NotifyKind } from "./queue.js";
import { consoleTransport } from "./email.js";
import { makeSlackTransport } from "./slack.js";

export { queue, notify };
export type { NotifyKind, Notification, Transport } from "./queue.js";

/**
 * One-shot bootstrap. Registers the console transport (always), and the
 * Slack transport if SLACK_WEBHOOK_URL is set. Idempotent — calling twice
 * does not double-register.
 */
let booted = false;
export function bootNotify(env: NodeJS.ProcessEnv = process.env): void {
  if (booted) return;
  booted = true;
  queue.register(consoleTransport);
  queue.register(makeSlackTransport(env.SLACK_WEBHOOK_URL));
}

/** For tests: reset the queue between cases. */
export function resetForTests(): void {
  queue.reset();
  booted = false;
}
