/**
 * The exact Content-Security-Policy served with user HTML on the content origin.
 * Byte-for-byte per docs/security.md §1 — no external fetches from docs in v0.
 * Do not loosen without a deliberate, per-space, opt-in decision.
 */
export const CONTENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;";
