# Confer v0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps in the per-phase plans use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete Confer loop — an agent pushes an HTML doc, a human reviews and approves it, and other agents read only the approved corpus via MCP with full provenance.

**Architecture:** One TypeScript monorepo, one Hono/Node process serving a Vite+React SPA, a REST API, an MCP endpoint, auth, and a signed-URL content origin. SQLite (Drizzle, WAL) is the system of record; a content-addressed blob store holds immutable HTML; a **second registrable domain** sandboxes user content. See [architecture.md](./architecture.md).

**Tech Stack:** TypeScript · Hono (Node) · Vite + React (TanStack Query/Router, Radix/shadcn) · Drizzle + SQLite (WAL) + litestream · SQLite FTS5 · `@modelcontextprotocol/sdk` (streamable HTTP) · blake3 · `diff-match-patch` · Resend/SES · `p-queue`.

---

## Global Constraints

Every task inherits these. Values are copied verbatim from the spec.

- **Language:** TypeScript end-to-end. One monorepo: `shared/`, `server/`, `web/`, `cli/`. One deploy (single process in prod).
- **Two origins:** app origin (`app.tryconfer.com`) and content origin (`view.conferusercontent.com`) — the content origin is a **separate registrable domain, never a subdomain**. Configured via env: `APP_ORIGIN`, `VIEW_ORIGIN`.
- **Content limits:** single-file HTML, inline assets, **5 MB cap** per version.
- **Content addressing:** blake3 hash → blob path `blobs/ab/cd/<hash>`. Writes idempotent; content immutable.
- **CSP on served content (exact):** `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;`
- **Iframe sandbox (exact):** `sandbox="allow-scripts"` only.
- **Zero cookies** on the content origin.
- **DB portability:** SQLite now, but Postgres-compatible schema — no SQLite-only idioms in business logic. `id`s are application-generated ULIDs.
- **Token scopes:** `push`, `read`, `mcp`. Tokens hashed at rest. **No token scope can approve** — approval is human-only, API-enforced, space-owner-only.
- **The product invariant:** no MCP read path returns unapproved content unless `include_unapproved: true` AND token scope allows. Every response carries `approved_by`, `approved_at`, `commit_sha`.
- **File size:** many small focused files (200–400 lines typical, 800 max); organize by feature/domain.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Frequent commits.

---

## File structure (target end-state)

```
confer/
├── package.json                 # npm workspaces; scripts: dev, build, test, lint, typecheck
├── tsconfig.base.json
├── docker-compose.yml           # self-host: app container + volume, two origins via env
├── Caddyfile                    # reverse proxy, both hostnames (cloud)
├── .env.example                 # APP_ORIGIN, VIEW_ORIGIN, DB_PATH, BLOB_DIR, SIGNING_SECRET, ...
├── shared/
│   └── src/
│       ├── schemas/             # zod: version, provenance, comment, token, mcp-io, api-envelope
│       └── types/
├── server/
│   └── src/
│       ├── index.ts             # entry; binds APP_ORIGIN + VIEW_ORIGIN routing
│       ├── config.ts            # env parsing + validation (fail fast)
│       ├── db/
│       │   ├── schema.ts        # drizzle tables (see data-model.md)
│       │   ├── migrations/
│       │   ├── client.ts        # WAL pragma, connection
│       │   └── queries/         # one file per aggregate: docs, versions, comments, tokens...
│       ├── blob/
│       │   ├── store.ts         # BlobStore interface
│       │   ├── disk.ts          # disk CAS adapter
│       │   ├── s3.ts            # S3 adapter (cloud)
│       │   └── hash.ts          # blake3
│       ├── auth/
│       │   ├── tokens.ts        # create/verify/hash, scope checks
│       │   ├── session.ts       # cookie sessions (app origin)
│       │   ├── magic-link.ts
│       │   └── github-oauth.ts
│       ├── api/                 # /api/v1 route handlers (one file per resource)
│       ├── mcp/
│       │   ├── server.ts        # SDK wiring, streamable HTTP
│       │   └── tools/           # search_docs, get_doc, list_docs, push_doc
│       ├── review/
│       │   ├── state-machine.ts # legal transitions only
│       │   ├── approve.ts       # transactional approve+supersede+audit
│       │   └── events.ts        # audit trail writer
│       ├── search/
│       │   ├── provider.ts      # SearchProvider interface
│       │   ├── fts5.ts          # FTS5 impl
│       │   └── extract.ts       # readability-style text extraction
│       ├── notify/
│       │   ├── queue.ts         # p-queue
│       │   ├── email.ts         # Resend/SES adapter
│       │   └── slack.ts         # per-space webhook
│       ├── viewer/
│       │   ├── serve.ts         # view. origin content serving + CSP headers
│       │   └── signed-url.ts    # mint/verify signed short-lived URLs
│       └── diff/
│           └── word-diff.ts     # extract → diff-match-patch
├── web/
│   └── src/
│       ├── routes/              # dashboard, space, doc, review, settings, login
│       ├── components/          # DiffViewer, ProvenancePanel, CommentSidebar, StateBadge...
│       ├── viewer-overlay/      # injected into iframe: selection → postMessage → comment
│       └── lib/                 # query client, api hooks, auth
└── cli/
    └── src/                     # login (device code), push, open, status, skill install
```

