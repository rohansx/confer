import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { StateBadge } from "../components/StateBadge";
import { listHistory, whoami, approveVersion, rejectVersion, type HistoryResponse, type User } from "../lib/api";
import { fadeUp, stagger, staggerItem, easeSoft } from "../lib/motion";
import { ago, shortSha } from "../lib/format";

interface Props {
  space: string;
  slug: string;
}

export function Space({ space, slug }: Props) {
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = () =>
    listHistory(space, slug)
      .then(setHist)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    refresh();
    whoami().then(setMe).catch(() => setMe(null));
  }, [space, slug]);

  if (err) return <Shell crumb={`Spaces / ${space}`} body={<div className="notice" style={{ padding: "2rem", color: "var(--red)" }}>{err} — <a href="#/login">log in</a></div>} />;
  if (!hist) return <Shell crumb={`Spaces / ${space}`} body={<div style={{ padding: "2rem", color: "var(--ink3)" }}>Loading…</div>} />;

  const onApprove = async (id: string) => {
    setActing(id);
    try {
      await approveVersion(id);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActing(null);
    }
  };
  const onReject = async (id: string) => {
    const reason = prompt("Reason for rejection?");
    if (!reason) return;
    setActing(id);
    try {
      await rejectVersion(id, reason);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const cols = "minmax(0,1.4fr) 110px 70px 120px 110px 96px 150px";

  return (
    <Shell
      crumb={`Spaces / ${space}`}
      body={
        <motion.div initial="hidden" animate="show" variants={stagger(0.05)} style={{ display: "flex", flexDirection: "column", gap: 18, padding: "26px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>{slug}</h1>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
              {hist.versions.length} versions · space: {space}{hist.is_owner ? " · you are an owner" : ""}
            </span>
          </div>

          <motion.section
            variants={staggerItem}
            style={{ borderRadius: 10, background: "var(--raise)", boxShadow: "var(--sh-raise)", border: "1px solid var(--line)", overflow: "hidden" }}
          >
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--line)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink3)" }}>
              <span>Author</span><span>State</span><span>Ver</span><span>Commit</span><span>Branch</span><span>Pushed</span><span></span>
            </div>
            {hist.versions.map((v) => (
              <motion.div
                key={v.id}
                variants={staggerItem}
                style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "13px 20px", borderBottom: "1px solid var(--line)" }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{v.authorName ?? v.authorType}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{v.tool ?? "—"}</span>
                </span>
                <StateBadge state={v.state} />
                <a href={`#/r/${v.id}`} className="mono" style={{ fontSize: 11.5, color: "var(--ink2)" }}>v{v.number}</a>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{shortSha(v.commitSha)}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{v.branch ?? "—"}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{ago(v.pushedAt)}</span>
                <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {hist.is_owner && v.state === "in_review" && (
                    <>
                      <motion.button
                        whileTap={{ y: 1 }}
                        onClick={() => onApprove(v.id)}
                        disabled={acting === v.id}
                        style={approveBtn}
                      >
                        Approve
                      </motion.button>
                      <motion.button
                        whileTap={{ y: 1 }}
                        onClick={() => onReject(v.id)}
                        disabled={acting === v.id}
                        style={rejectBtn}
                      >
                        Reject
                      </motion.button>
                    </>
                  )}
                  {v.approvedBy && <span className="mono" style={{ fontSize: 11, color: "var(--green)", alignSelf: "center" }}>✓ {shortSha(v.approvedBy)}</span>}
                  {v.rejectedBy && <span className="mono" style={{ fontSize: 11, color: "var(--red)", alignSelf: "center" }}>✗ {shortSha(v.rejectedBy)}</span>}
                </span>
              </motion.div>
            ))}
          </motion.section>

          <p style={{ margin: 0, fontSize: 12, color: "var(--ink3)" }}>
            Agents querying MCP see only the <span style={{ color: "var(--green)", fontWeight: 600 }}>green-ink</span> rows unless a scoped token asks otherwise.
          </p>
        </motion.div>
      }
    />
  );
}

const approveBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  background: "var(--green)",
  border: "none",
  color: "#f6f3e9",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const rejectBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  background: "none",
  border: "1px solid var(--line-strong)",
  color: "var(--ink2)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

function Shell({ crumb, body }: { crumb: string; body: React.ReactNode }) {
  return (
    <>
      <TopBar crumb={crumb} />
      <div style={{ flex: 1, overflow: "auto" }}>{body}</div>
    </>
  );
}