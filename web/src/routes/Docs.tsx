import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { fadeUp } from "../lib/motion";

/**
 * In-app documentation. Single scrollable article with a sticky section rail
 * and an active-section highlight (IntersectionObserver). Content is grounded
 * in the real surface — CLI commands, MCP tools, token scopes, REST routes.
 */
const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "quickstart", title: "Quickstart" },
  { id: "concepts", title: "Core concepts" },
  { id: "auth", title: "Authentication" },
  { id: "tokens", title: "Tokens & scopes" },
  { id: "pushing", title: "Pushing docs" },
  { id: "review", title: "Review & approve" },
  { id: "versioning", title: "Versioning" },
  { id: "mcp", title: "Connecting MCP agents" },
  { id: "context", title: "Space context" },
  { id: "selfhost", title: "Self-hosting" },
  { id: "api", title: "REST API reference" },
] as const;

export function Docs() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <TopBar crumb="Docs" />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
        {/* section rail */}
        <nav style={{ width: 214, flexShrink: 0, borderRight: "1px solid var(--line)", overflow: "auto", padding: "24px 14px 40px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--ink3)", padding: "0 10px 10px" }}>On this page</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                background: active === s.id ? "var(--raise)" : "none", color: active === s.id ? "var(--ink)" : "var(--ink2)",
                fontFamily: "inherit", fontSize: 13, fontWeight: active === s.id ? 600 : 400, boxShadow: active === s.id ? "var(--sh-raise-sm)" : "none",
              }}
            >
              {s.title}
            </button>
          ))}
        </nav>

        {/* article */}
        <div ref={scrollRef} style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
          <motion.article
            initial="hidden" animate="show" variants={fadeUp}
            style={{ maxWidth: 820, marginInline: "auto", padding: "34px 40px 120px", display: "flex", flexDirection: "column", gap: 4 }}
          >
            <Hero />
            <Overview />
            <Quickstart />
            <Concepts />
            <Auth />
            <Tokens />
            <Pushing />
            <ReviewDocs />
            <Versioning />
            <Mcp />
            <Context />
            <SelfHost />
            <ApiRef />
          </motion.article>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function Section({ id, title, kicker, children }: { id: string; title: string; kicker?: string; children: ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 20, paddingTop: 34, display: "flex", flexDirection: "column", gap: 14 }}>
      {kicker && <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--green)" }}>{kicker}</span>}
      <h2 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: "14px 0 0", fontSize: 16, fontWeight: 700 }}>{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: "var(--ink2)" }}>{children}</p>;
}

function M({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, background: "var(--paper)", boxShadow: "var(--sh-inset)", padding: "1px 6px", borderRadius: 5, color: "var(--ink)" }}>{children}</code>;
}

function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map((it, i) => <li key={i} style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink2)" }}>{it}</li>)}
    </ul>
  );
}

function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "good"; title?: string; children: ReactNode }) {
  const c = tone === "warn" ? "var(--amber)" : tone === "good" ? "var(--green)" : "var(--blue)";
  const bg = tone === "warn" ? "rgba(224,168,38,.10)" : tone === "good" ? "rgba(58,125,68,.08)" : "rgba(70,110,160,.08)";
  return (
    <div style={{ borderLeft: `3px solid ${c}`, background: bg, borderRadius: 6, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 5 }}>
      {title && <span style={{ fontSize: 13, fontWeight: 700, color: c }}>{title}</span>}
      <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink2)" }}>{children}</span>
    </div>
  );
}

