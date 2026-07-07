import { useEffect, useState } from "react";

export interface DiffSegment {
  op: "equal" | "insert" | "delete";
  text: string;
  collapsed?: boolean;
  wordCount?: number;
}

export interface DiffResponse {
  from: { id: string; number: number; state: string };
  to:   { id: string; number: number; state: string };
  segments: DiffSegment[];
  aText: string;
  bText: string;
}

interface Props {
  space: string;
  slug: string;
  from?: number;
  to?: number;
  onClose?: () => void;
}

/**
 * Three-mode diff viewer: inline (default) | unified | side-by-side.
 * Unchanged regions are collapsed to a clickable summary.
 */
export function DiffViewer({ space, slug, from, to, onClose }: Props) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"inline" | "unified" | "side">("inline");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    const params = new URLSearchParams();
    if (from !== undefined) params.set("from", String(from));
    if (to !== undefined) params.set("to", String(to));
    fetch(`/api/v1/spaces/${space}/docs/${slug}/diff?${params}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.error ?? "diff failed");
        setData(j.data);
      })
      .catch((e) => setErr(e.message));
  }, [space, slug, from, to]);

  if (err) return <div className="notice error">diff error: {err}</div>;
  if (!data) return <div className="notice">Computing diff…</div>;

  return (
    <div className="diff">
      <header className="diff-header">
        <h3>v{data.from.number} → v{data.to.number}</h3>
        <div className="diff-modes">
          <button className={mode === "inline" ? "btn primary small" : "btn small"} onClick={() => setMode("inline")}>Inline</button>
          <button className={mode === "unified" ? "btn primary small" : "btn small"} onClick={() => setMode("unified")}>Unified</button>
          <button className={mode === "side" ? "btn primary small" : "btn small"} onClick={() => setMode("side")}>Side-by-side</button>
          {onClose && <button className="btn small" onClick={onClose}>Close</button>}
        </div>
      </header>
      {mode === "inline" && <InlineView data={data} expanded={expanded} setExpanded={setExpanded} />}
      {mode === "unified" && <UnifiedView data={data} expanded={expanded} setExpanded={setExpanded} />}
      {mode === "side" && <SideView data={data} />}
    </div>
  );
}

function InlineView({ data, expanded, setExpanded }: { data: DiffResponse; expanded: Set<number>; setExpanded: (s: Set<number>) => void }) {
  return (
    <div className="diff-inline">
      {data.segments.map((s, i) => {
        if (s.collapsed) {
          const isOpen = expanded.has(i);
          return (
            <span key={i} className="diff-collapsed" onClick={() => {
              const next = new Set(expanded);
              if (isOpen) next.delete(i); else next.add(i);
              setExpanded(next);
            }}>
              {isOpen ? s.text : ` … ${s.wordCount} unchanged words … `}
            </span>
          );
        }
        if (s.op === "equal") return <span key={i}>{s.text}</span>;
        if (s.op === "insert") return <ins key={i} className="diff-ins">{s.text}</ins>;
        return <del key={i} className="diff-del">{s.text}</del>;
      })}
    </div>
  );
}

function UnifiedView({ data, expanded, setExpanded }: { data: DiffResponse; expanded: Set<number>; setExpanded: (s: Set<number>) => void }) {
  return (
    <div className="diff-unified">
      {data.segments.map((s, i) => {
        const sign = s.op === "insert" ? "+" : s.op === "delete" ? "-" : " ";
        const cls = s.op === "insert" ? "diff-line-ins" : s.op === "delete" ? "diff-line-del" : "diff-line-eq";
        if (s.collapsed) {
          const isOpen = expanded.has(i);
          return (
            <div key={i} className={`${cls} diff-collapsed`} onClick={() => {
              const next = new Set(expanded);
              if (isOpen) next.delete(i); else next.add(i);
              setExpanded(next);
            }}>
              {isOpen ? s.text : ` … ${s.wordCount} unchanged words … `}
            </div>
          );
        }
        return <div key={i} className={cls}><span className="diff-sign">{sign}</span> {s.text}</div>;
      })}
    </div>
  );
}

function SideView({ data }: { data: DiffResponse }) {
  return (
    <div className="diff-side">
      <div className="diff-side-col">
        <h4>v{data.from.number}</h4>
        <pre>{data.aText}</pre>
      </div>
      <div className="diff-side-col">
        <h4>v{data.to.number}</h4>
        <pre>{data.bText}</pre>
      </div>
    </div>
  );
}
