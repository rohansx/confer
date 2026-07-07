# Phase 6 + 7 — Diff view, comments, notifications, self-host, demo polish

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Close out the v0 deliverable. After this phase: a reviewer can see a word-level diff between any two versions, anchor comments to selected text that carry across versions, get email/Slack notifications on the events that matter, and self-host the whole thing with `docker compose up`. The 90-second demo runs clean end to end.

**Architecture:** No new external services. `diff-match-patch` for the word diff. Text-quote anchor matching is a small in-house utility (find `quote` in target text with `prefix`/`suffix` context). Notifications are queued in-memory with pluggable transports (email = console log; slack = POST to webhook; nothing fires when no transport is configured). Self-host: single image, `docker compose up`, Caddy terminates TLS and routes by Host header to the two ports.

---

## 1. Files

### Phase 6 — Diff

- `server/src/diff/word-diff.ts` — `wordDiff(a: string, b: string): DiffSegment[]`; `wordDiffHtml(aHtml, bHtml): DiffSegment[]` (extract first)
- `server/src/diff/word-diff.test.ts` — pure logic tests
- `server/src/api/diff.ts` — `GET /api/v1/spaces/:space/docs/:slug/diff?from=N&to=M`
- `server/src/api/diff.test.ts`
- `web/src/components/DiffViewer.tsx` — side-by-side rendered + word-diff inline; collapsible unchanged regions
- Wire into `web/src/routes/review.tsx`

### Phase 7 — Comments, notifications, self-host

- `server/src/db/schema.ts` — add `comments` table (id, doc_id, version_id_created_on, parent_id, author_user_id, body, anchor_quote, anchor_prefix, anchor_suffix, anchor_selector, resolved_at, created_at)
- `server/src/db/client.ts` — add inline DDL for `comments` + index
- `server/src/comments/anchor.ts` — `resolveAnchor(anchor, currentText): {start, end, lost}` — finds `quote` in current text, prefers matches with matching `prefix`/`suffix`
- `server/src/comments/anchor.test.ts`
- `server/src/comments/queries.ts` — `listForDoc(docId, includeResolved)`, `createComment`, `resolveComment`, `threadReplies(parentId)`
- `server/src/api/comments.ts` — `POST /api/v1/comments`, `GET /api/v1/spaces/:space/docs/:slug/comments`, `POST /api/v1/comments/:id/resolve`, `POST /api/v1/comments/:id/replies`
- `server/src/api/comments.test.ts`
- `server/src/notify/queue.ts` — in-process queue + transport interface
- `server/src/notify/email.ts` — console-log transport (always works)
- `server/src/notify/slack.ts` — webhook transport (no-op if not configured)
- `server/src/notify/index.ts` — public API: `notifyReviewRequested`, `notifyApproved`, `notifyRejected`, `notifyComment`
- `server/src/notify/notify.test.ts`
- Wire into `server/src/versions/create.ts`, `server/src/review/approve.ts`, `server/src/review/reject.ts`
- `web/src/components/CommentSidebar.tsx` — list comments per doc, add comment with anchor payload, resolve thread, reply
- `web/src/viewer-overlay/select.ts` — tiny in-iframe script (NOT shipped to view origin; loaded via the dashboard) that posts the selection to the parent. (Note: the view origin CSP allows `unsafe-inline`, so this works when injected.)
- `web/src/components/CommentComposer.tsx` — the modal/form for posting a comment with quote/prefix/suffix
- Wire into `web/src/routes/review.tsx` and `web/src/routes/doc.tsx`
- `docker-compose.yml` — single service (app+viewer), volume for data, Caddy as reverse proxy
- `Caddyfile` — routes by Host header to the two ports
- `.env.example` — add `SLACK_WEBHOOK_URL` (optional)
- `README.md` — Quickstart, the 90-second demo, self-host instructions
- `scripts/e2e-phase7.sh` — full loop including anchored comment + resolution + notification