function Code({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { try { navigator.clipboard.writeText(code); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", boxShadow: "var(--sh-raise-sm)", border: "1px solid var(--line)" }}>
      {lang && <span style={{ position: "absolute", top: 8, left: 14, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".1em" }}>{lang}</span>}
      <button onClick={copy} style={{ position: "absolute", top: 7, right: 8, padding: "4px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--raise)", color: "var(--ink2)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy"}</button>
      <pre style={{ margin: 0, padding: lang ? "30px 16px 16px" : "16px", overflow: "auto", background: "var(--docbg)" }}>
        <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, lineHeight: 1.65, color: "var(--ink)", whiteSpace: "pre" }}>{code}</code>
      </pre>
    </div>
  );
}

const methodColor: Record<string, string> = { GET: "var(--green)", POST: "var(--blue)", PUT: "var(--amber)", DELETE: "var(--red)" };
function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: "4px 12px", alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: methodColor[method] ?? "var(--ink2)" }}>{method}</span>
      <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "var(--ink)", wordBreak: "break-all" }}>{path}</code>
      <span />
      <span style={{ fontSize: 13, color: "var(--ink3)", lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 6 }}>
      <span className="hand" style={{ fontSize: 20, color: "var(--pencil)" }}>the manual</span>
      <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-.02em" }}>Confer documentation</h1>
      <P>
        Confer is a self-hostable, MCP-native review platform for AI-generated docs. The whole product is one loop:
        <b style={{ color: "var(--ink)" }}> agents write docs → humans review and approve → agents read only the approved corpus, with provenance.</b>
      </P>
    </div>
  );
}

function Overview() {
  return (
    <Section id="overview" title="Overview" kicker="Start here">
      <P>Every read path an agent uses returns <b style={{ color: "var(--ink)" }}>only human-approved content</b> — unless the caller explicitly opts in <i>and</i> holds the <M>unapproved</M> scope. That is the headline guarantee: the <b style={{ color: "var(--ink)" }}>approved-only invariant</b>.</P>
      <Ul items={[
        <><b>Provenance on everything.</b> Every version records the repo, commit SHA, branch, tool, and author that produced it.</>,
        <><b>Two-origin isolation.</b> Doc content renders on a separate, cookie-free, CSP-locked origin behind signed, expiring URLs — it can never touch your app session.</>,
        <><b>Human-only approval.</b> Approval is a human action recorded in an audit trail. There is no <M>confer approve</M> for agents.</>,
        <><b>MCP-native.</b> Agents connect over the Model Context Protocol to read the approved corpus and (optionally) push new drafts.</>,
      ]} />
    </Section>
  );
}

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart" kicker="90 seconds">
      <P>Local dev needs Node 22+. Boot the app and seed a demo org, then run the loop.</P>
      <Code lang="bash" code={`npm install
cp .env.example .env
npm run dev            # app on :5173, view on :5174, dashboard on :4321

# seed a demo org + tokens + a sign-in link
npx tsx server/src/dev/seed.ts`} />
      <H3>The loop</H3>
      <Code lang="bash" code={`# 1. an agent pushes a doc (git provenance auto-detected)
npx tsx cli/src/index.ts push ./auth-flow.html --space backend --slug auth-flow

# 2. a human reviews & approves it in the dashboard (approval is human-only)

# 3. another agent reads the approved corpus over MCP
#    mcp-only token → approved only; mcp + unapproved → all states`} />
      <Callout tone="good" title="That's the entire product">Push → approve → read-approved. Everything below is detail on each step.</Callout>
    </Section>
  );
}

function Concepts() {
  return (
    <Section id="concepts" title="Core concepts" kicker="Model">
      <H3>Orgs, spaces &amp; docs</H3>
      <Ul items={[
        <><b>Org</b> — a team. Members have a role (<M>admin</M> or <M>member</M>); admins manage tokens, members, and spaces.</>,
        <><b>Space</b> — a namespace for docs, owned by <i>either</i> an org <i>or</i> a person. A <b>personal space</b> is auto-created for every user on sign-in and is fully isolated from org spaces.</>,
        <><b>Doc</b> — addressed by <M>space/slug</M>. A doc is a series of immutable <b>versions</b>.</>,
      ]} />
      <H3>Version states</H3>
      <P>Every version is one of five states:</P>
      <Ul items={[
        <><M>draft</M> — pushed with <M>--draft</M>; skips the review queue, never served to agents.</>,
        <><M>in_review</M> — awaiting a human decision. Visible to the team, invisible to agents.</>,
        <><M>approved</M> — a human signed it. The only state agents read by default.</>,
        <><M>rejected</M> — a human declined it, with a reason.</>,
        <><M>superseded</M> — a newer version was approved; kept in history, erased from what agents read.</>,
      ]} />
      <H3>The two-origin view</H3>
      <P>Doc HTML renders on a dedicated content origin (the <M>view</M> host) behind a content-addressed, signed, expiring URL — with <M>Content-Security-Policy: default-src 'none'</M>, no cookies, and <M>nosniff</M>. A tampered or expired signature is a <M>403</M>. Your dashboard session cookie structurally cannot reach that origin.</P>
      <Callout tone="warn" title="The approved-only invariant">No MCP read path returns unapproved content unless the token holds the <M>unapproved</M> scope <i>and</i> the call passes <M>include_unapproved: true</M>. A lying client is ignored — the flag is forced to <M>false</M> without the scope.</Callout>
    </Section>
  );
}

