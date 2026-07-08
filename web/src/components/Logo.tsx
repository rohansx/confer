import type { CSSProperties } from "react";

/** The Confer mark: two stacked paper sheets with an approval dot. */
export function Logo({ size = 28, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" style={style}>
      <rect x="9" y="3" width="15" height="19" rx="3" fill="none" stroke="var(--ink3)" strokeWidth="2" />
      <rect x="3" y="7" width="15" height="19" rx="3" fill="none" stroke="var(--ink)" strokeWidth="2.4" />
      <circle cx="10.5" cy="16.5" r="2.4" fill="var(--green)" />
    </svg>
  );
}