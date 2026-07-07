import type { Notification, Transport } from "./queue.js";

/**
 * Slack webhook transport. No-op unless SLACK_WEBHOOK_URL is set.
 * Posts a tiny message block to the webhook.
 */
export function makeSlackTransport(url: string | undefined): Transport {
  return {
    name: "slack",
    async send(n: Notification) {
      if (!url) return;
      const text = formatSlack(n);
      try {
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch (e) {
        process.stderr.write(`slack notify failed: ${(e as Error).message}\n`);
      }
    },
  };
}

function formatSlack(n: Notification): string {
  const p = n.payload;
  switch (n.kind) {
    case "version.pushed":   return `:inbox_tray: New version of ${p.spaceSlug}/${p.docSlug} (v${p.versionNumber}) needs review.`;
    case "version.approved": return `:white_check_mark: ${p.docSlug} v${p.versionNumber} approved.`;
    case "version.rejected": return `:x: ${p.docSlug} v${p.versionNumber} rejected: ${p.reason ?? "(no reason)"}.`;
    case "comment.created":  return `:speech_balloon: New comment on ${p.spaceSlug}/${p.docSlug}.`;
    default: return `Confer: ${n.kind}`;
  }
}