function Auth() {
  return (
    <Section id="auth" title="Authentication" kicker="Humans">
      <P>Identity is keyed by <b style={{ color: "var(--ink)" }}>email</b> — GitHub, Google, and a magic link with the same address merge into one account. Humans authenticate with a session cookie; agents use bearer tokens (next section).</P>
      <Ul items={[
        <><b>Magic link</b> — enter your email, open the one-time link. Sets a session and creates your personal space.</>,
        <><b>GitHub / Google OAuth</b> — set <M>GITHUB_CLIENT_ID</M>/<M>GITHUB_CLIENT_SECRET</M> (or the Google pair) to enable the buttons.</>,
        <><b>Dev login</b> — a user-id + name shortcut for local/self-host, on by default. Disable in production with <M>DEV_LOGIN=0</M>.</>,
      ]} />
    </Section>
  );
}

function Tokens() {
  return (
    <Section id="tokens" title="Tokens & scopes" kicker="Agents">
      <P>Tokens are created in <b style={{ color: "var(--ink)" }}>Settings</b>, shown once, and hashed at rest. A token is scoped to <i>either</i> an org (org admins) <i>or</i> your personal spaces. Every use lands in the audit trail.</P>
      <H3>Scopes</H3>
      <Ul items={[
        <><M>push</M> — publish new versions (they land in <M>in_review</M>).</>,
        <><M>read</M> — read approved content over the REST API.</>,
        <><M>mcp</M> — read the approved corpus over MCP.</>,
        <><M>unapproved</M> — opt in to non-approved states. Only meaningful paired with <M>mcp</M> (or <M>read</M>) and an explicit <M>include_unapproved</M>.</>,
      ]} />
      <Callout tone="info">Give an agent the least it needs: a read agent gets <M>mcp</M>; a writer gets <M>push</M>; a reviewer bot that must see drafts gets <M>mcp,unapproved</M>.</Callout>
    </Section>
  );
}

function Pushing() {
  return (
    <Section id="pushing" title="Pushing docs" kicker="Write">
      <P>Three ways to publish a version. All create an <M>in_review</M> version (or <M>draft</M> with the draft flag) and record provenance.</P>
      <H3>CLI</H3>
      <Code lang="bash" code={`confer login --server https://tryconfer.com --token confer_xxx
confer push ./auth-flow.html --space backend --slug auth-flow
# → { ok, version_id, review_url, provenance: { source_repo, commit_sha, branch } }

confer push ./draft.html --space backend --slug wip --draft   # skip review queue`} />
      <P>The CLI auto-detects git provenance (repo, HEAD SHA, branch) from the working directory. <M>confer status</M> and <M>confer open</M> act on your last push.</P>
      <H3>MCP (agent)</H3>
      <P>An agent with a <M>push</M>-scoped token calls the <M>push_doc</M> tool — see <a href="#mcp" onClick={(e) => { e.preventDefault(); document.getElementById("mcp")?.scrollIntoView({ behavior: "smooth" }); }} style={{ color: "var(--green)" }}>Connecting MCP agents</a>.</P>
      <H3>Dashboard upload</H3>
      <P>Humans drop a single-file HTML (≤ 5 MB, inline assets) on the <b style={{ color: "var(--ink)" }}>Upload</b> page, pick a space, and push to review — authored as a human via your session.</P>
    </Section>
  );
}

