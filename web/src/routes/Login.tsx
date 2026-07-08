import { useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "../components/Logo";
import { Grain } from "../components/Grain";
import { login, requestMagicLink, type User } from "../lib/api";
import { fadeUp, stagger, staggerItem, easeSoft } from "../lib/motion";

export function LoginPage() {
  const [mode, setMode] = useState<"magic" | "dev">("magic");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [devEmail, setDevEmail] = useState("");
  const [me, setMe] = useState<User | null>(null);

  const sendMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await requestMagicLink(email);
      setSent(true);
      setVerifyUrl(res.verify_url ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const devSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const u = await login(userId, name, devEmail || undefined);
      setMe(u);
      setTimeout(() => (window.location.hash = "#/app"), 500);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div data-grain="soft" style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", display: "grid", placeItems: "center", position: "relative" }}>
      <Grain />
      <motion.div initial="hidden" animate="show" variants={stagger(0.08)} style={{ maxWidth: 460, width: "100%", padding: "0 1.5rem" }}>
        <motion.div variants={staggerItem} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
          <Logo size={30} />
          <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.01em" }}>Confer</span>
        </motion.div>

        {me ? (
          <div style={{ textAlign: "center" }}>
            <h1 style={{ margin: "0 0 8px", fontSize: 24 }}>Signed in as {me.name}</h1>
            <p style={{ margin: 0, color: "var(--ink2)" }}>Taking you to the dashboard…</p>
            <a href="#/app" style={{ display: "inline-block", marginTop: 16 }}>Go now →</a>
          </div>
        ) : (
          <motion.div variants={staggerItem} style={{ padding: 28, borderRadius: 16, background: "var(--card)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)" }}>
            <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>Log in</h1>
            <p className="hand" style={{ margin: "0 0 18px", fontSize: 18, color: "var(--pencil)" }}>put some ink on the page</p>

            {mode === "magic" ? (
              sent ? (
                <div style={{ textAlign: "center" }}>
                  <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.6 }}>
                    We sent a sign-in link to <b>{email}</b>. Check your inbox (and the server console in dev).
                  </p>
                  {verifyUrl && (
                    <a href={verifyUrl} style={{ display: "inline-block", marginTop: 8, fontWeight: 600 }}>Open sign-in link →</a>
                  )}
                  <button
                    onClick={() => { setSent(false); setVerifyUrl(null); }}
                    style={{ marginTop: 18, display: "block", marginInline: "auto", background: "none", border: "none", color: "var(--ink2)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
                  >use a different email</button>
                </div>
              ) : (
                <form onSubmit={sendMagic} style={{ display: "grid", gap: "0.85rem" }}>
                  <Field label="Email" value={email} onChange={setEmail} placeholder="you@org.test" type="email" />
                  <motion.button
                    type="submit"
                    whileHover={{ y: -1 }} whileTap={{ y: 1 }}
                    style={{ marginTop: 6, padding: "13px 20px", borderRadius: 12, background: "var(--green)", border: "none", color: "#f6f3e9", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "var(--sh-raise-sm)" }}
                  >Send sign-in link</motion.button>
                  {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
                </form>
              )
            ) : (
              <form onSubmit={devSubmit} style={{ display: "grid", gap: "0.85rem" }}>
                <Field label="User ID" value={userId} onChange={setUserId} placeholder="any id — e.g. dev" />
                <Field label="Name" value={name} onChange={setName} placeholder="your name" />
                <Field label="Email (optional)" value={devEmail} onChange={setDevEmail} placeholder="you@org.test" />
                <motion.button
                  type="submit"
                  whileHover={{ y: -1 }} whileTap={{ y: 1 }}
                  style={{ marginTop: 6, padding: "13px 20px", borderRadius: 12, background: "var(--green)", border: "none", color: "#f6f3e9", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "var(--sh-raise-sm)" }}
                >Log in</motion.button>
                {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
              </form>
            )}

            <div style={{ marginTop: 18, textAlign: "center", fontSize: 12.5, color: "var(--ink3)" }}>
              {mode === "magic" ? (
                <button onClick={() => { setMode("dev"); setErr(null); }} style={{ background: "none", border: "none", color: "var(--ink2)", cursor: "pointer", textDecoration: "underline" }}>dev login (user id)</button>
              ) : (
                <button onClick={() => { setMode("magic"); setErr(null); }} style={{ background: "none", border: "none", color: "var(--ink2)", cursor: "pointer", textDecoration: "underline" }}>email sign-in link</button>
              )}
              <span style={{ margin: "0 8px" }}>·</span>
              <a href="#/" style={{ color: "var(--ink2)" }}>back to landing</a>
            </div>

            <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>
              Identity is keyed by email — GitHub, Google, and a magic link with the same address merge into one account.
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
      {label}
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={label !== "Email (optional)"}
        style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", boxShadow: "var(--sh-inset)", background: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none" }}
      />
    </label>
  );
}