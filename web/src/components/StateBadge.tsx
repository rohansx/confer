import type { CSSProperties } from "react";
import type { VersionState } from "@confer/shared";

const base: CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: "6px",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: "10px",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  lineHeight: 1.4,
};

const variants: Record<string, CSSProperties> = {
  approved: { background: "rgba(58,125,68,.1)", color: "var(--green)", border: "1.5px solid var(--green)" },
  in_review: { background: "rgba(160,106,31,.1)", color: "var(--amber)", border: "1px solid var(--amber)" },
  rejected: { background: "rgba(176,58,46,.08)", color: "var(--red)", border: "1px solid var(--red)" },
  draft: { background: "none", color: "var(--ink3)", border: "1px dashed var(--line-strong)" },
  superseded: { background: "none", color: "var(--ink3)", border: "1px solid var(--line)" },
};

export function StateBadge({ state, style }: { state: VersionState | string; style?: CSSProperties }) {
  return <span style={{ ...base, ...variants[state] ?? variants.superseded, ...style }}>{state.replace("_", " ")}</span>;
}