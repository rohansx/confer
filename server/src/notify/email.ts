import type { Notification, Transport } from "./queue.js";

/**
 * Console transport — always registered. Emits a single-line JSON record per
 * notification. Production environments should swap this for an SMTP/Postmark
 * transport; the `name` and `send` shape stay the same.
 */
export const consoleTransport: Transport = {
  name: "console",
  send(n: Notification) {
    process.stdout.write(`NOTIFY ${JSON.stringify({ kind: n.kind, orgId: n.orgId, payload: n.payload, at: n.at })}\n`);
  },
};
