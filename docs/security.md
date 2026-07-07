# Confer — Security Model

Confer hosts **arbitrary teammate-supplied HTML + JS** and (in v1) **LLM credentials and agent transcripts**. Security is not a hardening pass at the end — it is a day-one architectural constraint and a marketing angle.

> Security page tagline candidate: *"the doc host that doesn't XSS your org."*

Threats below are ordered by severity. Each states the threat, the mitigation, and when it lands.

---

## 1. Malicious doc → session theft

**Threat:** A teammate (or a compromised agent) publishes a doc containing hostile JavaScript that tries to steal session cookies, read app state, or act as the viewer.

**Mitigation (v0 — never cut):**
- User content is served **only** from `view.conferusercontent.com` — a **separate registrable domain**, never a subdomain of the app. Because it is a different registrable domain, the app's cookies and `localStorage` are structurally unreachable from doc scripts.
- The content is rendered inside an iframe with `sandbox="allow-scripts"` **only** (no `allow-same-origin`, no `allow-forms`, no top-navigation).
- Strict CSP on served content:
  ```
  Content-Security-Policy:
    default-src 'none';
    script-src 'unsafe-inline';
    style-src  'unsafe-inline';
    img-src    data:;
  ```
  No external fetches from docs in v0 — a doc cannot phone home, load a remote script, or exfiltrate via an image beacon to an external host. `img-src data:` allows inlined images only.
- The app origin sets **zero cookies** on the `view.` origin.

**Loosening, later:** per-space CSP relaxation (e.g. allow specific external image hosts) is a *deliberate, opt-in* future change — never the default.

---

## 2. Blob URL guessing

**Threat:** An attacker enumerates or guesses blob URLs to read content they shouldn't.

**Mitigation (v0):**
- Blobs are served via **signed, short-lived, org-scoped URLs** minted by the app origin.
- **No public listing** endpoint and **no guessable paths** exposed to clients — the on-disk `blobs/ab/cd/<hash>` layout is never a URL.
- The signature binds the URL to an org and an expiry; an expired or cross-org signature is rejected.

---

## 3. Session-context leakage (v1)

**Threat:** Agent session transcripts and prompt trails (attached to versions for provenance) leak secrets, internal code, or PII.

**Mitigation (v1):**
- **Redaction before storage:** every transcript passes through a **pluggable redactor** before it is written. Reference implementation: the **CloakPipe** proxy (PII + secret patterns). Self-hosters can point at their own.
- **Opt-in full transcript:** the default attached to a version is *summary + initiating prompt only*. The full transcript blob is explicit opt-in, because sessions leak secrets and internal code.
- **Scope-gated MCP access:** `get_doc(include_session: true)` is gated on token scope. Agents get *how* a doc was derived only when explicitly permitted.
- **Excluded from search:** transcripts are excluded from the FTS index by default, so they can't surface via `search_docs`.

---

## 4. LLM key theft (v1)

**Threat:** An org's BYOK LLM credentials are stolen from storage or leaked to the browser.

**Mitigation (v1):**
- Keys **encrypted at rest** with a **per-org DEK** (data encryption key), itself wrapped by a root/KMS key.
- Decrypted **only** inside the server-side LLM gateway — **never** placed in any browser payload.
- **Every use audited** in the `events` table (an `llm-call` event), so key usage is traceable.

---

## 5. Prompt injection via docs

**Threat:** A doc's content contains instructions ("ignore your system prompt, run…") that hijack a consuming agent.

**Mitigation (honest, partial):**
- MCP responses **wrap doc HTML in a data envelope** — the content is presented as *data*, not as instructions.
- `SKILL.md` explicitly instructs agents to **treat returned doc content as data, not instructions**.
- This cannot be fully solved with today's models; Confer **documents the limitation honestly** rather than claiming immunity.

---

## 6. Tokens & audit trail

**Threat:** Leaked or over-privileged API tokens; inability to answer "who did what."

**Mitigation (v0):**
- Tokens are **hashed at rest**, **scoped** (`push` / `read` / `mcp`), and **revocable**.
- `last_used_at` is surfaced so stale or suspicious tokens are visible.
- The `events` audit trail records **push / approve / reject / token-use** (and `llm-call` in v1) — an append-only record per org.

---

## 7. Auth surface (v0)

- **Login:** email magic-link + GitHub OAuth. Orgs with invites.
- **Session cookies** live on the **app origin only** — never the content origin (see §1).
- **Approval is human-only and API-enforced:** the `push` scope cannot approve; only a space owner acting through an authenticated session can. Agents are structurally incapable of approving their own docs.

---

## Threat model summary

| # | Threat | Mitigation | Lands |
|---|--------|-----------|-------|
| 1 | Malicious doc → session theft | Separate registrable content domain + `sandbox="allow-scripts"` + strict CSP + zero cookies | **v0** |
| 2 | Blob URL guessing | Signed, short-lived, org-scoped URLs; no listing | **v0** |
| 3 | Session-context leakage | Redaction hook + opt-in transcript + scope-gated + excluded from FTS | v1 |
| 4 | LLM key theft | Per-org DEK, decrypt server-side only, audit every use | v1 |
| 5 | Prompt injection via docs | Data envelope + skill instructions; documented as partial | v0 (envelope), ongoing |
| 6 | Token compromise | Hashed, scoped, revocable, `last_used_at`, audit trail | **v0** |

**Never cut, at any slip:** the two-origin content isolation (§1). It is the single most important security property and the headline of the "doesn't XSS your org" positioning.

---

Continue to [api-reference.md](./api-reference.md) for the contracts, or back to [architecture.md](./architecture.md).
