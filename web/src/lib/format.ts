import type { VersionState } from "@confer/shared";

/** Map a state to its ink color CSS variable name. */
export function stateColor(s: string): string {
  if (s === "approved") return "var(--green)";
  if (s === "in_review") return "var(--amber)";
  if (s === "rejected") return "var(--red)";
  if (s === "draft") return "var(--ink3)";
  return "var(--ink3)"; // superseded / unknown → pencil gray
}

/** Initials from a name, e.g. "Dev Kapoor" → "DK". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Relative time from a unix-ms timestamp, e.g. "2h ago". */
export function ago(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Short commit sha, e.g. "8f3c2e1". */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

export type { VersionState };