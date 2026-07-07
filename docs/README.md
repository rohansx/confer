# Confer Documentation

> **GitHub PRs for docs.** Agents write, humans approve, agents read only what's approved.

**Domain:** tryconfer.com · **Status:** Pre-build spec v2 → planning · **License intent:** OSS core (Apache 2.0 + "Confer" trademark), hosted cloud later.

Confer closes a loop that is broken for AI-native teams:

> **Agents write docs → humans review and approve them → agents read only the approved corpus, with provenance.**

That loop *is* the product. Every feature must deepen provenance, enrich review, or improve consumption. Anything else is out of scope.

---

## Reading order

Start at the top; each doc assumes you've read the ones above it.

| # | Doc | Read it to understand |
|---|-----|-----------------------|
| 1 | [overview.md](./overview.md) | **Why Confer exists** — thesis, anti-scope, competitive wedge, personas, the 90-second core loop, and the core concepts (Org / Space / Doc / Version / Provenance). |
| 2 | [architecture.md](./architecture.md) | **How it's built** — system diagram, the four key flows (push, review, MCP read, chat-with-doc), tech choices and their rationale, monorepo layout, and deployment (cloud + self-host). |
| 3 | [data-model.md](./data-model.md) | **The source of truth** — full schema, the version state machine, hard invariants (exactly one approved version per doc, immutability, approved-only reads), and the content-addressed blob store. |
| 4 | [security.md](./security.md) | **Why it doesn't XSS your org** — the two-origin sandbox, CSP, signed blob URLs, token scoping, session redaction, LLM-key encryption, and the prompt-injection stance. Security is a day-one feature and a marketing angle. |
| 5 | [api-reference.md](./api-reference.md) | **The contracts** — REST API v1, token scopes, the 4 MCP tools and the approved-only invariant, the CLI, and the `SKILL.md` that teaches agents to publish and consume. |
| 6 | [roadmap.md](./roadmap.md) | **Where it's going** — v0 → v1 → phase 2/3 feature specs, GTM/distribution, success signals, and the pre-build checklist / open questions. |
| 7 | [implementation-plan.md](./implementation-plan.md) | **How we build it** — the master phased plan: full file tree, 7 phases with definition-of-done, sequencing, cut order, milestones, and the testing strategy. |
| 8 | [plans/phase-1-foundation.md](./plans/phase-1-foundation.md) | **The first buildable slice** — detailed TDD task plan (scaffold → schema → blob store → push API → token auth) in bite-sized, executable steps. |

---

## The one mental model that matters

- **html-docs.com** is *Google Docs for agents*: a shared canvas, live editing, presence, for individuals.
- **Confer** is *GitHub PRs for docs*: immutable versions, structured review, human approval, a machine-readable corpus.

"We don't have an editor" is a **feature**: an approved doc is byte-for-byte what an agent generated and a human signed off on. Editing would break provenance — an edited doc matches no agent output and no commit SHA.

## The three things nobody else has, together

1. **Review workflow** with real approval states (not just comments).
2. **Approved-only MCP retrieval** — agents cannot read unblessed content by default.
3. **Git + session provenance** — every version carries `{repo, sha, tool, agent, session}`.

The wedge is having all three. The moat direction is semantic HTML diff, drift detection, and the session-context audit trail.

---

## Status & conventions

- **Dates** in these docs are absolute. The build starts after **2026-07-17**; v0 targets ~3 weeks of evenings.
- **v0 / v1 / phase 2-3** tags mark when a capability lands. Only v0 is committed; v1 is *designed now, evidence-gated* for build.
- **Never cut** (see the plan): two-origin security, approval states, approved-only MCP.