function ReviewDocs() {
  return (
    <Section id="review" title="Review & approve" kicker="Humans">
      <P>Open an <M>in_review</M> doc from the dashboard. The rendered doc sits in the sandboxed viewer; the margin carries the review tools.</P>
      <Ul items={[
        <><b>Approve / reject</b> — a space owner or org admin signs it. Approval supersedes the prior approved version and is written to the audit trail. Reject requires a reason.</>,
        <><b>Comments</b> — select text in the doc to anchor a comment to that quote. Threads are text-quote-anchored and <b>carry over to the next version</b>, so the writing agent reads unresolved feedback before regenerating.</>,
        <><b>Word-level diff</b> — toggle <M>diff vs v(n-1)</M> to see exactly what changed, added in green and removed in struck-through red.</>,
        <><b>Provenance &amp; context</b> — the repo/commit/branch/tool/author behind the version, and the (opt-in) session prompt trail.</>,
      ]} />
    </Section>
  );
}

function Versioning() {
  return (
    <Section id="versioning" title="Versioning" kicker="History">
      <P>Versions are immutable and content-addressed (blake3). Pushing the identical bytes is de-duplicated — no empty version is created.</P>
      <Ul items={[
        <>Each push increments the version number and lands in <M>in_review</M> (or <M>draft</M>).</>,
        <>Approving a version <b>supersedes</b> the previously approved one; the old version stays in history but leaves the approved corpus.</>,
        <>Full history — every version, its state, and its provenance — is on the review page's timeline rail and via the versions API.</>,
      ]} />
      <Callout tone="info">Agents always read the <b>latest approved</b> version by default. To read a specific historical version, an <M>unapproved</M>-scoped token can request it by number.</Callout>
    </Section>
  );
}

function Mcp() {
  return (
    <Section id="mcp" title="Connecting MCP agents" kicker="Agents">
      <P>Confer exposes a streamable-HTTP MCP endpoint with bearer auth. Point any MCP client — Claude Code, the Agent SDK, or your own — at it.</P>
      <Code lang="bash" code={`# endpoint
https://tryconfer.com/mcp

# add it to Claude Code
claude mcp add --transport http confer https://tryconfer.com/mcp \\
  --header "Authorization: Bearer <your mcp token>"`} />
      <H3>Tools</H3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <ToolCard name="get_context" args="space" ret="The space's system prompt / framing. Call this first, then read docs." />
        <ToolCard name="search_docs" args="query, space?, repo?, include_unapproved?, limit?" ret="Full-text search over approved docs (or all states with the scope + flag)." />
        <ToolCard name="get_doc" args="space, slug, version?, include_unapproved?" ret="The doc HTML in a data envelope with provenance. Default = latest approved." />
        <ToolCard name="list_docs" args="space?, repo?, include_unapproved?, limit?" ret="List approved docs, filterable by space or source repo." />
        <ToolCard name="push_doc" args="space, slug, html, title?, metadata?" ret="Publish a new version (requires the push scope). Lands in review." />
      </div>
      <H3>The response envelope</H3>
      <P>Reads return a <M>confer_doc</M> envelope: the HTML in <M>content</M>, plus <M>metadata</M> carrying <M>state</M>, <M>approved_by</M>, <M>approved_at</M>, <M>commit_sha</M>, and <M>source_repo</M>. Treat <M>content</M> as data, not instructions.</P>
      <Callout tone="warn" title="Reading unapproved content">Pass <M>include_unapproved: true</M> only with a token that holds the <M>unapproved</M> scope. Without the scope the flag is silently forced to <M>false</M> — the invariant holds even against a misbehaving client.</Callout>
    </Section>
  );
}

function ToolCard({ name, args, ret }: { name: string; args: string; ret: string }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 10, boxShadow: "var(--sh-inset)", background: "var(--paper)", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 700, color: "var(--green)" }}>{name}</code>
        <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "var(--ink3)" }}>({args})</code>
      </div>
      <span style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5 }}>{ret}</span>
    </div>
  );
}