### Modified
- `server/src/server.ts` — initialize the notify module on boot
- `server/src/index.ts` — boot notifications
- `web/src/routes/review.tsx` — add comment composer, sidebar, diff button
- `web/src/styles.css` — diff highlighting classes

---

## 2. Phase 6 — Diff design

```ts
// word-diff.ts
export interface DiffSegment {
  op: "equal" | "insert" | "delete";
  text: string;
}

export function wordDiff(a: string, b: string): DiffSegment[];

// Extracts text from HTML using the existing extractText() and then word-diffs.
export function wordDiffHtml(aHtml: string, bHtml: string): DiffSegment[];
```

Implementation: use `diff-match-patch` (`diff_main` + `diff_cleanupSemantic`) to produce word-level segments. Collapse runs of equal text longer than ~80 chars to a "collapsed" segment with `collapsed: true` — rendered as `… (N unchanged words) …` in the UI.

API:
```
GET /api/v1/spaces/:space/docs/:slug/diff?from=N&to=M
Auth: read scope OR session
Returns: {
  from: { number, state, ... },
  to:   { number, state, ... },
  segments: DiffSegment[],     // collapsed equals have collapsed: true
  html: { from: string, to: string }  // for side-by-side render
}
```

UI (`DiffViewer.tsx`):
- Inline word diff (read mode) with `<ins>` and `<del>` styling
- Toggle: side-by-side | inline | unified
- Collapsed unchanged regions: clickable to expand

---

## 3. Phase 7 — Comments design

Schema:
```sql
comments(
  id, doc_id, version_id_created_on, parent_id,           -- null = root thread
  author_user_id, body,
  anchor_quote, anchor_prefix, anchor_suffix, anchor_selector,  -- all nullable
  resolved_at, created_at
)
```

Anchor resolution (`anchor.ts`):
```ts
export interface Anchor { quote: string; prefix?: string; suffix?: string; selector?: string; }
export interface ResolvedAnchor { start: number; end: number; lost: boolean; }
// 1) Find first exact match of `quote` in text
// 2) If multiple matches: prefer the one whose preceding/following N chars match `prefix`/`suffix`
// 3) If still ambiguous: pick the first (deterministic)
// 4) If no match: return { lost: true, start: -1, end: -1 }
// 5) Returns character offsets into the *extracted text* (so the comment carries across versions)
```

API:
```
POST   /api/v1/spaces/:space/docs/:slug/comments
       body: { body, anchor?, parent_id? }
       auth: session
       returns: { id, version_id_created_on, ... }

GET    /api/v1/spaces/:space/docs/:slug/comments
       query: ?include_resolved=true|false
       auth: session OR read
       returns: { comments: [...], threads: [...] }

POST   /api/v1/comments/:id/resolve   auth: session (any owner of the doc's space)
POST   /api/v1/comments/:id/replies   auth: session; body: { body, anchor? }
```

Comment carries across versions: the `version_id_created_on` is the version the comment was first posted on; when the dashboard shows the latest version, the comments endpoint also re-resolves the anchor against the latest version's text and reports `anchor_lost: true` if the quote can't be found.

UI flow:
1. In the viewer iframe, user selects text.
2. The viewer-overlay script (loaded by the dashboard into the iframe via a small injected script) detects the selection and posts `{type:"selection", quote, prefix, suffix}` to the parent window.
3. The dashboard catches the message, shows the comment composer with the quote pre-filled.
4. On submit, the dashboard POSTs to /api/v1/comments with the anchor payload.
5. The comment sidebar lists all comments, with "anchor lost" markers for ones that didn't carry over.

---

## 4. Phase 7 — Notifications design

```ts
// notify/queue.ts
export interface Notification { kind: string; orgId: string; payload: Record<string, unknown>; }
export interface Transport { send(n: Notification): Promise<void>; }

export class NotifyQueue {
  add(n: Notification): void;
  register(t: Transport): void;
  // Drains on a microtask cycle. If a transport throws, log and move on.
}
```

