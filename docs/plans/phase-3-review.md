# Phase 3 — Version State Machine, Approve/Reject, History UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Make the review loop real. A space owner can **approve** or **reject** a version from the dashboard; approving transactionally supersedes the previously approved version; the doc's full version history is visible. The state machine, the supersede invariant, and the owner-only check are enforced in code and exhaustively tested.

**Architecture:** No new external services. All state lives in SQLite (Drizzle); all transitions are in `server/src/review/*`; the browser uses a signed session cookie. The view origin is untouched (still no cookies, still no API).

---

## 1. Files

### New
- `server/src/db/schema.ts` — add tables: `users`, `space_owners`, `approvals`, `sessions`
- `server/src/review/state-machine.ts` — pure logic: legal transitions, validator
- `server/src/review/approve.ts` — transactional `approve(versionId, userId)`
- `server/src/review/reject.ts` — transactional `reject(versionId, userId, reason)`
- `server/src/review/queries.ts` — `listHistory(docId)`, `approvedForDoc(docId)`, `isOwner(spaceId, userId)`
- `server/src/auth/sessions.ts` — signed cookie helpers (create, verify)
- `server/src/api/auth.ts` — `POST /api/v1/auth/login` (dev: user_id in body, no password)
- `server/src/api/review.ts` — `POST /api/v1/versions/:id/approve|reject`, `GET /api/v1/spaces/:space/docs/:slug/versions`
- `server/src/api/review.test.ts` — state machine + approve + reject + history tests
- `server/src/auth/sessions.test.ts` — session create/verify, tamper rejection
- `web/src/routes/doc.tsx` — doc history page (all versions, states, actions)
- `web/src/components/VersionRow.tsx` — row with state, author, commit, actions
- `web/src/lib/api.ts` — add `login`, `approve`, `reject`, `listHistory`
- `scripts/e2e-phase3.sh` — full E2E: seed → push v1 → login → approve → push v2 → approve (supersedes v1) → history

### Modified
- `server/src/app.ts` — mount auth + review routes
- `server/src/dev/seed.ts` — create a user, a space_owner, a session; print session cookie value + user_id
- `web/src/routes/review.tsx` — show Approve/Reject buttons when logged in as owner
- `web/src/main.tsx` — route `/d/:space/:slug` → `DocPage`
- `web/src/components/ProvenancePanel.tsx` — show approver + approved_at (when applicable)
- `docs/api-reference.md` — document the new endpoints (defer — once implementation is solid)
- `docs/data-model.md` — reference the new tables (defer)

---

## 2. Schema additions

All in `server/src/db/schema.ts`. Postgres-compatible types (text/integer). All ids are ULIDs.

```ts
users(id, name, email, created_at)
space_owners(space_id, user_id)            // composite PK; only owners approve
approvals(id, version_id, user_id, action, reason, decided_at)   // action: approve | reject
sessions(id, user_id, created_at, expires_at)   // opaque server-side session ids
```

Inline DDL goes into `server/src/db/client.ts` alongside the existing inline DDL.

---

## 3. State machine

```ts
// server/src/review/state-machine.ts
const TRANSITIONS: Record<State, State[]> = {
  draft:       ["in_review"],
  in_review:   ["approved", "rejected"],
  approved:    ["superseded"],
  superseded:  [],
  rejected:    [],
};
export function canTransition(from: State, to: State): boolean { ... }
export function assertTransition(from: State, to: State): void { ... }   // throws
```

Pure; no DB. Tested directly.

---

## 4. Approve / Reject transactions

### `approve(versionId, userId): Promise<void>`

Inside a single `db.transaction(...)`:

1. Load version + doc + space. 404 if any missing.
2. **Owner check** — must be in `space_owners(spaceId, userId)`. Else throw `Forbidden`.
3. `assertTransition(version.state, "approved")` — must be `in_review`.
4. Find any `approved` version for the same doc. If exists: `assertTransition(approved, "superseded")` then `update` its state to `superseded`.
5. `update versions set state='approved' where id=versionId`.
6. `insert approvals (action='approve', userId, decidedAt)`.
7. `insert events (kind='version.approved', payload={versionId, docId, spaceId, prevApprovedId, userId})`.
8. Commit.

If any step throws, the whole transaction rolls back — **the count of approved versions per doc is always 0 or 1, never briefly 2**.

### `reject(versionId, userId, reason): Promise<void>`

Same shape; target state `rejected`; reason stored in `approvals.reason` and `events.payload`.

---

## 5. Authorization