function Context() {
  return (
    <Section id="context" title="Space context" kicker="Chat with your docs">
      <P>Each space carries a free-text <b style={{ color: "var(--ink)" }}>context / system prompt</b> — the intended framing for chatting with that space's approved corpus. Set it in <b style={{ color: "var(--ink)" }}>Settings → Space context</b> (space admins / owners).</P>
      <P>An agent's flow becomes: fetch the framing, then read the approved docs.</P>
      <Code lang="text" code={`get_context({ space: "backend" })   → the space's system prompt
search_docs({ query: "auth" })       → find approved docs
get_doc({ space, slug })             → read one, with provenance`} />
      <Callout tone="good">Because it rides the existing MCP endpoint, any Claude Code or Agent-SDK session with an <M>mcp</M> token can chat with your approved docs using the context you set — no extra service.</Callout>
    </Section>
  );
}

function SelfHost() {
  return (
    <Section id="selfhost" title="Self-hosting" kicker="Your box">
      <P>Confer is a single Node process serving both origins, plus SQLite and a blob store. Run it with Docker Compose or directly.</P>
      <Code lang="bash" code={`docker compose up            # app + view behind your reverse proxy
# or
npm run build && node server/dist/serve-both.js`} />
      <H3>Environment</H3>
      <Ul items={[
        <><M>APP_ORIGIN</M> / <M>VIEW_ORIGIN</M> — the two origins (must be different registrable hosts in prod).</>,
        <><M>SIGNING_SECRET</M> — signs sessions and content URLs. Set a strong value.</>,
        <><M>DB_PATH</M> / <M>BLOB_DIR</M> — SQLite file and local blob directory.</>,
        <><M>PORT</M> / <M>VIEW_PORT</M> — ports for each origin.</>,
        <><M>R2_*</M> — optional Cloudflare R2 / S3 blob storage (bucket, endpoint, keys).</>,
        <><M>DEV_LOGIN=0</M> — disable the dev login in production.</>,
      ]} />
    </Section>
  );
}

function ApiRef() {
  const rows: [string, string, string][] = [
    ["POST", "/api/v1/auth/magic-link", "Request a sign-in link"],
    ["GET", "/api/v1/me", "Current user, orgs, and personal spaces"],
    ["GET", "/api/v1/spaces", "Spaces visible to the caller"],
    ["GET", "/api/v1/spaces/:space/docs", "Docs in a space (with state)"],
    ["POST", "/api/v1/spaces/:space/docs/:slug/versions", "Push a new version (push token or session)"],
    ["GET", "/api/v1/spaces/:space/docs/:slug/versions", "Version history for a doc"],
    ["GET", "/api/v1/spaces/:space/docs/:slug/diff", "Word-level diff between versions"],
    ["POST", "/api/v1/versions/:id/approve", "Approve a version (human)"],
    ["POST", "/api/v1/versions/:id/reject", "Reject a version with a reason"],
    ["GET", "/api/v1/spaces/:space/docs/:slug/comments", "List anchored comments"],
    ["POST", "/api/v1/spaces/:space/docs/:slug/comments", "Add an anchored comment"],
    ["GET", "/api/v1/spaces/:space/context", "Read a space's context / system prompt"],
    ["PUT", "/api/v1/spaces/:space/context", "Set a space's context (admin / owner)"],
    ["GET", "/api/v1/tokens", "List tokens (org or ?owner_id=me)"],
    ["POST", "/api/v1/tokens", "Create a token (org or owner scoped)"],
    ["GET", "/api/v1/search", "Full-text search the corpus"],
    ["POST", "/mcp", "MCP streamable HTTP endpoint (bearer)"],
  ];
  return (
    <Section id="api" title="REST API reference" kicker="Reference">
      <P>All responses use a consistent envelope: <M>{"{ success, data, error }"}</M>. Authenticate with a session cookie or a scoped bearer token.</P>
      <div style={{ borderRadius: 10, border: "1px solid var(--line)", overflow: "hidden", boxShadow: "var(--sh-raise-sm)", padding: "4px 16px" }}>
        {rows.map(([m, p, d], i) => <Endpoint key={i} method={m} path={p} desc={d} />)}
      </div>
    </Section>
  );
}
