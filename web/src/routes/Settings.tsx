import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { listTokens, createToken, revokeToken, type TokenRow } from "../lib/api";
import { fadeUp, stagger, staggerItem, tapDown, easeSoft } from "../lib/motion";
import { ago } from "../lib/format";

const ALL_SCOPES = ["push", "read", "mcp", "unapproved"] as const;

export function Settings() {
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["mcp"]);
  const [created, setCreated] = useState<{ raw: string; name: string } | null>(null);
  const [copiedTok, setCopiedTok] = useState(false);

  const refresh = () =>
    listTokens()
      .then(setTokens)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const copyMcp = () => {
    try {
      navigator.clipboard.writeText("https://app.tryconfer.com/mcp");
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const submitCreate = async () => {
    if (!name.trim()) return;
    try {
      const t = await createToken(name.trim(), scopes);
      setCreated({ raw: t.raw, name: t.name });
      setName("");
      setScopes(["mcp"]);
      setCreating(false);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const revoke = async (id: string, n: string) => {
    if (!confirm(`Revoke token "${n}"? Anything using it will stop working immediately.`)) return;
    try {
      await revokeToken(id);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const copyRaw = () => {
    if (!created) return;
    try {
      navigator.clipboard.writeText(created.raw);
    } catch {
      /* ignore */
    }
    setCopiedTok(true);
    setTimeout(() => setCopiedTok(false), 1600);
  };

  return (
    <>
      <TopBar crumb="Settings" />
      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger(0.06)}
        style={{ flex: 1, overflow: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 22, maxWidth: 860 }}
      >
        <motion.h1 variants={staggerItem} style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>MCP &amp; tokens</motion.h1>

        {/* invariant note */}
        <motion.div
          variants={staggerItem}
          style={{ position: "relative", padding: "22px 26px", borderRadius: 6, background: "var(--docbg)", border: "1px solid var(--line)", boxShadow: "var(--sh-raise)", transform: "rotate(-.3deg)" }}
        >
          <span style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%) rotate(-2deg)", width: 96, height: 22, background: "rgba(200,190,160,.45)", border: "1px solid rgba(150,140,110,.3)" }} />
          <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--green)" }}>the invariant</span>
          <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.65, color: "var(--ink2)" }}>
            No MCP read path returns unapproved content unless a token explicitly scoped for it asks with{" "}
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink)" }}>include_unapproved</span>. Every response carries{" "}
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink)" }}>approved_by · approved_at · commit_sha</span>.
          </p>
        </motion.div>

        {/* endpoint */}
        <motion.section variants={staggerItem} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Endpoint</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, boxShadow: "var(--sh-inset)", background: "var(--paper)" }}>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink)", flex: 1 }}>https://app.tryconfer.com/mcp</span>
            <motion.button {...tapDown} onClick={copyMcp} style={chipBtn}>{copied ? "Copied ✓" : "Copy"}</motion.button>
          </div>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>tools: search_docs · get_doc · list_docs · push_doc</span>
        </motion.section>

        {/* newly created token — shown once */}
        <AnimatePresence>
          {created && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ease: easeSoft }}
              style={{ padding: 18, borderRadius: 10, background: "rgba(58,125,68,.08)", border: "1.5px solid var(--green)", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <span className="hand" style={{ fontSize: 19, color: "var(--green)" }}>token created ✓ — copy it now, you won't see it again</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <code className="mono" style={{ flex: 1, padding: "10px 12px", borderRadius: 8, background: "var(--paper)", boxShadow: "var(--sh-inset)", fontSize: 12.5, color: "var(--ink)", overflow: "auto" }}>{created.raw}</code>
                <motion.button {...tapDown} onClick={copyRaw} style={{ ...chipBtn, background: copiedTok ? "rgba(58,125,68,.15)" : "var(--raise)" }}>{copiedTok ? "Copied ✓" : "Copy"}</motion.button>
                <button onClick={() => setCreated(null)} style={{ ...chipBtn, background: "none", color: "var(--ink3)" }}>Dismiss</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* tokens */}
        <motion.section variants={staggerItem} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Org tokens</h2>
            <div style={{ flex: 1 }} />
            <motion.button
              {...tapDown}
              whileHover={{ backgroundColor: "#3a362c" }}
              onClick={() => setCreating((s) => !s)}
              style={{ padding: "9px 16px", borderRadius: 10, background: "var(--ink)", border: "none", color: "var(--docbg)", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "var(--sh-raise-sm)" }}
            >
              {creating ? "Cancel" : "New token"}
            </motion.button>
          </div>

          <AnimatePresence>
            {creating && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ ease: easeSoft }}
                style={{ overflow: "hidden" }}
              >
                <div style={{ padding: 18, borderRadius: 10, background: "var(--card)", boxShadow: "var(--sh-raise-sm)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
                    Name
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. claude-skill" style={inputStyle} />
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>Scopes</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ALL_SCOPES.map((s) => {
                        const on = scopes.includes(s);
                        return (
                          <button
                            key={s}
                            onClick={() => setScopes((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                            style={{
                              padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                              background: on ? "var(--green)" : "var(--paper)", color: on ? "#f6f3e9" : "var(--ink2)",
                              border: on ? "1px solid var(--green)" : "1px solid var(--line)", boxShadow: on ? "none" : "var(--sh-inset)",
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <motion.button {...tapDown} onClick={submitCreate} disabled={!name.trim()}
                    style={{ alignSelf: "flex-start", padding: "9px 18px", borderRadius: 10, background: name.trim() ? "var(--green)" : "var(--ink3)", border: "none", color: "#f6f3e9", fontSize: 13, fontWeight: 700, cursor: name.trim() ? "pointer" : "default" }}>
                    Create token
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err} — <a href="#/login">log in</a></div>}

          <div style={{ borderRadius: 10, background: "var(--raise)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", overflow: "hidden" }}>
            {tokens && tokens.length === 0 && <div style={{ padding: 20, color: "var(--ink3)", fontSize: 13 }}>No tokens yet — create one.</div>}
            {tokens?.map((t, i) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: i < tokens.length - 1 ? "1px solid var(--line)" : "none" }}>
                <span className="mono" style={{ fontSize: 12.5, minWidth: 120 }}>{t.name}</span>
                <div style={{ display: "flex", gap: 6, flex: 1 }}>
                  {t.scopes.map((s) => (
                    <span key={s} className="mono" style={{ fontSize: 10, padding: "3px 9px", borderRadius: 6, boxShadow: "var(--sh-inset)", background: "var(--paper)", color: "var(--ink2)" }}>{s}</span>
                  ))}
                </div>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>last used {t.last_used_at ? ago(t.last_used_at) : "never"}</span>
                <button onClick={() => revoke(t.id, t.name)} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 11.5, cursor: "pointer", padding: 0 }}>revoke</button>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--ink3)" }}>Tokens are hashed at rest, org-scoped, and every use lands in the audit trail.</span>
        </motion.section>
      </motion.div>
    </>
  );
}

const chipBtn: CSSProperties = {
  padding: "6px 14px", borderRadius: 8, background: "var(--raise)", boxShadow: "var(--sh-raise-sm)",
  border: "1px solid var(--line)", color: "var(--ink2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
};
const inputStyle: CSSProperties = {
  padding: "10px 14px", borderRadius: 9, border: "1px solid var(--line)", boxShadow: "var(--sh-inset)",
  background: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none",
};