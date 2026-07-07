const COLORS: Record<string, string> = {
  draft: "#6b7280",
  in_review: "#c2680c",
  approved: "#15803d",
  superseded: "#4f46e5",
  rejected: "#b91c1c",
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className="badge" style={{ backgroundColor: COLORS[state] ?? "#6b7280" }}>
      {state.replace("_", " ")}
    </span>
  );
}
