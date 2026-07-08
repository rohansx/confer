import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { StateBadge } from "../components/StateBadge";
import { listStarred, unstarDoc, type SpaceDocRow } from "../lib/api";
import { fadeUp, stagger, staggerItem } from "../lib/motion";
import { ago, shortSha } from "../lib/format";

interface RepoGroup { name: string; docs: SpaceDocRow[]; }

function groupByRepo(docs: SpaceDocRow[]): RepoGroup[] {
  const map = new Map<string, SpaceDocRow[]>();
  for (const d of docs) {
    const repo = d.source_repo ?? d.space;
    const arr = map.get(repo) ?? [];
    arr.push(d);
    map.set(repo, arr);
  }
  const groups: RepoGroup[] = [];
  for (const [name, ds] of map) {
    ds.sort((a, b) => b.updated_at - a.updated_at);
    groups.push({ name, docs: ds });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

export function Starred() {
  const [docs, setDocs] = useState<SpaceDocRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () =>
    listStarred()
      .then(setDocs)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));

  useEffect(() => { refresh(); }, []);

  const groups = docs ? groupByRepo(docs) : [];
  const unstar = async (d: SpaceDocRow) => {
    try { await unstarDoc(d.doc_id); await refresh(); } catch (e) { alert((e as Error).message); }
  };

  return (
    <>
      <TopBar crumb="Starred" />
      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger(0.07)}
        style={{ flex: 1, overflow: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18 }}
      >
        <motion.div variants={staggerItem} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>★ Starred docs</h1>
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>
            {docs ? `${docs.length} starred · ${groups.length} repo${groups.length === 1 ? "" : "s"}` : "loading…"}
          </span>
        </motion.div>

        {err && <motion.div variants={staggerItem} style={{ color: "var(--red)", fontSize: 13 }}>{err} — <a href="#/login">log in</a></motion.div>}

        {docs && docs.length === 0 && (
          <motion.div variants={staggerItem} style={{ color: "var(--ink3)", fontSize: 13 }}>
            No starred docs yet. Star a doc from its review page (☆) to bookmark it here.
          </motion.div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 20, alignItems: "start" }}>
          {groups.map((r) => (
            <motion.section key={r.name} variants={staggerItem}
              style={{ borderRadius: 10, background: "var(--raise)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--green)", transform: "rotate(45deg)" }} />
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</span>
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>{r.docs.length} starred</span>
              </div>
              {r.docs.map((d) => (
                <div key={d.version_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
                  <a href={`#/r/${d.version_id}`} style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0, textDecoration: "none", color: "var(--ink)" }}>
                    <span className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.slug}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{d.space} · {ago(d.updated_at)}</span>
                  </a>
                  <StateBadge state={d.state} style={{ fontSize: 9, padding: "2px 7px" }} />
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => unstar(d)} title="Unstar"
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "var(--green)", padding: 0 }}>★</motion.button>
                </div>
              ))}
              <div style={{ padding: "10px 18px" }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>repo: "{r.name}" · search_docs(repo: "{r.name}")</span>
              </div>
            </motion.section>
          ))}
        </div>
      </motion.div>
    </>
  );
}