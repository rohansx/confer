import type { VersionDetail } from "../lib/api";

export function ProvenancePanel({ v }: { v: VersionDetail }) {
  const p = v.provenance;
  const rows: [string, string | null][] = [
    ["Author", `${p.author_type}${p.author_name ? ` · ${p.author_name}` : ""}`],
    ["Tool", p.tool],
    ["Repo", p.source_repo],
    ["Commit", p.commit_sha ? p.commit_sha.slice(0, 12) : null],
    ["Branch", p.branch],
    ["Origin", v.origin],
    ["Pushed", p.pushed_at ? new Date(p.pushed_at).toLocaleString() : null],
  ];
  return (
    <aside className="provenance">
      <h2>Provenance</h2>
      <dl>
        {rows
          .filter(([, val]) => val)
          .map(([k, val]) => (
            <div key={k} className="prov-row">
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
      </dl>
    </aside>
  );
}