- **Sessions:** server signs `{userId, exp}` with HMAC using `SIGNING_SECRET`; cookie name `confer_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in prod. Verification is constant-time HMAC compare. Expiry 7 days. The session is **not** stored in DB (it doesn't need to be invalidated; rotation is by changing the secret). v0 has no logout/revocation — keep it simple; revoke by rotating `SIGNING_SECRET`.
- **`POST /api/v1/auth/login`:** dev-only. Body `{user_id, name, email}`. If user exists, sign session; else auto-create. **No password** — this is the placeholder for magic-link or GitHub OAuth in v1. Marked with a `// DEV-ONLY` comment + console warning at boot.
- **Approval endpoints:** require session cookie; require `isOwner(spaceId, userId)`. Push/read/mcp **tokens** explicitly cannot approve (enforced by the auth path — they use a different code path that doesn't extract a user).

---

## 6. Endpoints

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | none (dev) | `{user_id, name, email}` | 200 + `Set-Cookie confer_session=...; HttpOnly; SameSite=Lax` |
| POST | `/api/v1/versions/:id/approve` | session + owner | `{}` | 200 `{version_id, state:"approved", superseded_id}` |
| POST | `/api/v1/versions/:id/reject` | session + owner | `{reason}` | 200 `{version_id, state:"rejected"}` |
| GET | `/api/v1/spaces/:space/docs/:slug/versions` | session or `read` token | — | 200 `{doc, versions: [{number, id, state, author, committed_at, approved_by, approved_at, origin}]}` |
| GET | `/api/v1/spaces/:space/docs/:slug` | session or `read` token | — | 200 `{doc, latest_approved?: <version>}` |

---

## 7. Web changes

- `web/src/lib/api.ts` — `login(user_id)`, `approve(versionId)`, `reject(versionId, reason)`, `listHistory(space, slug)`. Login uses `credentials: "include"`. Approve/reject return the updated state; the UI optimistically updates then reconciles.
- `web/src/main.tsx` — client-side route table: `/r/:versionId` → `ReviewPage`, `/d/:space/:slug` → `DocPage`, `/login` → `LoginPage`.
- `web/src/routes/review.tsx` — show Approve / Reject buttons if a session is present and the user owns the doc's space. Use a simple top-right "Logged in as X" pill that links to `/login` if no session.
- `web/src/routes/doc.tsx` — table of all versions, newest first: number, state badge, author, commit short-SHA, age, Approve/Reject buttons for `in_review` rows when the user is an owner. Each row links to `/r/:versionId` to open the viewer.
- `web/src/routes/login.tsx` — minimal form (user_id + name + email); POSTs to `/api/v1/auth/login`; redirects to `/d/backend/auth-flow` on success.

---

## 8. Definition of Done (Phase 3)

Each is a test or an explicit E2E check.

- [ ] `state-machine.test.ts` — every legal transition succeeds; every illegal one throws.
- [ ] `approve.test.ts` — approve moves `in_review → approved`; previous approved becomes `superseded` in the same transaction; the two updates roll back together on a forced failure (test by injecting a throw mid-tx).
- [ ] `approve.test.ts` — non-owner → 403; non-`in_review` target → 409; missing version → 404.
- [ ] `reject.test.ts` — stores reason; writes event; non-owner → 403.
- [ ] `sessions.test.ts` — sign + verify roundtrip; tampered cookie → throws; expired cookie → throws.
- [ ] `review.test.ts` (API) — push/read tokens cannot call approve/reject (403); only session can; owner-only enforced.
- [ ] **Invariant test:** concurrent approve attempts on the same doc never yield 2 approved versions. (Test: spawn N parallel `approve` calls on N distinct `in_review` versions of the same doc; assert final count of approved = 1.)
- [ ] **HTTP E2E:** `scripts/e2e-phase3.sh` runs the full loop (seed → push v1 → login → approve v1 → push v2 → approve v2 → history shows v2 approved + v1 superseded → reject v3 in_review → state machine).
- [ ] `npm test` → 39+ tests pass, all green.
- [ ] `npm run typecheck` → clean.
- [ ] `npm run build` (web) → green; SPA renders the doc history page.
- [ ] Committed in logical chunks.

---

## 9. Sequencing

```
schema (users, space_owners, approvals, sessions)
   └─► state-machine (pure)
        └─► queries (isOwner, listHistory, approvedForDoc)
             └─► sessions (sign/verify)
                  └─► auth route (login)
                       └─► approve + reject (use all of the above)
                            └─► review routes (approve/reject/history/latest)
                                 └─► web: login + doc + review buttons
                                      └─► E2E script + verification
```

---

## 10. Cut order

If we slip, in this order:
1. Login page UI (CLI / curl can drive the loop instead).
2. Optimistic UI updates (re-fetch on success is fine).
3. Sessions table (we can make the cookie self-contained with a longer payload if needed).

**NEVER CUT:** the transactional supersede, the owner-only check, the audit event, the state machine, the invariant test for exactly-one-approved.
