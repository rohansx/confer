# Confer — Product Overview

**Domain:** tryconfer.com · **One-liner:** GitHub PRs for docs. Agents write, humans approve, agents read only what's approved.

---

## 1. Thesis

AI-native teams generate far more documentation than they hand-write. Coding agents produce design docs, runbooks, API references, and postmortems as HTML — but three things are broken:

1. **No system of record.** Docs live in gists, `/docs` folders, Slack threads, and individual canvases. Nothing is the canonical, team-blessed version.
2. **No review workflow.** Comments exist everywhere; *approval* exists nowhere. Nobody can answer "has a human signed off on this doc, and when, and against which commit?"
3. **Agents can't safely consume docs.** When a coding agent needs team context, it scrapes wikis full of stale, unapproved, contradictory pages — or gets nothing.

Confer closes the loop:

> **Agents write docs → humans review and approve them → agents read only the approved corpus, with provenance.**

That loop is the product. Every feature must serve it: **deepen provenance, enrich review, or improve consumption.** Anything else is out.

---

## 2. Anti-scope (deliberate cuts, with reasons)

These are not "later" — they are *decisions not to build*, because building them would dilute the wedge or break the model.

| Cut | Why |
|---|---|
| In-browser WYSIWYG / live editing / multiplayer | This is html-docs.com's moat (CRDTs, presence). In Confer's model humans don't edit — they comment or propose, and agents regenerate. Editing breaks provenance: an edited doc matches no agent output and no commit SHA. |
| Freeform AI text→HTML "magic" conversion | The agent already writes HTML. (Deterministic md→html with an org theme **is** in scope — see roadmap §v1 — but that's a template pipeline, not an LLM call.) |
| Public no-account sharing, custom domains, desktop app | Creator-market features. Our buyer is a team lead, not a solo creator. |
| Git-style branching for docs | Linear versions + states = everything a doc needs. Latest `approved` **is** "main"; `in_review` versions **are** open PRs. Docs don't have merge conflicts worth resolving; they have "pick one." Revisit only if a real team asks. |
| Graph-DB knowledge memory in v0/v1 | The queryable team memory **is** the approved corpus behind MCP search. A knowledge graph (entities, relations, dependency traversal) is phase 3. Coupling v0 to a graph DB triples the build for zero demo value. |

**Mental model:** html-docs is Google Docs for agents (canvas, editing, individuals). Confer is GitHub PRs for docs (immutable versions, review, approval, machine-readable corpus). *"We don't have an editor" is a feature* — an approved doc is byte-for-byte what an agent generated and a human signed off on.

---

## 3. Competitive positioning

| Product | What it is | Where Confer differs |
|---|---|---|
| **html-docs.com** | Shared canvas for individuals + agents; live editing, comments, version history | No structured review/approval, no approved-only agent retrieval, no git provenance, no session provenance, closed source, teams an afterthought |
| **Notion / Confluence** | General wikis | Not agent-native in or out; no provenance; notorious staleness |
| **GitBook / Mintlify / RTD** | Published product docs from git | External-docs publishing pipelines, not internal review + agent context |
| **Outline** | OSS team wiki | Editor-centric, human-authored; no approval states, no MCP corpus |
| **Raw `/docs` + PR review** | The honest incumbent | Single-repo only; no cross-repo corpus, no rendered review UX, unreadable diffs for generated HTML |

**Wedge:** review workflow **+** approved-only MCP retrieval **+** git & session provenance. Nobody has all three.

**Moat direction:** semantic HTML diff, drift detection, session-context audit trail.

**Self-host as strategy:** OSS, `docker compose up`. Wins compliance-constrained teams (Indian fintech/DPDP, EU) — the same buyer as CloakPipe. html-docs can't follow without cannibalizing their cloud.

---

## 4. Users & the core loop

**Personas:**

| Persona | Role in the loop |
|---|---|
| **Agent** | Writes docs, pushes them (`push` scope), and later reads approved context via MCP (`mcp` scope). |
| **Author** | The IC running the agent. Triggers pushes, shepherds a doc through review, re-runs the agent to address comments. |
| **Reviewer / Owner** | Owns a Space (CODEOWNERS-style). The *only* role that can approve. Comments, approves, rejects. |
| **Consumer** | Any teammate or agent reading approved docs — via the dashboard or via MCP. |

### The 90-second demo loop

1. **Push.** Agent in repo X writes `auth-flow.html`, runs `confer push` → version **v3**, state `in_review`, provenance `{repo, sha, tool, agent, session}`.
2. **Review.** Reviewer opens the link: rendered doc + diff vs v2 + the prompt trail that produced it. Drops an anchored comment: *"refresh token TTL is wrong."*
3. **Regenerate & approve.** Author re-runs the agent; the agent reads the unresolved thread, pushes **v4**. Reviewer approves. v4 → `approved`, v3 → `superseded`.
4. **Consume.** A different agent in repo Y calls MCP `search_docs("auth flow")` → gets **v4 only**, with `approved_by`, `approved_at`, `commit_sha`.

This loop is the acceptance test for the whole product. If any step is awkward, that's the bug.

---

## 5. Core concepts

These are the nouns the entire system is built from. See [data-model.md](./data-model.md) for the schema and [architecture.md](./architecture.md) for how they flow.

- **Org** → the tenant. Members are `admin` | `member`. Has a **theme** (v1).
- **Space** → a folder within an org. Has **owners** (CODEOWNERS-style): *only owners approve.* Carries `required_approvals` (default 1).
- **Doc** → a `slug` + `title` within a Space. A pointer to a series of versions — not content itself.
- **Version** → an **immutable** content blob (blake3 content-addressed) + metadata + provenance. States:
  `draft → in_review → approved | rejected`; and `approved → superseded` (when a newer version is approved).
- **Provenance** (per version) → `author_type` (human|agent), `author`, `tool`, `source_repo`, `commit_sha`, `branch`, `pushed_at`, and optional **session context** (v1 — the prompt trail).
- **Suggestion** → a reader-proposed new version generated via chat-with-doc (v1). It enters the *normal* review pipeline; it never auto-approves.
- **Comment** → anchored (text-quote + selector) or doc-level. Threaded and resolvable. Unresolved threads carry over to new versions.
- **Token** → an org-scoped API key. Scopes: `push`, `read`, `mcp`. Hashed at rest, revocable, `last_used_at` surfaced.

### The relationships at a glance

```
Org ──< Space ──< Doc ──< Version ──< Approval
 │        │                  │
 │        └─ Space owners    ├─ Provenance (repo, sha, tool, author, session)
 │                           └─ Comments (anchored, threaded)
 └──< Token (push | read | mcp)
```

---

## 6. What "done" looks like

The product is working when a team can run the 90-second loop **more than once** without help (the "second update" test), and their agents pull approved context via MCP as a matter of course. See [roadmap.md](./roadmap.md#success-signals) for the concrete 60-day success signals.

For *how* it's built, continue to [architecture.md](./architecture.md).
