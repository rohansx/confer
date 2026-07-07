import { Hono } from "hono";
import type { ServerDeps } from "../deps.js";
import { CONTENT_CSP } from "./csp.js";
import { verifyContent } from "./signed-url.js";

/**
 * Content-origin routes. Serves user HTML behind a signed URL with the strict
 * CSP and — critically — no cookies. This app is only ever reached on the view
 * host (see server.ts), so the app's session cookies never touch this origin.
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
    // Normalize to a plain ArrayBuffer — Uint8Array isn't cleanly assignable to
    // the DOM BodyInit union under @types/node.
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": CONTENT_CSP,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=60",
      },
    });
  });

  return r;
}
