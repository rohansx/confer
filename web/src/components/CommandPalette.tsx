import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { searchDocs, type SearchHit } from "../lib/api";
import { StateBadge } from "./StateBadge";
import { easeSoft } from "../lib/motion";
import { ago, shortSha } from "../lib/format";

/** Global ⌘K / Ctrl+K command palette. Searches approved + in-review docs and
 *  jumps to a doc's review. Mount once; controlled by `open`/`onClose`. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // debounce search
  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setActive(0);
      return;
    }
    const t = setTimeout(() => {
      if (!q.trim()) {
        setHits([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      searchDocs(q, { limit: 12 })
        .then((h) => {
          setHits(h);
          setActive(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const go = (h: SearchHit) => {
    window.location.hash = `#/r/${h.version_id}`;
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{ position: "fixed", inset: 0, background: "rgba(43,40,32,.45)", backdropFilter: "blur(3px)", zIndex: 200, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh" }}
        >
          <motion.div
            initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ ease: easeSoft }}
            onClick={(e) => e.stopPropagation()}
            style={panelStyle}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ color: "var(--ink3)", fontSize: 13 }}>⌘K</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="search docs…"
                style={{ flex: 1, border: "none", background: "none", outline: "none", fontFamily: "'Source Serif 4', serif", fontSize: 16, color: "var(--ink)" }}
              />
              <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{loading ? "…" : `${hits.length}`}</span>
            </div>
            <div style={{ maxHeight: "52vh", overflow: "auto" }}>
              {!q.trim() && <div style={{ padding: "20px 18px", color: "var(--ink3)", fontSize: 13 }}>Type to search approved + in-review docs.</div>}
              {q.trim() && hits.length === 0 && !loading && <div style={{ padding: "20px 18px", color: "var(--ink3)", fontSize: 13 }}>No matches.</div>}
              {hits.map((h, i) => (
                <motion.button
                  key={h.version_id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "11px 18px",
                    border: "none", borderBottom: "1px solid var(--line)", background: i === active ? "rgba(58,125,68,.08)" : "none",
                    cursor: "pointer", color: "var(--ink)", fontFamily: "inherit",
                  }}
                >
                  <StateBadge state={h.state} style={{ fontSize: 9, padding: "2px 7px" }} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.space} / {h.slug} · {h.source_repo ?? "—"} @ {shortSha(h.commit_sha)} · {ago(h.updated_at)}
                    </span>
                  </span>
                  {h.state === "approved" && <span className="mono" style={{ fontSize: 10, color: "var(--green)" }}>✓</span>}
                </motion.button>
              ))}
            </div>
            <div style={{ padding: "9px 18px", borderTop: "1px solid var(--line)", display: "flex", gap: 14, fontSize: 10.5, color: "var(--ink3)" }}>
              <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const panelStyle: CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  background: "var(--paper-hi)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  boxShadow: "var(--sh-raise), 0 30px 60px -20px rgba(80,70,50,.5)",
  overflow: "hidden",
};