# Confer — Architecture

How the pieces fit, the flows that move data between them, why each technology was chosen, and how it deploys. For the data at rest, see [data-model.md](./data-model.md); for the trust boundaries, see [security.md](./security.md).

---

## 1. System diagram

```
                        ┌─────────────────────────────────────────────┐
                        │              app.tryconfer.com               │
                        │   Hono server (serves built Vite+React SPA)  │
   Browser ───────────▶ │  ├─ Auth (magic link, GitHub OAuth)          │
   (dashboard, review)  │  ├─ REST API   /api/v1/*                     │
                        │  ├─ MCP endpoint  /mcp  (TS SDK, HTTP)       │
   confer CLI ────────▶ │  ├─ Review/state machine + audit events      │
   (push, status)       │  ├─ Search (FTS5)                            │
                        │  ├─ Notifier (email, Slack webhooks)         │
   Agents (MCP) ──────▶ │  └─ LLM gateway (BYOK, server-side) [v1]     │
                        └──────┬───────────────┬──────────────┬────────┘
                               │               │              │
                        ┌──────▼─────┐  ┌──────▼──────┐  ┌────▼──────────┐
                        │  SQLite    │  │ Blob store  │  │ Org LLM creds │
                        │ (Drizzle,  │  │ CAS on disk │  │ (encrypted)   │
                        │ litestream)│  │ blake3 →    │  │  [v1]         │
                        │  + FTS5    │  │ S3 adapter  │  │               │
                        └────────────┘  └──────┬──────┘  └───────────────┘
                                               │ signed, short-lived URLs
                        ┌──────────────────────▼──────────────────────┐
                        │        view.conferusercontent.com            │
                        │  User HTML in sandboxed iframes              │
                        │  zero cookies · strict CSP · comment overlay │
                        └─────────────────────────────────────────────┘
```

