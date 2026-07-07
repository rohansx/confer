# Confer — Roadmap

What ships when, and why in that order. **v0 is committed.** v1 is *designed now, evidence-gated* — built only as demand proves it out. Phase 2/3 is directional.

The ordering principle throughout: every feature must **deepen provenance, enrich review, or improve consumption** (the core loop from [overview.md §1](./overview.md#1-thesis)). If it does none of those, it's cut.

---

## v0 — The complete loop (≈3 weeks of evenings)

**Goal:** push → review → approve → MCP read, end to end. This is the [implementation-plan.md](./implementation-plan.md).

| Area | v0 scope |
|---|---|
| **Publish API + CLI** | `POST versions` (idempotent by content hash, 5 MB single-file HTML cap); `confer login / push / open / status / skill install`, auto-detecting repo + SHA. |
| **Viewer** (security-critical) | Sandboxed iframe on a separate origin, strict CSP, zero cookies; chrome = title, state badge, version selector, provenance panel, approve button, comment sidebar. |
| **Review & diff** | Side-by-side rendered versions + text-level word diff (readability extraction → `diff-match-patch`), collapsed unchanged regions. Approve → transition + supersede + audit; reject with reason. |
| **Comments** | Anchored (quote + prefix/suffix + selector), graceful degrade to doc-level with "anchor lost", threaded, resolvable; unresolved threads carry to new versions. |
| **MCP server** | 4 tools (`search_docs`, `get_doc`, `list_docs`, `push_doc`), org token `mcp` scope, **approved-only invariant**, `repo` filter. |
| **Search / auth / notifications** | FTS5 (approved + in_review); magic-link + GitHub OAuth, orgs + invites; email on review-requested/comment/decision + one Slack webhook per space. |

See [api-reference.md](./api-reference.md) for exact contracts.

---

## v1 — Deepen the loop (next 4–6 weeks, evidence-gated)

Each item is fully specified so it can be built the moment evidence justifies it.

### 7.1 Session context / prompt trail — *provenance, deepened*
Attach the agent session that produced a version, so *"why does this doc say X"* is answerable.
- **Payload:** structured JSON — initiating prompt, model, tool name, agent-written key-decision summary, token counts, start/end timestamps; optional full transcript blob.
- **Default = summary + initiating prompt. Full transcript = explicit opt-in** (sessions leak secrets/code).
- **Redaction hook:** transcript passes through a pluggable redactor before storage (reference: CloakPipe proxy; self-hosters bring their own).
- **CLI/skill:** `confer push --session <file.json>`; the Claude skill assembles this from its own session (Agent SDK exposes transcript access).
- **UI:** a "Context" tab in the viewer renders the prompt trail read-only beside the doc.
- **MCP:** `get_doc(include_session: true)` (scope-gated).

### 7.2 Chat-with-doc → suggestions
Readers chat with a doc; the outcome is a **proposed version**, not an edit.
- Reader opens a chat panel → converses (LLM has doc HTML + session summary as context) → "propose change" → LLM regenerates the affected HTML → stored as a **suggestion** (`origin=suggestion`, `suggested_by`, chat transcript as its session context) → enters `in_review` → owner approves/rejects.
- Preserves the no-editing invariant: every change is a regeneration with provenance, reviewed by an owner. Rate-limited; **never auto-approves.**

### 7.3 BYO inference — *who pays for LLM calls*
Confer spends ≈zero on inference; chat-with-doc and any LLM-assisted conversion run on the **org's own credentials**.
- **Primary path: BYOK.** Org settings hold provider + API key (Anthropic Console, Bedrock, Vertex, or any OpenAI-compatible endpoint). Keys **encrypted at rest** (per-org DEK, KMS/root key), **never sent to the browser**; all LLM calls server-side.
- **Subscription note:** per Anthropic's published policy, third-party tools are expected to use **API-key auth**; routing third-party traffic against Claude subscription limits (Pro/Max) is prohibited (a discretionary usage-credits path aside). So "use my Max plan for Confer" is **not** a lawful default — **build BYOK first**, treat any subscription-OAuth path as opt-in only if/when Anthropic's sanctioned mechanism covers it. **Re-verify their current policy before implementing.**
- **Local bridge (`claude -p`) — parked.** A localhost daemon proxying to local Claude Code has far more moving parts (tunnel, liveness, auth). Revisit only if BYOK adoption stalls.
- **Self-host:** identical BYOK config via env/settings.

### 7.4 Org design themes
- One **theme CSS** per org (tokens: colors, type scale, spacing, logo) + optional per-space override. Injected at render time in the viewer; also shipped to the skill so agents generate on-brand HTML from the start.
- A theme is a CSS file + small JSON manifest — **not a layout builder.** Layout variety comes from the agent, guided by skill templates.

### 7.5 Markdown → themed HTML converter
- **Deterministic** pipeline: remark/rehype → sanitized HTML → org theme applied. **No LLM call** — it's a format conversion; instant, free, trustworthy. `confer push notes.md` just works.

### 7.6 Repo-live docs view
- Dashboard view grouped by `source_repo`: for each repo, the set of approved ("live") docs agents will consume + open reviews. This is the *"each repo has its live docs"* surface — a query over existing data, not new machinery.

### v1 also includes
- **Embeddings search** behind the existing `SearchProvider` interface (no caller changes).

---

## Phase 2 / 3 — Directional

- **Drift detection** — GitHub webhook: when referenced paths change past the anchored `commit_sha`, flag the doc `stale` and optionally open a regeneration task. *(The bridge to the Illuminate context-compiler thesis.)*
- **Semantic DOM diff** — the review moat beyond text-level word diff.
- **Doc dependencies** with staleness propagation.
- **Knowledge-graph layer** — entities/relations/traversal (ctxgraph bolt-on) when evidence demands it.
- **Cloud multi-tenant + billing** — free self-host forever; per-seat cloud; enterprise = SSO, audit export, retention.

---

## Distribution & GTM

1. **Claude Code Mumbai demo** — the 90-second loop live; collect ≥5 self-hosting teams that week.
2. **OSS launch / Show HN** — *"Confer — GitHub-PRs-style review for AI-generated docs, with an MCP server that serves only human-approved context."* The **approved-only invariant is the headline**; html-docs structurally can't say it.
3. **Skill as distribution** — one-command install; every agent user becomes a publisher.
4. **Dogfood** — CloakPipe / LeadEcho / MoltNet docs live on Confer; a public read-only org as the demo.

---

## Success signals (60 days)

- **≥3 external teams** complete the full loop **more than once** — the *"second update"* test.
- **≥1 team's agents** make **>50 MCP `get_doc` calls/week** — consumption is real.
- **comments-per-approved-doc > 1** — review is real, not rubber-stamping.

---

## Open questions / pre-build checklist

| # | Item | Status / lean |
|---|------|---------------|
| 1 | **License** | Apache 2.0 (adoption; matches existing repos) vs AGPL (protects cloud). **Leaning Apache + "Confer" trademark.** |
| 2 | **Grab now** | `confer` on npm (or `confer-cli`), the GitHub org, and the `view.` second domain (e.g. `conferusercontent.com`). **npm squatting is the real risk.** |
| 3 | **BYO-subscription legality** | Confirmed: Anthropic points third-party tools to API keys and prohibits routing third-party traffic against subscription limits (discretionary usage-credits path aside). **BYOK is the design; re-check policy before any subscription-OAuth work.** |
| 4 | **Agents as commenters** | v0: **no** (muddies review signal). Suggestions (v1) give agents a voice through the proper pipeline instead. |
| 5 | **Utkrusht IP** | Close the inventions-disclosure loop with Naman **before the first public commit.** Blocker, on purpose. |

---

Continue to [implementation-plan.md](./implementation-plan.md) for the build.
