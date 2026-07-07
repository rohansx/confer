import { useEffect, useState } from "react";
import {
  listHistory, approveVersion, rejectVersion, whoami,
  type HistoryResponse, type User,
} from "../lib/api";
import { StateBadge } from "../components/StateBadge";

interface Props { space: string; slug: string }

export function DocPage({ space, slug }: Props) {
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = () => listHistory(space, slug).then(setHist).catch((e) => setErr(e.message));

  useEffect(() => {
    refresh();
    whoami().then(setMe).catch(() => setMe(null));
  }, [space, slug]);

  if (err) return <div className="notice error">{err}</div>;
  if (!hist) return <div className="notice">Loading…</div>;

  const onApprove = async (id: string) => {
    setActing(id);
    try { await approveVersion(id); await refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setActing(null); }
  };
  const onReject = async (id: string) => {
    const reason = prompt("Reason?");
    if (!reason) return;
    setActing(id);
    try { await rejectVersion(id, reason); await refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setActing(null); }
  };

  return (
    <div style={{ maxWidth: 960, margin: "2rem auto", padding: "0 1.5rem", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1 style={{ margin: 0 }}>{hist.doc.title}</h1>
          <span className="muted">{space} / {slug}</span>
        </div>
        <div>
          {me
            ? <span className="muted small">Logged in as {me.name}</span>
            : <a href="#/login" className="muted small">log in</a>}
        </div>
      </header>

      <table className="history" style={{ width: "100%", marginTop: "1.5rem", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            <th>v</th>
            <th>state</th>
            <th>author</th>
            <th>commit</th>
            <th>branch</th>
            <th>pushed</th>
            <th>review</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {hist.versions.map((v) => (
            <tr key={v.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td><a href={`#/r/${v.id}`}>{v.number}</a></td>
              <td><StateBadge state={v.state} /></td>
              <td>{v.authorName ?? v.authorType}</td>
              <td className="muted small">{v.commitSha ? v.commitSha.slice(0, 8) : "—"}</td>
              <td className="muted small">{v.branch ?? "—"}</td>
              <td className="muted small">{new Date(v.pushedAt).toLocaleString()}</td>
              <td className="muted small">
                {v.approvedBy && <>✓ {v.approvedBy.slice(0, 8)}</>}
                {v.rejectedBy && <>✗ {v.rejectedBy.slice(0, 8)} — {v.rejectReason}</>}
              </td>
              <td>
                {hist.is_owner && v.state === "in_review" && (
                  <span style={{ display: "inline-flex", gap: "0.25rem" }}>
                    <button className="btn primary small" disabled={acting === v.id} onClick={() => onApprove(v.id)}>Approve</button>
                    <button className="btn danger small" disabled={acting === v.id} onClick={() => onReject(v.id)}>Reject</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
