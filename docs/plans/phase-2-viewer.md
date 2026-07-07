# Phase 2 — Two-Origin Sandboxed Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A version's HTML renders inside a sandboxed iframe served from the **content origin** via a **signed, short-lived URL**, with the exact CSP and zero cookies — the never-cut security core (see [../security.md §1](../security.md#1-malicious-doc--session-theft)).

**Architecture:** One process, two hostnames. A host dispatcher routes the content origin to a viewer that serves blobs behind HMAC-signed URLs with a strict CSP and no cookies; the app origin keeps the API. A React review page hosts the sandboxed iframe plus provenance chrome.

**Tech Stack:** Hono host routing · `node:crypto` HMAC-SHA256 signed URLs · Vite + React (review page) · the exact CSP + `sandbox="allow-scripts"`.

## Global Constraints

Inherit [../implementation-plan.md](../implementation-plan.md#global-constraints). Most relevant:
- Content origin is a **separate registrable domain**; configured via `VIEW_ORIGIN`.
- **CSP (exact, byte-for-byte):** `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;`
- **Iframe sandbox (exact):** `sandbox="allow-scripts"` only.
- **Zero cookies** on the content origin.
- Blobs served **only** via signed, short-lived, org-scoped URLs; no listing, no guessable paths.

---

### Task 1: Exact CSP constant + signed-URL primitives
- `server/src/viewer/csp.ts` — `CONTENT_CSP` (the exact string).
- `server/src/viewer/signed-url.ts` — `signContentUrl(viewOrigin, secret, hash, orgId, ttlSec, now?)` and `verifyContent(secret, hash, o, e, s, now?)` using HMAC-SHA256 over `hash.orgId.exp`, timing-safe compare, expiry check. `now` is injectable for deterministic tests.
- Tests: round-trip; tampered sig → null; cross-org (swap orgId, keep sig) → null; expired → null; wrong hash → null.

### Task 2: Viewer content route
- `server/src/viewer/serve.ts` — `viewerRoutes(deps)` with `GET /c/:hash`: verify signed query → 403 on failure; 404 on absent blob; else stream bytes with `content-type: text/html; charset=utf-8`, `CONTENT_CSP`, `x-content-type-options: nosniff`, **no Set-Cookie**.
- Tests: 200 + exact CSP + no cookies + body; unsigned → 403; tampered → 403; absent blob → 404.

### Task 3: Host dispatcher (two-origin isolation)
- `server/src/deps.ts` — `ServerDeps { db, blobs, appOrigin, viewOrigin, signingSecret }`.
- `server/src/server.ts` — `buildServer(deps)`: dispatch by `Host` header — view host → viewer app; else → app. Content routes unreachable on the app host and API/health unreachable on the view host.
- Tests: `/health` on app host → 200; signed `/c/:hash` on view host → 200 + CSP; `/health` on view host → 404; `/c/:hash` on app host → 404.

### Task 4: App endpoint — version detail + signed content URL
- `server/src/api/version-detail.ts` — `GET /api/v1/versions/:id` (read scope): join version→doc→space, org-scope to the token's org, return metadata + provenance + a freshly `signContentUrl`'d `content_url` (TTL 300s).
- Tests: 200 with metadata + content_url; 401 without token; cross-org token → 404.

### Task 5: React review page (chrome)
- `web/` Vite + React workspace. `web/src/routes/review.tsx` reads a version id, fetches detail, renders: title, `StateBadge`, `ProvenancePanel` (repo/sha/tool/author), and the sandboxed iframe (`sandbox="allow-scripts"`, `src=content_url`).
- `web/src/components/{StateBadge,ProvenancePanel}.tsx`.
- DoD: `vite build` + typecheck green; iframe uses the exact sandbox; page renders the doc via the signed URL.

---

## Phase 2 Definition of Done
- [ ] Content served only from the view host; **no Set-Cookie** there (asserted).
- [ ] CSP header matches the exact string **byte-for-byte** (asserted).
- [ ] Signed URL expires (expired → 403); tampered/cross-org sig → 403/null; unsigned/guessed → 403/404.
- [ ] Review route shows title, state badge, version selector, provenance panel.
- [ ] Iframe uses `sandbox="allow-scripts"`.