---

## Phase 0 — Pre-build gates (blockers, not code)

These must clear **before the first public commit**. See [roadmap.md](./roadmap.md#open-questions--pre-build-checklist).

- [ ] **Utkrusht IP** — close the inventions-disclosure loop with Naman. **Hard blocker.**
- [ ] **License decision** — Apache 2.0 (leaning) vs AGPL; add `LICENSE` + "Confer" trademark note.
- [ ] **Grab names** — `confer` (or `confer-cli`) on npm, the GitHub org, and the `view.` domain (`conferusercontent.com`).
- [ ] **Re-verify Anthropic third-party auth policy** (only gates v1 BYOK, not v0 — but confirm now).

---

## Phase 1 — Foundation: scaffold, schema, blob store, push API, token auth
**Days 1–3 · target start 2026-07-17** · Detailed plan: [plans/phase-1-foundation.md](./plans/phase-1-foundation.md)

**Deliverable:** `confer push`'s server side works end to end — an authenticated `push`-scoped token creates an immutable, content-addressed, deduped version row with provenance, returning a review URL.

**Files:** monorepo scaffold; `shared/src/schemas/*`; `server/src/config.ts`, `db/schema.ts` + migrations + `client.ts`, `blob/{store,disk,hash}.ts`, `auth/tokens.ts`, `api/versions.ts`, `search/extract.ts` + `fts5.ts` (index-on-push).

**Interfaces produced (later phases rely on these exact signatures):**
- `BlobStore.put(bytes: Uint8Array): Promise<string>` (returns blake3 hex), `.get(hash): Promise<Uint8Array>`, `.signedUrl(hash, ttlSec): string`.
- `createVersion(input): Promise<{ versionId: string; reviewUrl: string }>` — hashes, dedupes, writes blob, inserts row (`in_review`|`draft`) + provenance, indexes FTS.
- `verifyToken(raw): Promise<{ orgId; scopes: Scope[] } | null>`; `requireScope(scope)` middleware.

**Definition of Done:**
- `POST /api/v1/spaces/:space/docs/:slug/versions` with a `push` token returns `{ version_id, review_url }`.
- Re-posting identical bytes returns the **same** version (idempotency test passes).
- Version row is immutable; provenance persisted; text indexed into FTS5.
- >5 MB body rejected; missing/invalid token rejected; token missing `push` scope rejected.
- `npm test`, `npm run typecheck`, `npm run lint` green.

---

## Phase 2 — Two-origin sandboxed viewer, CSP, signed blob URLs
**Days 4–6 · target 2026-07-22 → 07-24**

**Deliverable:** A version's HTML renders inside a sandboxed iframe served from the content origin via a signed short-lived URL, with the exact CSP and zero cookies. **Never-cut security core.**

**Files:** `server/src/viewer/{serve,signed-url}.ts`; `server/src/index.ts` (host-based routing for `VIEW_ORIGIN`); `web/src/routes/review.tsx` (iframe host); `web/src/components/{ProvenancePanel,StateBadge}.tsx`.

**Interfaces produced:**
- `signContentUrl(hash, orgId, ttlSec): string` and `verifyContentUrl(url): { hash, orgId } | null`.
- Content route emits headers: exact CSP, `X-Content-Type-Options: nosniff`, no `Set-Cookie`.

**Definition of Done:**
- Content served only from `VIEW_ORIGIN`; app cookies never present there (test asserts no `Set-Cookie`).
- Iframe uses `sandbox="allow-scripts"`; CSP header matches the exact string in Global Constraints (asserted byte-for-byte).
- Signed URL expires (expired URL → 403 test); cross-org signature rejected; unsigned/guessed path → 404/403.
- Review route shows: title, state badge, version selector, provenance panel (repo/sha/tool/author).

---

## Phase 3 — Version state machine, approve/reject, history UI
**Days 7–9 · target 2026-07-25 → 07-29**

**Deliverable:** Owners approve/reject; approval transactionally supersedes the previous approved version and writes an audit event; the doc's version history is visible.

**Files:** `server/src/review/{state-machine,approve,events}.ts`; `server/src/api/review.ts`; `server/src/db/queries/versions.ts` (approved-count guard); `web/src/routes/doc.tsx` (history), `components/StateBadge.tsx`.

**Interfaces produced:**
- `transition(versionId, to: State, actor): Promise<void>` — rejects illegal transitions.
- `approve(versionId, ownerUserId): Promise<void>` — one transaction: version→approved, prev approved→superseded, insert approval + audit event, enqueue notify.
- `reject(versionId, ownerUserId, reason): Promise<void>`.

**Definition of Done (invariant tests — see [data-model.md §4](./data-model.md#4-invariants-enforced-in-code-and-tests)):**
- Exactly one `approved` per doc, always (concurrent-approve test never yields 2).
- Only legal transitions succeed; every illegal transition rejected.
- Approve requires space ownership (non-owner → 403); `push`/`mcp`/`read` tokens cannot approve.
- Reject stores reason; audit events written for approve/reject.

---

## Phase 4 — MCP server (4 tools, repo filter) + approved-only invariant tests
**Days 10–12 · target 2026-07-30 → 08-01**

**Deliverable:** Agents use `search_docs`, `get_doc`, `list_docs`, `push_doc` over streamable HTTP with an `mcp` token; **the approved-only invariant is enforced and exhaustively tested.**

**Files:** `server/src/mcp/server.ts`; `server/src/mcp/tools/*.ts`; `server/src/search/provider.ts` (state-filtered queries); MCP auth binding to token scope.

**Interfaces consumed:** `createVersion` (Phase 1) for `push_doc`; `SearchProvider` (Phase 1) for `search_docs`; `BlobStore.get` for `get_doc`.

**Definition of Done:**
- All 4 tools registered and callable over `/mcp` with an `mcp`-scoped token.
- `search_docs`/`get_doc`/`list_docs` return **approved-only** by default; every result carries `approved_by`, `approved_at`, `commit_sha`.
- `include_unapproved: true` returns unapproved **only** with a scope that allows it; otherwise ignored/denied.
- `repo` filter returns the live docs for that repo.
- `push_doc` creates `in_review`, **never** `approved` (test asserts state).
- Doc HTML wrapped in a data envelope in responses.

---

## Phase 5 — CLI + SKILL.md + `confer skill install`
**Days 13–15 · target 2026-08-02 → 08-06**

**Deliverable:** `npm i -g confer` gives `login / push / open / status / skill install`, auto-detecting git provenance; the Claude skill publishes and consumes correctly.

**Files:** `cli/src/{login,push,open,status,skill-install}.ts`; `cli/src/git.ts` (remote + `rev-parse HEAD` + branch); `cli/SKILL.md`.

**Definition of Done:**
- `confer login` completes device-code auth and stores a token.
- `confer push <file> --space --slug [--draft]` detects repo/SHA/branch, posts a version, prints the review URL.
- `confer status` lists this repo's docs and states; `confer open` opens the review URL.
- `confer skill install` writes `SKILL.md` to the local skills dir.
- Manual loop test: skill-driven agent pushes a doc and retrieves an approved one via MCP.

---

## Phase 6 — Diff view (extracted-text word diff)
**Days 16–18 · target 2026-08-07 → 08-09**

**Deliverable:** Side-by-side rendered versions plus a readable word-level diff with collapsed unchanged regions.

**Files:** `server/src/diff/word-diff.ts`; `server/src/api/diff.ts`; `web/src/components/DiffViewer.tsx`.

**Interfaces produced:** `wordDiff(aHtml, bHtml): DiffSegment[]` — readability extraction on each side, then `diff-match-patch` word diff.

**Definition of Done:**
- Review UI shows v(N) vs v(N-1): rendered side-by-side + word diff.
- Unchanged regions collapse; added/removed segments visually distinct.
- Diff computed from extracted text (not raw HTML tags). *(Semantic DOM diff is explicitly phase 2 — out of scope here.)*

---

## Phase 7 — Comments (anchoring), notifications, self-host, demo polish
**Days 19–21 · target 2026-08-10 → 08-13**

**Deliverable:** Anchored resolvable comments that carry across versions; email + Slack notifications; `docker compose up` self-host; the 90-second demo is clean.

**Files:** `server/src/api/comments.ts`; `server/src/db/queries/comments.ts`; `web/src/viewer-overlay/*` (selection → postMessage → anchor); `web/src/components/CommentSidebar.tsx`; `server/src/notify/{queue,email,slack}.ts`; `docker-compose.yml`, `Caddyfile`, `.env.example`, README.

**Definition of Done:**
- Selecting text in the sandboxed iframe creates an anchored comment (quote + prefix/suffix + selector) via postMessage.
- Anchor degrades to doc-level with an "anchor lost" marker when the quote can't be re-found; unresolved threads carry to new versions.
- Email sent on review-requested / comment / decision; one Slack webhook per space fires.
- `docker compose up` boots the app with both origins on one container + volume.
- The full 90-second loop ([overview.md §4](./overview.md#the-90-second-demo-loop)) runs clean end to end.

---

## Sequencing & dependencies

```
Phase 1 (foundation) ──┬─► Phase 2 (viewer)  ──► Phase 3 (approve) ──► Phase 4 (MCP) ──► Phase 5 (CLI/skill)
                       │                                    ▲                              │
                       └──────────────────────────────────┘                              ▼
                                                                       Phase 6 (diff) ─┐
                                                                       Phase 7 (comments/notify/self-host) ─► DEMO
```

- Phases 2, 3, 4 all depend on Phase 1's `createVersion` + `BlobStore` + token auth.
- Phase 4 (MCP) depends on Phase 3's approved state existing to test the approved-only invariant meaningfully.
- Phases 6 and 7 are largely independent of each other and can interleave; both depend on Phases 2–3.

---

## Cut order if slipping

Cut from the **end** of this list first; **never** cross the line.

1. Notifications (Phase 7)
2. Diff polish (Phase 6 — keep a minimal diff, cut collapsing/side-by-side niceties)
3. Comment anchoring (Phase 7 — fall back to doc-level comments)

> **NEVER CUT:** two-origin content security (Phase 2), approval states (Phase 3), approved-only MCP (Phase 4).

---

## Testing strategy

- **TDD throughout** — every task starts with a failing test (per Global Constraints). Target the repo's 80% coverage bar, with **100% on the invariants**.
- **Invariant test suite** (a dedicated file) asserts each item in [data-model.md §4](./data-model.md#4-invariants-enforced-in-code-and-tests): one-approved-per-doc, immutability, legal transitions only, suggestions-never-approved, approved-only MCP reads, owner-only approval. These are the tests that must never be red.
- **Security assertions** (Phase 2): exact CSP string, `sandbox="allow-scripts"`, no cookies on content origin, signed-URL expiry and cross-org rejection.
- **Loop test** (Phase 5/7): scripted end-to-end run of the 90-second loop as the acceptance test for the whole v0.
- **Unit** for pure logic (hashing, diff, anchoring, state machine); **integration** for API + MCP + DB; the loop test as E2E.

---

## Execution

Each phase is a self-contained, independently testable slice — the right unit for a fresh-subagent review gate. Recommended: **subagent-driven development** (one subagent per phase/task, review between). The detailed, bite-sized TDD steps for Phase 1 live in [plans/phase-1-foundation.md](./plans/phase-1-foundation.md); expand each subsequent phase into its own `plans/phase-N-*.md` at the moment you start it (keeps plans honest against what Phase 1 actually produced).

---

## Self-review against the spec

- **Spec §6.1 (Publish API + CLI)** → Phases 1 (API) + 5 (CLI). ✅
- **§6.2 (Viewer, security)** → Phase 2. ✅
- **§6.3 (Review & diff)** → Phases 3 (review) + 6 (diff). ✅
- **§6.4 (Comments)** → Phase 7. ✅
- **§6.5 (MCP)** → Phase 4. ✅
- **§6.6 (Search/auth/notifications)** → search+FTS in Phase 1/4, auth in Phases 1–3, notifications in Phase 7. ✅
- **§8 (Architecture)** → file structure + all phases. ✅
- **§9 (Data model)** → Phase 1 schema; invariants across 1/3/4. ✅
- **§10 (Security)** → Phase 2 (origins/CSP/signed URLs) + token model in Phase 1. ✅
- **§11 (Skill)** → Phase 5. ✅
- **§14 (Build plan)** → Phases 1–7 map 1:1 to the day ranges. ✅
- **v1 features (§7)** → out of v0 by design; see [roadmap.md](./roadmap.md). ✅
