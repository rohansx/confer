import { useState, Fragment } from "react";
import { motion } from "framer-motion";
import { Grain } from "../components/Grain";
import { Logo } from "../components/Logo";
import { fadeUp, stagger, staggerItem, hoverLift, tapDown, easeSoft } from "../lib/motion";

/** A copy-to-clipboard chip styled like the design's inset command box. */
function CopyChip({
  prompt,
  command,
  hint,
}: {
  prompt: string;
  command: string;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(command);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <motion.button
      onClick={copy}
      {...tapDown}
      whileHover={{ y: -1 }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 18px",
        borderRadius: 13,
        boxShadow: "var(--sh-inset)",
        background: "var(--paper)",
        border: "1px solid var(--line)",
        cursor: "pointer",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        color: "var(--ink)",
      }}
    >
      <span style={{ color: "var(--green)" }}>{prompt}</span> {command}
      <span style={{ fontSize: 11, color: "var(--pencil)" }}>{copied ? "copied ✓" : hint}</span>
    </motion.button>
  );
}

const inks = [
  { color: "var(--blue)", title: "Blue ink — written by agents", body: "Generated content, byte-for-byte immutable, session attached." },
  { color: "var(--red)", title: "Red pen — review comments", body: "Anchored to the text, threaded, carried over until resolved." },
  { color: "var(--green)", title: "Green ink — approvals", body: "Human-only, API-enforced. The stamp carries who, when, and against which commit." },
  { color: "var(--amber)", title: "Amber — in review", body: "Visible to the team, invisible to agents. Never served over MCP." },
  { color: "var(--pencil)", title: "Pencil — drafts & superseded", body: "Kept forever in history, erased from what agents read." },
];

const security = [
  ["01", "Two-origin isolation", "Docs render on a separate registrable domain, sandboxed, zero cookies."],
  ["02", "Signed blob URLs", "Content-addressed, short-lived, org-scoped. No guessable links."],
  ["03", "Redacted prompt trails", "Session context passes a redaction hook; transcripts are opt-in, scope-gated."],
  ["04", "Scoped tokens, full audit", "Hashed at rest, push/read/mcp scopes, every use written down."],
];

