# Per-version session/transcript context — design

**Date:** 2026-07-15
**Status:** approved (design), pending implementation plan
**Scope:** Phase 1 of "chat-with-docs". Ships the decision context that a local
MCP agent and (later) an in-dashboard chat panel read to explain *why* a doc
says what it says. Phase 2 (in-dashboard chat + LLM provider config: Anthropic /
MiniMax / Ollama / custom) is a **separate spec** and explicitly out of scope here.

## Problem

A Confer doc records *what* was written and its git/tool provenance, but not the
prompts/agent session that produced it. When a human or agent later chats with
the doc, they cannot see *why* a specific decision was made. The review UI
already anticipates this: the **Context tab** is a placeholder reading
"Session · prompt trail — transcript not attached (opt-in)", and the CLI already
has an ignored `--session` flag (`cli/src/push.ts`: `session?: string; // v1: … v0: ignored`).

## Approach

Attach the exported session/transcript to the **version** being pushed — it is
provenance, exactly like `commit_sha`. Each revision carries the exact session
that produced it. Store the (potentially large) transcript in the existing
content-addressed blob store; reference it by hash from the version row.

Chosen over alternatives: *per-document one record* (loses the version↔session
link) and *typed-text-only* (loses the raw session, which is the point). Per the
brainstorming decision on 2026-07-15.

## Data model

Add one nullable column to `versions` (`server/src/db/schema.ts`) + inline
migration (`server/src/db/client.ts`, guarded by `colExists`, like `spaces.context`):

```
versions.session_hash TEXT   -- blob hash of the raw session transcript, or NULL
```

The transcript is stored in the blob store (`deps.blobs`) content-addressed by
its own hash — the same store and hashing path used for doc HTML. No new table.
The transcript is opaque text/markdown (the raw export); Confer does not parse it.

## Write path

Single core, three entry points.

### Core: `createVersion` (`server/src/versions/create.ts`)
- `CreateVersionInput` gains `session?: Uint8Array`.
- When present: write it to the blob store (`await deps.blobs.put(bytes)` →
  hash), set `session_hash` on the inserted version row.
- **Size cap:** reject sessions > 2 MB with a clear error (mirror the existing
  5 MB HTML cap check).
- **Dedupe rule:** identical HTML dedupes to the existing version (no new row).
  If a session is provided AND the existing (deduped) version has
  `session_hash IS NULL`, attach the new session to that existing version
  (single `UPDATE`). Otherwise leave the existing version untouched. This makes
  "push same content but now with a session" attach the session without forcing
  a spurious version.

### CLI: `confer push <file> --session ./confer-oc-session.md`
- `cli/src/push.ts` already threads `session?: string` (a path). Implement it:
  read the file, pass its bytes to the publish call.
- `cli/src/api.ts` `publishVersion` sends the session (see wire format below).

### MCP: `push_doc` (`server/src/mcp/tools/push-doc.ts`)
- Add an optional `session: z.string()` arg (the transcript text). Passed
  through to `createVersion` as bytes.

### Dashboard Upload (`web/src/routes/Upload.tsx`)
- In the collapsed **Advanced** section, add an optional "Attach session log"
  file input (`.md`, `.txt`, `.json`). If chosen, its text is sent with the push.
- `web/src/lib/api.ts` `uploadVersion` gains an optional `session?: string`.

### Wire format (REST publish: `POST /api/v1/spaces/:space/docs/:slug/versions`)
Extend the JSON body with an optional `session` string field (the raw
transcript). `server/src/api/versions.ts` decodes it to bytes and passes it to
`createVersion`. Same 2 MB cap enforced server-side (never trust the client).

## Read path

### REST
- `GET /api/v1/versions/:id` (`server/src/api/version-detail.ts`) adds
  `has_session: boolean` to its response.
