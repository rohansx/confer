import { Hono } from "hono";
import type { ServerDeps } from "../deps.js";
import { CONTENT_CSP } from "./csp.js";
import { verifyContent } from "./signed-url.js";
import { VIEWER_OVERLAY_SCRIPT } from "./overlay.js";

/**
 * Content-origin routes. Serves user HTML behind a signed URL with the strict
 * CSP and — critically — no cookies. This app is only ever reached on the view
 * host (see server.ts), so the app's session cookies never touch this origin.
 *
 * The viewer overlay (a tiny inline script) is injected at serve time. The
 * CSP `script-src 'unsafe-inline'` allows it. The script is read-only with
 * respect to the doc: it observes selections and posts them to the parent.
 */
export function viewerRoutes(deps: ServerDeps): Hono {
  const r = new Hono();

  r.get("/c/:hash", async (c) => {
    const hash = c.req.param("hash");
    const ok = verifyContent(
      deps.signingSecret,
      hash,
      c.req.query("o"),
      c.req.query("e"),
      c.req.query("s"),
    );
    if (!ok) return c.text("forbidden", 403);
    if (!(await deps.blobs.has(hash))) return c.text("not found", 404);

    const bytes = await deps.blobs.get(hash);
    const html = new TextDecoder().decode(bytes);
    const wrapped = injectOverlay(html);
    const body = new TextEncoder().encode(wrapped).buffer as ArrayBuffer;
    // In overlay (maximize) mode the page hosts a bridge iframe back to the app
    // origin so the comments sidebar can reach the cookie-bearing API. Allow
    // only that origin in frame-src; everything else stays locked down.
    const app = c.req.query("app");
    let appOrigin = "";
    try { const u = new URL(app ?? ""); if (u.protocol === "http:" || u.protocol === "https:") appOrigin = u.origin; } catch { /* ignore */ }
    const csp = appOrigin
      ? `${CONTENT_CSP} frame-src ${appOrigin};`
      : CONTENT_CSP;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=60",
      },
    });
  });

  return r;
}

/**
 * Insert the viewer overlay script just before </body>, or before </html>
 * if there's no body. If neither is present, append to the end.
 */
export function injectOverlay(html: string): string {
  const overlay = VIEWER_OVERLAY_SCRIPT;
  const lower = html.toLowerCase();
  const bodyClose = lower.lastIndexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + overlay + html.slice(bodyClose);
  }
  const htmlClose = lower.lastIndexOf("</html>");
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + overlay + html.slice(htmlClose);
  }
  return html + overlay;
}