export function Landing() {
  return (
    <div data-grain="soft" style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", fontSize: 15.5, position: "relative" }}>
      <Grain />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 36px", position: "relative" }}>
        {/* NAV */}
        <motion.nav
          initial="hidden"
          animate="show"
          variants={fadeUp}
          style={{ display: "flex", alignItems: "center", gap: 28, padding: "26px 0" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo size={26} />
            <span style={{ fontWeight: 700, fontSize: 19, letterSpacing: "-.01em" }}>Confer</span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 26, fontSize: 14 }}>
            <a href="#loop" style={{ color: "var(--ink2)" }}>How it works</a>
            <a href="#inks" style={{ color: "var(--ink2)" }}>The inks</a>
            <a href="#selfhost" style={{ color: "var(--ink2)" }}>Self-host</a>
            <a
              href="#/app"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 18px",
                borderRadius: 12,
                background: "var(--card)",
                boxShadow: "var(--sh-raise-sm)",
                border: "1px solid var(--line)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--ink)",
                textDecoration: "none",
              }}
            >
              Open the app
            </a>
          </div>
        </motion.nav>

        <main>
        {/* HERO */}
        <header style={{ display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,.95fr)", gap: 52, alignItems: "center", padding: "58px 0 76px" }}>
          <motion.div initial="hidden" animate="show" variants={stagger(0.08)} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <motion.span
              variants={staggerItem}
              style={{
                alignSelf: "flex-start",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: ".08em",
                padding: "6px 14px",
                borderRadius: 9,
                boxShadow: "var(--sh-inset)",
                background: "var(--paper)",
                color: "var(--ink2)",
              }}
            >
              pull-request review, for docs
            </motion.span>
            <motion.h1
              variants={staggerItem}
              style={{ margin: 0, fontSize: 50, lineHeight: 1.08, fontWeight: 700, letterSpacing: "-.025em", textWrap: "balance" as const }}
            >
              Agents write.
              <br />
              <span style={{ textDecoration: "underline wavy var(--green)", textDecorationThickness: 2, textUnderlineOffset: 7 }}>
                Humans approve.
              </span>
              <br />
              Agents read only what's approved.
            </motion.h1>
            <motion.p variants={staggerItem} style={{ margin: 0, fontSize: 17, lineHeight: 1.65, color: "var(--ink2)", maxWidth: "46ch", textWrap: "pretty" as const }}>
              Confer is the system of record for AI-generated docs. Every version is immutable, signed in provenance, and
              reaches your agents over MCP only after a human puts ink on it.
            </motion.p>
            <motion.div variants={staggerItem} style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 4 }}>
              <CopyChip prompt="$" command="npm i -g confer" hint="copy" />
              <motion.a
                href="#loop"
                {...hoverLift}
                whileHover={{ ...hoverLift.whileHover, backgroundColor: "#3a362c" }}
                style={{
                  padding: "13px 24px",
                  borderRadius: 13,
                  background: "var(--ink)",
                  color: "var(--paper-hi)",
                  fontFamily: "'Source Serif 4', serif",
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: "none",
                  boxShadow: "var(--sh-raise-sm)",
                }}
              >
                See the loop ↓
              </motion.a>
            </motion.div>
            <motion.span variants={staggerItem} className="hand" style={{ fontSize: 19, color: "var(--pencil)", transform: "rotate(-1.2deg)", alignSelf: "flex-start" }}>
              no editor. that's the point — nothing changes without a new signature ↴
            </motion.span>
          </motion.div>

          {/* hero visual */}
          <motion.div
            initial={{ opacity: 0, y: 16, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: easeSoft }}
            style={{ position: "relative" }}
          >
            <motion.div
              animate={{ y: [0, -5, 0], rotate: 1.6 }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              style={{ position: "absolute", inset: "14px -10px -14px 10px", borderRadius: 6, background: "var(--paper-lo)", boxShadow: "var(--sh-raise-sm)" }}
            />
            <motion.div
              animate={{ rotate: [-0.6, 0.2, -0.6] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
              style={{ position: "relative", borderRadius: 6, background: "var(--paper-hi)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", padding: "28px 30px 24px" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 17 }}>Authentication flow</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--pencil)" }}>v4 · cloakpipe/api @ 8f3c2e1</span>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.7, color: "var(--blue)" }}>
                The API issues a short-lived access token and a rotating refresh token on login. Refresh tokens expire after 14
                days and rotate on every use; a reused token revokes the whole family.
              </p>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: "var(--blue)" }}>
                On refresh, the server verifies the family, issues a new pair, and marks the old token spent.
              </p>
              <div style={{ margin: "14px 0 4px", padding: "10px 14px", borderLeft: "2px solid var(--red)", background: "rgba(176,58,46,.05)" }}>
                <span className="hand" style={{ fontSize: 19, color: "var(--red)", lineHeight: 1.3 }}>
                  TTL fixed — matches api#412 now. ok to approve — P.S.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 14 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--pencil)" }}>written by claude-code · session attached · blake3:9a41…</span>
                <div style={{ padding: "7px 16px", border: "2.5px solid var(--green)", borderRadius: 6, transform: "rotate(-7deg)", color: "var(--green)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: ".14em", opacity: 0.85, textAlign: "center" }}>
                  APPROVED
                  <div style={{ fontSize: 8, letterSpacing: ".06em", fontWeight: 400 }}>dev@ · jul 7 2026</div>
                </div>
              </div>
            </motion.div>
            <motion.span
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="hand"
              style={{ position: "absolute", right: -8, top: -30, fontSize: 20, color: "var(--green)", transform: "rotate(3deg)" }}
            >
              a human signed this ↓
            </motion.span>
          </motion.div>
        </header>

        {/* THE LOOP */}
        <Section id="loop" title="The loop, on one page" subtitle="Ninety seconds end to end. Each hand changes the ink.">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={stagger(0.1)} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {[
              { title: "1 · agent writes", color: "var(--blue)", body: "confer push captures repo, commit SHA, tool, and the session behind the doc.", tag: "■ blue ink · agent", green: false },
              { title: "2 · human reviews", color: "var(--red)", body: "Rendered doc, word-level diff vs last version, margin comments, and the prompt trail behind it.", tag: "■ red pen · reviewer", green: false },
              { title: "3 · agent rewrites", color: "var(--blue)", body: "No editor. The agent reads unresolved threads and pushes a fresh version — a full regeneration, with provenance.", tag: "■ blue ink · agent", green: false },
              { title: "4 · approved → read", color: "var(--green)", body: "Owner signs; the old version is superseded. Agents everywhere get exactly this one over MCP — with approved_by, approved_at, commit_sha.", tag: "■ green ink · owner", green: true },
            ].map((s, i) => (
              <Fragment key={i}>
                <motion.div
                  variants={staggerItem}
                  {...hoverLift}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: 22,
                    borderRadius: 14,
                    background: "var(--card)",
                    boxShadow: "var(--sh-raise)",
                    border: s.green ? "2px solid var(--green)" : "1px solid var(--line)",
                  }}
                >
                  <span className="hand" style={{ fontSize: 21, color: s.color }}>{s.title}</span>
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink2)" }}>{s.body}</p>
                  <span style={{ marginTop: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: s.color }}>{s.tag}</span>
                </motion.div>
                {i < 3 && (
                  <div style={{ width: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    <span style={{ width: "100%", borderTop: "2px dashed var(--pencil)" }} />
                    <span className="hand" style={{ fontSize: 15, color: "var(--pencil)", marginTop: -14 }}>{["push →", "redo ⟲", "sign ✓"][i]}</span>
                  </div>
                )}
              </Fragment>
            ))}
          </motion.div>

          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 }} style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
            <span className="hand" style={{ fontSize: 18, color: "var(--pencil)" }}>
              ↺ &nbsp;next time the code changes, the loop runs again — the corpus never goes stale quietly
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: easeSoft }}
            style={{ marginTop: 10, borderRadius: 12, boxShadow: "var(--sh-inset)", background: "var(--paper)", border: "1px solid var(--line)", padding: "18px 24px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, lineHeight: 1.85, color: "var(--ink2)" }}
          >
            <div><span style={{ color: "var(--green)" }}>$</span> confer push auth-flow.html --space backend --slug auth-flow</div>
            <div style={{ color: "var(--pencil)" }}>✓ provenance: cloakpipe/api @ 8f3c2e1 · claude-code · session attached</div>
            <div style={{ color: "var(--pencil)" }}>✓ version v4 created · state: in_review</div>
            <div>→ review: <a href="#/app">app.tryconfer.com/backend/auth-flow/v4</a></div>
          </motion.div>
        </Section>

        {/* THE INKS */}
        <section id="inks" style={{ padding: "0 0 78px", display: "grid", gridTemplateColumns: "minmax(0,.9fr) minmax(0,1.1fr)", gap: 52, alignItems: "center" }}>
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={stagger(0.07)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <motion.h2 variants={staggerItem} style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>Every ink means something</motion.h2>
            <motion.p variants={staggerItem} style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: "var(--ink2)", textWrap: "pretty" as const }}>
              A doc in Confer reads like a reviewed manuscript: you can always tell whose hand wrote what, and what standing it
              has. States aren't metadata buried in a sidebar — they're the color of the ink.
            </motion.p>
            <motion.span variants={staggerItem} className="hand" style={{ fontSize: 19, color: "var(--pencil)", transform: "rotate(-1deg)" }}>
              pencil is for drafts — it hasn't earned ink yet
            </motion.span>
          </motion.div>
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={stagger(0.06)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {inks.map((k) => (
              <motion.div
                key={k.title}
                variants={staggerItem}
                {...hoverLift}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 20px", borderRadius: 12, background: "var(--card)", boxShadow: "var(--sh-raise-sm)", border: "1px solid var(--line)" }}
              >
                <span style={{ width: 44, height: 5, borderRadius: 3, background: k.color }} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: k.color }}>{k.title}</span>
                  <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{k.body}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* INVARIANT NOTE */}
        <section style={{ padding: "0 0 78px", display: "flex", justifyContent: "center" }}>
          <motion.div
            initial={{ opacity: 0, y: 16, rotate: -0.4 }}
            whileInView={{ opacity: 1, y: 0, rotate: -0.4 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.55, ease: easeSoft }}
            style={{ position: "relative", maxWidth: 720, padding: "34px 40px", background: "var(--paper-hi)", border: "1px solid var(--line)", boxShadow: "var(--sh-raise)", borderRadius: 4 }}
          >
            <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%) rotate(-2deg)", width: 110, height: 26, background: "rgba(200,190,160,.45)", border: "1px solid rgba(150,140,110,.3)" }} />
            <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--green)" }}>the invariant</span>
            <h2 style={{ margin: "8px 0 10px", fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.25 }}>
              No MCP read path ever returns unapproved content.
            </h2>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: "var(--ink2)" }}>
              Your wiki serves agents whatever happens to be lying around. Confer serves the approved corpus — and nothing else,
              unless a deliberately scoped token asks. Every response carries{" "}
              <span className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>approved_by · approved_at · commit_sha</span>.
            </p>
            <span className="hand" style={{ position: "absolute", right: 26, bottom: -16, fontSize: 20, color: "var(--green)", transform: "rotate(-3deg)" }}>
              this is the whole product ✓
            </span>
          </motion.div>
        </section>

        {/* SECURITY */}
        <Section id="security" title="The doc host that doesn't XSS your org." subtitle="Confer renders arbitrary teammate-supplied HTML, so isolation is designed in on day one — not patched in later.">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={stagger(0.08)} style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            {security.map(([n, t, b]) => (
              <motion.div key={n} variants={staggerItem} {...hoverLift} style={{ padding: 20, borderRadius: 12, background: "var(--card)", boxShadow: "var(--sh-raise-sm)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--pencil)" }}>{n}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.55 }}>{b}</span>
              </motion.div>
            ))}
          </motion.div>
        </Section>

        {/* SELF-HOST */}
        <section id="selfhost" style={{ padding: "0 0 84px", display: "flex", justifyContent: "center" }}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, ease: easeSoft }}
            style={{ width: "100%", padding: "46px 44px", borderRadius: 16, background: "var(--card)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}
          >
            <h2 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-.02em" }}>Your docs, your box.</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--ink2)", maxWidth: "52ch" }}>
              Open source, Apache-2.0, self-hosted forever for free. One command, two origins, SQLite — no ops team required.
            </p>
            <CopyChip prompt="$" command="docker compose up" hint="copy" />
            <span className="hand" style={{ fontSize: 19, color: "var(--pencil)" }}>or wait for the hosted cloud — tryconfer.com</span>
          </motion.div>
        </section>
        </main>

        {/* FOOTER */}
        <footer style={{ display: "flex", alignItems: "center", gap: 18, padding: "24px 0 44px", borderTop: "1px solid var(--line)" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Confer</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--pencil)" }}>agents write · humans approve · agents read what's approved</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
            <a href="#loop" style={{ color: "var(--ink2)" }}>GitHub</a>
            <a href="#/docs" style={{ color: "var(--ink2)" }}>Docs</a>
            <a href="#security" style={{ color: "var(--ink2)" }}>Security</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ padding: "30px 0 78px", display: "flex", flexDirection: "column", gap: 30 }}>
      <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.4 }} variants={stagger(0.07)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <motion.h2 variants={staggerItem} style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</motion.h2>
        <motion.p variants={staggerItem} style={{ margin: 0, fontSize: 15, color: "var(--ink2)", maxWidth: "60ch", lineHeight: 1.65 }}>{subtitle}</motion.p>
      </motion.div>
      {children}
    </section>
  );
}