- **New:** `GET /api/v1/versions/:id/session` → returns the raw transcript as
  `text/plain; charset=utf-8`, `Cache-Control: no-store`. Gated by the **existing
  doc-read authorization** used by version-detail (session or read-scoped token
  that can read the doc's space). A caller who cannot read the doc → 404 (same
  shape as version-detail's not-found). 404 if the version has no session.
- The transcript is served from the **app origin behind auth** — never the
  view/content origin. It is not public.

### Review UI — Context tab (`web/src/routes/Review.tsx`)
- Replace the placeholder. When `has_session`, fetch `…/session` and render the
  transcript (monospace, preserved whitespace, scrollable). Show a small
  "visible to anyone who can read this doc" note. When absent, show the current
  empty-state copy.

### MCP — `get_doc` (`server/src/mcp/tools/get-doc.ts` + provider)
- `Fts5Provider.getDoc` (`server/src/search/provider.ts`) already resolves a
  version; add a `has_session: boolean` to `GetDocResult` (cheap — just whether
  `session_hash` is set) and, **only when explicitly requested**, the session
  text.
- `get_doc` gains an optional arg `include_session: z.boolean()` (**default
  false**). Default responses stay lean; `has_session` in the envelope tells an
  agent the "why" exists, and it re-calls with `include_session: true` to pull
  it. This avoids inlining up to 2 MB of transcript into every `get_doc`.
- `get_doc`'s envelope (`server/src/mcp/envelope.ts`) gains optional
  `has_session` + `session` fields. Scoping is unchanged — `get_doc` already runs
  through the tenant `SearchScope`, so a session only ever reaches a caller
  allowed to read that space.

## Access & safety

- **Visibility:** identical to comments/provenance — anyone who can read the doc
  (org member, space owner, personal owner, read/mcp-scoped token in the tenant).
  Not public; the view origin never serves it.
- **Opt-in:** a session is attached only if the pusher supplies one.
- **Redaction is out of scope for Phase 1.** Transcripts may contain secrets;
  we do NOT scrub them. Mitigations: (a) the app-origin + auth gate above; (b) a
  visible "visible to doc readers" warning in the Upload field and Context tab;
  (c) a `docs/` note. A redaction hook is a named follow-up.
- **Size cap:** 2 MB, enforced server-side.

## Testing (vitest, no new frameworks)

Server:
- `createVersion` writes `session_hash` + blob when session provided; leaves it
  NULL otherwise.
- Dedupe: identical HTML with a session, existing version has none → session
  attached to the existing version (no new row). Existing already has one → left.
- Size cap: > 2 MB session rejected.
- `GET /versions/:id` → `has_session` correct.
- `GET /versions/:id/session` → 200 + transcript for an authorized reader; 404
  for an outsider; 404 when no session.
- MCP `get_doc`: default response has `has_session: true` but no `session`;
  with `include_session: true` the transcript is returned. Tenant isolation still
  holds (out-of-scope token cannot reach it even with the flag — rides existing
  SearchScope tests).

CLI:
- `confer push --session <file>` round-trips (session readable back via the API).

Web: no unit-test harness for routes today; verify Upload/Context tab manually
(consistent with existing web practice).

## Files touched (estimate)

- `server/src/db/schema.ts`, `server/src/db/client.ts` (column + migration)
- `server/src/versions/create.ts` (session write + dedupe rule)
- `server/src/api/versions.ts` (accept `session` in publish body)
- `server/src/api/version-detail.ts` (`has_session` + `/session` endpoint)
- `server/src/search/provider.ts`, `server/src/mcp/tools/get-doc.ts`,
  `server/src/mcp/envelope.ts` (surface session over MCP)
- `server/src/mcp/tools/push-doc.ts` (accept `session` arg)
- `cli/src/push.ts`, `cli/src/api.ts` (implement `--session`)
- `web/src/lib/api.ts`, `web/src/routes/Upload.tsx`, `web/src/routes/Review.tsx`
  (attach + render)
- tests alongside the above

## Out of scope (Phase 2 — separate spec)

- In-dashboard chat panel.
- LLM provider configuration in Settings (Anthropic via Agent SDK / subscription,
  MiniMax token, Ollama base URL, custom OpenAI-compatible provider), key storage
  + encryption, streaming, cost controls.
- Transcript redaction.
