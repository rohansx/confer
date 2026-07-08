import { CSSProperties } from "react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { initials } from "../lib/format";
import { easeSoft } from "../lib/motion";

export interface NavDef {
  key: string;
  label: string;
  href: string;
}

interface Props {
  orgName?: string;
  nav: NavDef[];
  active: string;
  user: { name: string; email?: string | null } | null;
}

const itemBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  textAlign: "left",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
  background: "none",
  color: "var(--ink2)",
};

export function Sidebar({ orgName = "cloakpipe", nav, active, user }: Props) {
  return (
    <aside
      style={{
        width: 236,
        flex: "0 0 236px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "20px 16px",
        borderRight: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px 14px" }}>
        <Logo size={28} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-.01em" }}>Confer</span>
          <span className="mono" style={{ fontSize: 9.5, color: "var(--ink3)", letterSpacing: ".04em" }}>
            docs, approved
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 12px",
          borderRadius: 10,
          boxShadow: "var(--sh-inset)",
          background: "var(--paper)",
        }}
      >
        <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }}>
          {orgName}
        </span>
        <span style={{ fontSize: 10, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".08em" }}>
          admin
        </span>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
        {nav.map((nv) => {
          const isActive = active === nv.key;
          return (
            <a
              key={nv.key}
              href={nv.href}
              style={{
                ...itemBase,
                position: "relative",
                color: isActive ? "var(--ink)" : "var(--ink2)",
                fontWeight: isActive ? 600 : 500,
                background: isActive ? "var(--raise)" : "none",
                boxShadow: isActive ? "var(--sh-raise-sm)" : "none",
                borderColor: isActive ? "var(--line)" : "transparent",
                textDecoration: "none",
              }}
            >
              {isActive && (
                <motion.span
                  layoutId="nav-dot"
                  transition={{ duration: 0.3, ease: easeSoft }}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--green)",
                    flex: "0 0 auto",
                  }}
                />
              )}
              {!isActive && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ink3)", flex: "0 0 auto" }} />
              )}
              <span>{nv.label}</span>
            </a>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <motion.div
        initial={{ opacity: 0, rotate: -1 }}
        animate={{ opacity: 1, rotate: -0.6 }}
        transition={{ duration: 0.5, ease: easeSoft }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 14,
          borderRadius: 10,
          background: "var(--glass-bg)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(var(--blur))",
          WebkitBackdropFilter: "blur(var(--blur))",
          boxShadow: "var(--sh-raise-sm)",
        }}
      >
        <span className="hand" style={{ fontSize: 18, color: "var(--green)", lineHeight: 1.25 }}>
          green ink = a human signed it ✓
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>
          agents only ever read green.
        </span>
      </motion.div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px 2px" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--raise)",
            boxShadow: "var(--sh-raise-sm)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--green)",
          }}
        >
          {user ? initials(user.name) : "?"}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {user ? (
            <>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{user.name}</span>
              <span style={{ fontSize: 10.5, color: "var(--ink3)" }}>{user.email ?? "signed in"}</span>
            </>
          ) : (
            <a href="#/login" style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              log in
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}