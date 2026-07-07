# Confer — Data Model

The system of record. SQLite via Drizzle, schema kept **Postgres-compatible** so cloud multi-tenant is a migration, not a rewrite. Content lives in a content-addressed blob store; everything else lives in these tables.

For how data moves, see [architecture.md §3](./architecture.md#3-key-flows). For the concepts these tables encode, see [overview.md §5](./overview.md#5-core-concepts).

---

## 1. Schema (Drizzle / SQL sketch)

```sql
orgs(id, name, slug, theme_json, created_at)
users(id, email, name, github_id, created_at)
org_members(org_id, user_id, role)                    -- admin | member
spaces(id, org_id, slug, name, required_approvals, theme_json_override)
space_owners(space_id, user_id)                       -- CODEOWNERS-style; only owners approve
docs(id, space_id, slug, title, created_at)
versions(
  id, doc_id, number,                                 -- number: monotonic per doc
  blob_hash,                                          -- blake3 → blob store
  state,                                              -- draft|in_review|approved|superseded|rejected
  origin,                                             -- push|suggestion|md_convert
  author_type, author_name, tool,                     -- provenance: who/what produced it
  source_repo, commit_sha, branch,                    -- provenance: git context
  session_summary_json,                               -- v1: prompt trail summary (redacted)
  session_transcript_blob,                            -- v1: optional, opt-in, redacted → blob store
  suggested_by_user_id,                               -- v1: for origin=suggestion
  pushed_at
)
approvals(id, version_id, user_id, action, reason, created_at)   -- action: approve | reject
comments(id, doc_id, version_id_created_on, parent_id,
         author_user_id, author_agent_name, body,
         anchor_quote, anchor_prefix, anchor_suffix, anchor_selector,
         resolved_at, created_at)
tokens(id, org_id, name, hash, scopes, created_by, last_used_at) -- scopes: push|read|mcp
llm_credentials(id, org_id, provider, encrypted_key, model_default, created_at)  -- v1
chat_threads(id, doc_id, user_id, messages_json, created_at)                     -- v1
events(id, org_id, kind, payload_json, created_at)    -- audit trail
docs_fts(...)                                         -- FTS5 virtual table over extracted text
```

### Column notes

- **`versions.number`** — monotonic per doc (1, 2, 3…). Human-facing "v3". Never reused, never renumbered.
- **`versions.blob_hash`** — the blake3 hash of the content bytes; the pointer into the CAS blob store. Two versions with identical content share a blob.
- **`versions.origin`** — how the version came to exist: `push` (CLI/MCP), `suggestion` (chat-with-doc, v1), `md_convert` (deterministic md→html, v1).
- **`comments.version_id_created_on`** — the version a comment was first anchored to. Unresolved threads *carry over* to newer versions; this records where it started.
- **`comments.anchor_*`** — text-quote anchoring: exact `quote` plus `prefix`/`suffix` context and a CSS `selector`. Degrades gracefully to doc-level with an "anchor lost" marker if the quote can't be re-found.
- **`tokens.hash`** — tokens are hashed at rest, never stored in plaintext. `scopes` is the set of `push` / `read` / `mcp`.
- **`llm_credentials.encrypted_key`** (v1) — encrypted with a per-org DEK (AES-GCM or libsodium sealed box); decrypted only in the server-side LLM gateway, never sent to the browser.
- **`events`** — append-only audit trail: push, approve, reject, token-use, and (v1) llm-call. This is both a debugging tool and an enterprise/compliance feature.

---

## 2. Entity relationships

```
orgs ─1:N─ spaces ─1:N─ docs ─1:N─ versions ─1:N─ approvals
  │           │                       │
  │           └─N:M─ users            ├─1:N─ comments (via doc + anchored to a version)
  │        (space_owners)             └─(provenance columns, inline)
  │
  ├─1:N─ tokens
  ├─1:N─ llm_credentials      (v1)
  ├─1:N─ events
  └─N:M─ users (org_members, with role)
```

---

## 3. Version state machine

A version's `state` is the heart of the review workflow. **Only the review module may transition state**, and it does so transactionally.

```
                 push (--draft)
        ┌──────────────► draft ──────────┐
        │                                │ submit
   (create)                             ▼
        │                          in_review ──────► rejected
        └──────────────►           │   ▲              (with reason)
              push (default)       │   │
                        approve    │   │ new version pushed
                                   ▼   │
                              approved │
                                   │   │
              newer version         │  │
              approved              ▼  │
                              superseded
```

**Legal transitions (and *only* these):**

| From | To | Trigger |
|---|---|---|
| *(none)* | `draft` | push with `--draft` |
| *(none)* | `in_review` | push (default) |
| `draft` | `in_review` | author submits for review |
| `in_review` | `approved` | space owner approves |
| `in_review` | `rejected` | space owner rejects (with reason) |
| `approved` | `superseded` | a newer version of the same doc is approved |

There is **no** path back out of `rejected` or `superseded` — a new version is pushed instead. This is the "linear versions, no branching" decision from [overview.md §2](./overview.md#2-anti-scope-deliberate-cuts-with-reasons).

---

## 4. Invariants (enforced in code **and** tests)

These are non-negotiable. Each has a corresponding test in the suite (Phase 3–4 of the [plan](./implementation-plan.md)).

1. **Exactly one `approved` version per doc.** Approving version N supersedes the previously approved version in the *same transaction* — the count of approved versions per doc is always 0 or 1, never briefly 2.
2. **Versions are immutable after insert.** No column of a `versions` row (except `state`, which the state machine owns) is ever updated. Content is content-addressed, so "edit" is impossible by construction — a change is a new version.
3. **Only legal state transitions occur** (the table in §3). Any other transition is a bug and is rejected at the boundary.
4. **Suggestions can never be created in `approved` state.** `origin = suggestion` versions always enter as `in_review` and go through owner approval.
5. **MCP reads default to approved-only.** No MCP read path returns unapproved content unless the caller passes `include_unapproved: true` *and* holds a token scope that allows it. This is *the* product invariant — see [api-reference.md §MCP](./api-reference.md#3-mcp-server).
6. **Only space owners approve.** Approval requires the acting user to be in `space_owners` for the doc's space; enforced server-side, API-level (never client-trusted).

---

## 5. Content-addressed blob store (CAS)

Content bytes never live in the database — only their hash does.

- **Path scheme:** `blobs/ab/cd/<blake3-hex>` (first two byte-pairs as directory shards to avoid huge flat dirs).
- **Immutability for free:** the filename *is* the hash. Writing is idempotent — the same bytes always land at the same path, so dedupe is automatic and re-pushing identical content is a no-op write.
- **Interface, not implementation:** all access goes through a `BlobStore` interface (`put(bytes) → hash`, `get(hash) → bytes`, `signedUrl(hash, ttl)`). Disk adapter for v0/self-host; S3 adapter for cloud. Callers never know which.
- **Served only via signed, short-lived, org-scoped URLs** from the `view.` origin — no public listing, no guessable URLs (see [security.md §2](./security.md#2-blob-url-guessing)).
- **What lives in blobs:** version HTML (always); optional redacted session transcripts (v1). Extracted *text* for search lives in FTS5, not the blob store.

---

## 6. Postgres-compatibility rules

To keep the cloud migration a config change rather than a rewrite:

- Use Drizzle's portable column types; avoid SQLite-only idioms in application queries.
- Treat FTS5 as an *implementation of* the `SearchProvider` interface, not as something callers depend on directly — Postgres will use `tsvector`/pgvector behind the same interface.
- Keep `id`s as opaque strings (e.g. ULIDs) generated in application code, not SQLite `rowid` semantics.
- No triggers or SQLite-specific pragmas in business logic; keep them in migration/setup only.

---

Continue to [security.md](./security.md) for how this data is protected, or [api-reference.md](./api-reference.md) for the contracts that expose it.
