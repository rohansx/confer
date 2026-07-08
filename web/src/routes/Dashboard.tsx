import { useEffect, useState, Fragment } from "react";
import { animate, motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { listSpaces, listSpaceDocs, type SpaceRow, type SpaceDocRow } from "../lib/api";
import { fadeUp, stagger, staggerItem, hoverLift, easeSoft } from "../lib/motion";
import { ago, shortSha, stateColor } from "../lib/format";

function CountUp({ to }: { to: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const controls = animate(0, to, { duration: 1.1, ease: easeSoft, onUpdate: (v) => setVal(Math.round(v)) });
    return () => controls.stop();
  }, [to]);
  return <>{val}</>;
}

export function Dashboard() {
  const [docs, setDocs] = useState<SpaceDocRow[] | null>(null);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listSpaces()
      .then(async (sp) => {
        setSpaces(sp);
        const perSpace = await Promise.all(sp.map((s) => listSpaceDocs(s.slug).then((r) => r.docs).catch(() => [] as SpaceDocRow[])));
        setDocs(perSpace.flat());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const inReview = (docs ?? []).filter((d) => d.state === "in_review");
  const approved = (docs ?? []).filter((d) => d.state === "approved");
  const stats = [
    { label: "Docs", value: docs?.length ?? 0, sub: spaces.length ? `${spaces.length} spaces` : "loading…", color: "var(--blue)" },
    { label: "In review", value: inReview.length, sub: "waiting on you", color: "var(--amber)", highlight: false },
    { label: "Approved", value: approved.length, sub: "live for agents", color: "var(--green)", highlight: false },
    { label: "Read by agents", value: 0, sub: "not tracked yet", color: "var(--green)", highlight: true, dash: true },
  ];
  const recent = [...approved].sort((a, b) => (b.approved_at ?? 0) - (a.approved_at ?? 0)).slice(0, 6);

  return (
    <>
      <TopBar crumb="Overview" />
      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger(0.06)}
        style={{ flex: 1, overflow: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 24 }}
      >
        {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err} — <a href="#/login">log in</a></div>}

        {/* stat row */}
        <section style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
          {stats.map((s, i) => (
            <Fragment key={s.label}>
              <motion.div
                variants={staggerItem}
                {...hoverLift}
                style={{
                  flex: 1, padding: "18px 20px", borderRadius: 12, background: "var(--raise)",
                  boxShadow: "var(--sh-raise)", border: s.highlight ? "2px solid var(--green)" : "1px solid var(--line)",
                  display: "flex", flexDirection: "column", gap: 4,
                }}
              >
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", color: s.color }}>{s.label}</span>
                <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", color: s.highlight ? "var(--green)" : "var(--ink)" }}>
                  {s.dash ? "—" : <CountUp to={s.value} />}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{s.sub}</span>
              </motion.div>
              {!s.dash && i < stats.length - 1 && (
                <div style={{ alignSelf: "center", padding: "0 12px", color: "var(--ink3)", fontFamily: "Caveat, cursive", fontSize: 20 }}>→</div>
              )}
            </Fragment>
          ))}
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
          {/* waiting on you — REAL in-review docs */}
          <motion.section variants={staggerItem} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Waiting on you</h2>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
                {docs ? `${inReview.length} open review${inReview.length === 1 ? "" : "s"}` : "loading…"}
              </span>
            </div>
            {docs && inReview.length === 0 && (
              <div style={{ padding: "1rem", color: "var(--ink3)", fontSize: 13 }}>Nothing waiting — all docs are approved or draft. <a href="#/upload">Upload one →</a></div>
            )}
            {inReview.map((rv) => (
              <motion.a
                key={rv.version_id}
                href={`#/r/${rv.version_id}`}
                variants={staggerItem}
                whileHover={{ y: -2, borderColor: "var(--line-strong)" }}
                whileTap={{ y: 0 }}
                style={{
                  display: "flex", alignItems: "center", gap: 14, textAlign: "left", width: "100%",
                  padding: "16px 18px", borderRadius: 10, background: "var(--raise)", boxShadow: "var(--sh-raise-sm)",
                  border: "1px solid var(--line)", color: "var(--ink)", textDecoration: "none",
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: stateColor(rv.state) }} />
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 14.5 }}>{rv.title}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {rv.space} · {rv.source_repo ?? "—"} @ {shortSha(rv.commit_sha)} · {ago(rv.updated_at)}
                  </span>
                </span>
                <span className="hand" style={{ fontSize: 17, color: "var(--red)", whiteSpace: "nowrap" }}>in review</span>
                <span style={{ color: "var(--ink3)" }}>›</span>
              </motion.a>
            ))}
          </motion.section>

          {/* margin notes — recent approvals (real) */}
          <motion.aside
            variants={staggerItem}
            style={{
              display: "flex", flexDirection: "column", gap: 0, padding: 18, borderRadius: 10,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              backdropFilter: "blur(var(--blur))", WebkitBackdropFilter: "blur(var(--blur))", boxShadow: "var(--sh-raise-sm)",
            }}
          >
            <h2 style={{ margin: "0 0 14px", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink2)" }}>Margin notes</h2>
            {docs && recent.length === 0 && (
              <span style={{ fontSize: 12.5, color: "var(--ink3)" }}>No approvals yet — approve a doc to see it here.</span>
            )}
            <motion.div initial="hidden" animate="show" variants={stagger(0.05)} style={{ display: "flex", flexDirection: "column" }}>
              {recent.map((d, i) => (
                <motion.div key={d.version_id} variants={staggerItem} style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: i < recent.length - 1 ? "1px solid var(--line)" : "none" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5, flex: "0 0 auto", background: "var(--green)" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--ink)" }}>
                      <strong style={{ fontWeight: 600 }}>{shortSha(d.approved_by)}</strong> approved {d.slug.replace(/^[^-]+--/, "")}
                    </span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{d.approved_at ? ago(d.approved_at) : "—"} · {d.source_repo ?? d.space}</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.aside>
        </div>
      </motion.div>
    </>
  );
}