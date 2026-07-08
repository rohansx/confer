import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { StateBadge } from "../components/StateBadge";
import { listSpaceDocs, type SpaceDocRow, type SpaceDocsResponse } from "../lib/api";
import { fadeUp, stagger, staggerItem } from "../lib/motion";
import { ago, shortSha } from "../lib/format";

interface RepoGroup {
  name: string;
  docs: SpaceDocRow[];
  open: number;
}

function groupByRepo(docs: SpaceDocRow[]): RepoGroup[] {
  const map = new Map<string, SpaceDocRow[]>();
  for (const d of docs) {
    const repo = d.source_repo ?? d.space;
    const arr = map.get(repo) ?? [];
    arr.push(d);
    map.set(repo, arr);
  }
  // sort each repo's docs by most recent
  const groups: RepoGroup[] = [];
  for (const [name, ds] of map) {
    ds.sort((a, b) => b.updated_at - a.updated_at);
    groups.push({ name, docs: ds, open: ds.filter((x) => x.state === "in_review").length });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

export function Repos({ space = "utkrusht" }: { space?: string }) {
  const [data, setData] = useState<SpaceDocsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listSpaceDocs(space)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [space]);

  const groups = data ? groupByRepo(data.docs) : [];

  return (
    <>
      <TopBar crumb={`Repos · ${space}`} />
      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger(0.07)}
        style={{ flex: 1, overflow: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18 }}
      >
        <motion.div variants={staggerItem} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>Live docs by repo</h1>
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
            {data ? `${data.docs.length} docs · grouped by source repo` : "loading…"}
          </span>
        </motion.div>

        {err && (
          <motion.div variants={staggerItem} style={{ color: "var(--red)", fontSize: 13 }}>
            {err} — <a href="#/login">log in</a>
          </motion.div>
        )}

        {data && groups.length === 0 && (
          <motion.div variants={staggerItem} style={{ color: "var(--ink3)", fontSize: 13 }}>
            No docs in <strong>{space}</strong> yet. <a href="#/upload">Upload one →</a> or run the utkrusht-ai import script.
          </motion.div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 20, alignItems: "start" }}>
          {groups.map((r) => (
            <motion.section
              key={r.name}
              variants={staggerItem}
              style={{ borderRadius: 10, background: "var(--raise)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", overflow: "hidden" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--green)", transform: "rotate(45deg)" }} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</span>
                <div style={{ flex: 1 }} />
                <span
                  className="mono"
                  style={{
                    fontSize: 10, padding: "3px 9px", borderRadius: 6, whiteSpace: "nowrap",
                    background: r.open > 0 ? "rgba(160,106,31,.1)" : "none",
                    color: r.open > 0 ? "var(--amber)" : "var(--ink3)",
                    border: r.open > 0 ? "1px solid var(--amber)" : "1px solid var(--line)",
                  }}
                >
                  {r.open > 0 ? `${r.open} in review` : "all approved"}
                </span>
              </div>
              {r.docs.slice(0, 6).map((d) => (
                <a
                  key={d.version_id}
                  href={`#/r/${d.version_id}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "var(--ink)" }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
                  <span className="mono" style={{ fontSize: 12, flex: 1, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.slug}</span>
                  <StateBadge state={d.state} style={{ fontSize: 9, padding: "2px 7px" }} />
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{ago(d.updated_at)}</span>
                </a>
              ))}
              {r.docs.length > 6 && (
                <div style={{ padding: "10px 18px" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>
                    +{r.docs.length - 6} more · search_docs(repo: "{r.name}")
                  </span>
                </div>
              )}
              {r.docs.length <= 6 && (
                <div style={{ padding: "10px 18px" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>
                    search_docs(repo: "{r.name}") → approved only
                  </span>
                </div>
              )}
            </motion.section>
          ))}
        </div>
      </motion.div>
    </>
  );
}