**Two hostnames, one process (v0).** Everything is served by a single Hono/Node process. The *content* origin (`view.conferusercontent.com`) is a **separate registrable domain**, not a subdomain — this is the security keystone (see [security.md §1](./security.md#1-malicious-doc--session-theft)). In production the same process answers both hostnames; the browser's same-origin policy does the isolation.

---

## 2. Component responsibilities

| Component | Owns | Notes |
|---|---|---|
| **Auth** | Magic-link + GitHub OAuth login, session cookies (app origin only), org membership & invites | Cookies never touch the content origin. |
| **REST API** (`/api/v1/*`) | Publish, versions, approve/reject, comments, search, tokens, spaces/orgs | Token- or session-authenticated. See [api-reference.md](./api-reference.md). |
| **MCP endpoint** (`/mcp`) | The 4 agent tools; enforces the approved-only invariant | Streamable HTTP, official TS SDK, same process. |
| **Review / state machine** | The only code allowed to transition a version's state; emits audit events | Transitions are transactional (see [data-model.md §3](./data-model.md#3-version-state-machine)). |
| **Search** | FTS5 index over extracted text; filter by space/state/repo | Behind a `SearchProvider` interface so embeddings swap in later. |
| **Notifier** | Email (review-requested / comment / decision) + one Slack webhook per space | In-process queue; no Redis in v0. |
| **LLM gateway** (v1) | Server-side BYOK inference for chat-with-doc | Decrypts org creds only here; never ships keys to the browser. |
| **SQLite + FTS5** | System of record: orgs, spaces, docs, versions, provenance, comments, approvals, tokens, events | WAL mode; litestream → S3 for backup. |
| **Blob store** | Immutable content blobs, content-addressed by blake3 | `blobs/ab/cd/<hash>` on disk behind a storage interface; S3 adapter for cloud. |
| **Viewer** (`view.` origin) | Renders user HTML in a sandboxed iframe with a comment overlay | Zero cookies, strict CSP, content fetched via signed URLs. |

---

## 3. Key flows

### 3.1 Push (CLI / skill / MCP `push_doc` → new version)

```
CLI/skill ──POST /api/v1/spaces/:space/docs/:slug/versions (token: push scope)
   → hash content (blake3)
   → dedupe by hash (idempotent — same content = same version, no dup)
   → write blob to CAS (blobs/ab/cd/<hash>)
   → insert version row (state = in_review | draft) + provenance
        (+ redacted session context in v1)
   → extract text → index into FTS5
   → enqueue notify(space owners)
   → return { version_id, review_url }
```

Idempotent by content hash: re-pushing identical bytes returns the existing version instead of creating a duplicate. Single-file HTML with inline assets, **5 MB cap**.

### 3.2 Review (browser → approve)

```
Browser loads version metadata from app origin
   → viewer iframe loads content from view. origin via a signed URL
   → overlay script reports text selections via postMessage
   → comments stored against the doc with anchors (quote + prefix/suffix + selector)
   → owner clicks Approve
   → TRANSACTION:
        version           → approved
        prev approved     → superseded
        insert approval row
        insert audit event
        enqueue notify
```

The state transition and the supersede of the previous approved version happen in **one transaction** — the "exactly one approved version per doc" invariant can never be briefly violated.

### 3.3 MCP read (agent pulls approved context)

```
Agent ──/mcp (token: mcp scope)
   → search_docs → FTS query FILTERED to state = 'approved' (+ space/repo filters)
   → get_doc     → stream blob + provenance (default: latest approved)

Unapproved content requires BOTH:
   include_unapproved: true  AND  a token scope that permits it.
Every response carries approved_by, approved_at, commit_sha.
```

This is **the product invariant**. It's enforced in the query layer *and* covered by dedicated tests (see [implementation-plan.md](./implementation-plan.md) Phase 4).

### 3.4 Chat-with-doc (v1 → suggestion)

```
Browser chat panel ──POST app server
   → LLM gateway loads org BYOK creds (decrypt server-side only)
   → prompt = doc HTML + session summary + user thread
   → user clicks "propose change"
   → LLM regenerates affected HTML
   → pushed INTERNALLY as a suggestion version (origin = suggestion)
   → enters the normal in_review pipeline → owner approves/rejects
```

Preserves the no-editing invariant: every change is a *regeneration with provenance*, reviewed by an owner. Suggestions never auto-approve.

---

## 4. Tech choices (and why)

| Layer | Choice | Why |
|---|---|---|
| **Language** | TypeScript end-to-end | One language, one monorepo (`web/`, `server/`, `shared/`), one deploy; best MCP SDK. |
| **Dev setup** | `vite dev` proxying `/api` + `/mcp` to Hono | Standard split; prod remains one process. |
| **Frontend** | Vite + React SPA (`web/`) | Biggest OSS contributor pool; TanStack Query/Router, Radix/shadcn for review UI, mature diff-viewer components. |
| **Backend** | Hono on Node (`server/`) | Tiny, fully typed, end-to-end type sharing with the SPA via `shared/`; API + MCP + auth + signed URLs in one process; serves the built SPA in prod (single container). |
| **ORM / DB** | Drizzle + SQLite (WAL) + litestream → S3 backup | Zero-ops self-host; schema kept Postgres-compatible for cloud multi-tenant later. |
| **Search** | SQLite FTS5 | Free, good enough; embeddings behind the same interface in phase 2. |
| **Blob store** | Content-addressed dir (`blobs/ab/cd/<blake3>`) behind a storage interface | Immutability for free via CAS; S3 adapter for cloud. |
| **MCP** | `@modelcontextprotocol/sdk`, streamable HTTP | Official, mature, same process. |
| **Diff** | Readability-style extraction + `diff-match-patch` word diff | Ship-able in days; semantic DOM diff is the phase-2 moat. |
| **Sanitizer (md path, v1)** | remark/rehype + rehype-sanitize | Deterministic, no LLM. |
| **Email** | Resend / SES adapter | Trivial volume. |
| **Jobs** | In-process queue (`better-queue` / `p-queue`) | No Redis in v0; notifier + FTS indexing are the only async work. |
| **Crypto** | blake3 (hashing); libsodium sealed boxes or AES-GCM w/ per-org DEK (LLM creds, v1) | Keys never reach the browser. |
| **Deploy (cloud)** | Single VM (Hetzner / Fly) + Caddy, two hostnames | Boring wins. |
| **Deploy (self-host)** | `docker compose up`: app container + volume; both origins via env | The one-command promise. |

---

## 5. Monorepo layout

npm workspaces; one language, one install, one build.

```
confer/
├── package.json                 # workspace root; scripts: dev, build, test, lint
├── docker-compose.yml           # self-host: app container + volume, two origins via env
├── Caddyfile                    # reverse proxy, both hostnames (cloud)
├── docs/                        # ← these docs
├── shared/                      # types + zod schemas shared by web + server
│   ├── src/schemas/             # version, provenance, comment, token, mcp io
│   └── src/types/
├── server/                      # Hono app (API + MCP + auth + viewer origin)
│   ├── src/
│   │   ├── index.ts             # app entry; binds both hostnames
│   │   ├── db/                  # drizzle schema + migrations + queries
│   │   ├── blob/                # CAS storage interface + disk + s3 adapters
│   │   ├── auth/                # magic link, github oauth, sessions, tokens
│   │   ├── api/                 # /api/v1 route handlers
│   │   ├── mcp/                 # /mcp tools (search/get/list/push)
│   │   ├── review/             # state machine + approvals + audit events
│   │   ├── search/              # SearchProvider iface + fts5 impl
│   │   ├── notify/              # email + slack adapters + in-process queue
│   │   ├── viewer/              # view. origin: signed-url content serving + CSP
│   │   └── llm/                 # BYOK gateway (v1)
│   └── test/
├── web/                         # Vite + React SPA
│   ├── src/
│   │   ├── routes/              # dashboard, space, doc, review, settings
│   │   ├── components/          # review UI, diff viewer, provenance panel, comments
│   │   ├── viewer-overlay/      # script injected into the iframe for selection→comment
│   │   └── lib/                 # TanStack Query client, api hooks
│   └── index.html
└── cli/                         # `confer` npm package
    └── src/                     # login (device code), push, open, status, skill install
```

**Rule of thumb** (per repo coding standards): many small, focused files (200–400 lines typical, 800 max), organized by feature/domain, not by technical layer.

---

## 6. Scaling notes (so nothing blocks growth)

- **SQLite WAL** handles this read-heavy, low-write workload far past 100 self-hosted orgs. Cloud multi-tenant migrates to **Postgres via Drizzle** with the *same* schema (kept Postgres-compatible from day one).
- **Blobs are immutable** → CDN-cacheable behind signed URLs later.
- **MCP is stateless** → horizontal scale is trivial once the DB moves to Postgres.
- **Search** sits behind a pluggable `SearchProvider` interface *now*, so embeddings / pgvector swap in without touching callers.
- **Jobs** move from in-process queue to a real queue only when notifier volume demands it — not before.

---

## 7. Deployment

### Cloud (hosted, later)
Single VM (Hetzner / Fly) + **Caddy** terminating TLS for both hostnames → one Hono process. litestream streams SQLite to S3. Blobs on disk (or S3 adapter). This is deliberately boring; it scales to the cloud-multi-tenant milestone before needing Postgres.

### Self-host (the strategic wedge)
```bash
docker compose up
```
One app container + one volume. Both origins configured via environment variables (`APP_ORIGIN`, `VIEW_ORIGIN`). This is a **never-cut** promise: compliance-constrained teams (DPDP / EU) self-host, and html-docs structurally can't follow without cannibalizing their cloud.

---

Continue to [data-model.md](./data-model.md) for the schema and invariants, or [security.md](./security.md) for the trust boundaries.
