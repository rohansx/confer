import { motion } from "framer-motion";
import { fadeUp } from "../lib/motion";

export function TopBar({ crumb }: { crumb: string }) {
  return (
    <motion.header
      initial="hidden"
      animate="show"
      variants={fadeUp}
      style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 28px", borderBottom: "1px solid var(--line)" }}
    >
      <span style={{ fontSize: 15, fontWeight: 600 }}>{crumb}</span>
      <div style={{ flex: 1 }} />
      <div
        onClick={() => window.dispatchEvent(new CustomEvent("confer:open-search"))}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderRadius: 10,
          boxShadow: "var(--sh-inset)",
          background: "var(--paper)",
          minWidth: 280,
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--ink3)", fontSize: 12 }}>⌘K</span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink3)" }}>search approved docs…</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 10,
          background: "var(--raise)",
          boxShadow: "var(--sh-raise-sm)",
          border: "1px solid var(--line)",
        }}
      >
        <motion.span
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }}
        />
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink2)" }}>confer push</span>
      </div>
    </motion.header>
  );
}