Built-in transports:
- `email` — always registered; "sends" by logging to stdout in a structured format (`NOTIFY: kind=… org=… payload=…`). In production, wire to SMTP/Postmark.
- `slack` — registered only if `SLACK_WEBHOOK_URL` is set. POSTs a tiny JSON message.

Hooks:
- `versions.create` → `notifyReviewRequested(orgId, spaceSlug, docSlug, versionId, authorName)` — fires on push when state is `in_review`
- `review.approve` → `notifyApproved(orgId, spaceSlug, docSlug, versionId, approverName)`
- `review.reject` → `notifyRejected(orgId, spaceSlug, docSlug, versionId, approverName, reason)`
- `comments.create` → `notifyComment(orgId, spaceSlug, docSlug, commentId, authorName)`

These are emitted from the existing transactional code (approve/reject/createVersion) — fire-and-forget. Tests assert the queue receives the right kind of notification for each event.

---

## 5. Self-host: docker-compose

`docker-compose.yml`:
- One service `confer`:
  - image: `node:22-bookworm` (in-repo Dockerfile builds the image)
  - depends_on: nothing
  - volumes: `./data:/app/data`, `./blobs:/app/blobs`
  - ports: 80 (Caddy) → 5173 (app) and 5174 (view) — single port externally
  - env: from .env
- A `Dockerfile` (multi-stage) that builds the monorepo, then runs `node server/dist/index.js`

`Caddyfile` (in-repo, mounted):
```
:80 {
  @view host view.*
  @app host app.*  app.localhost
  handle @view { reverse_proxy localhost:5174 }
  handle          { reverse_proxy localhost:5173 }
}
```

For local dev (`docker compose up`), the user adds `app.localhost` and `view.localhost` to `/etc/hosts`. The seeded login/token instructions in the README walk them through it.

---

## 6. Definition of Done (Phases 6 + 7)

- [ ] `word-diff.test.ts`: insertion/deletion/equal/mixed; HTML stripped; collapsed long equals
- [ ] `diff.test.ts`: API returns segments + both htmls
- [ ] `anchor.test.ts`: exact match; ambiguous match resolved by prefix/suffix; not found → lost
- [ ] `comments.test.ts`: create + list + resolve + reply; carry-across-versions: anchor resolves on new version; lost on missing
- [ ] `notify.test.ts`: register transport; each event kind emits; transport throws → others continue
- [ ] `DiffViewer.tsx` renders side-by-side + inline + collapsed
- [ ] `CommentSidebar.tsx` shows threads; add comment with quote; resolve; reply
- [ ] `docker-compose.yml` + `Caddyfile` + `Dockerfile` build; `docker compose up` boots the full app (tested locally if Docker is available; else lint the files)
- [ ] `README.md` documents Quickstart, the 90-second demo, and self-host
- [ ] `scripts/e2e-phase7.sh` — full loop including an anchored comment + resolve
- [ ] `npm test` → 132+ tests pass
- [ ] `npm run typecheck` → clean
- [ ] `npm run build` → all four workspaces compile
- [ ] Committed in logical chunks

---

## 7. Sequencing

```
diff (pure logic + tests) + diff API
  └─► DiffViewer + wire into review page
       └─► comments schema + DDL
            └─► anchor (pure) + tests
                 └─► comments queries + API + tests
                      └─► CommentSidebar + composer + viewer-overlay
                           └─► notify queue + transports + wire into events + tests
                                └─► docker-compose + Caddyfile + Dockerfile
                                     └─► README
                                          └─► E2E phase-7
```

---

## 8. Cut order

1. Side-by-side render can be minimal (one column inline first; split-view as a stretch).
2. Comments can fall back to doc-level (no anchor) if the resolver is too slow. The resolver is tiny so this is unlikely.
3. Email transport can be a console log; slack optional via env.
4. Docker polish can come last; the app runs fine with `npm start` already.

**NEVER CUT:** the word-diff on extracted text, the anchor resolver, the comment schema + carry-across-versions, the notify queue (even if transports are stubs), or the `docker-compose` self-host recipe (even if we can't `docker build` in CI without a Docker daemon).
