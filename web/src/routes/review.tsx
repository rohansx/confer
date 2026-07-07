import { useEffect, useState } from "react";
import {
  fetchVersion, whoami, approveVersion, rejectVersion, listHistory,
  type VersionDetail, type User, type HistoryResponse,
} from "../lib/api";
import { StateBadge } from "../components/StateBadge";
import { ProvenancePanel } from "../components/ProvenancePanel";

interface Props { versionId: string }

/**
 * The review page: renders a version's doc inside a sandboxed iframe served
 * from the content origin, alongside its provenance. If the viewer is a
 * space owner and the version is in_review, shows Approve / Reject buttons.
 */
export function ReviewPage({ versionId }: Props) {
  const [v, setV] = useState<VersionDetail | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = () => {
    whoami().then(setMe).catch(() => setMe(null));
  };

  useEffect(() => {
    // Session auth via the confer_session cookie — no token needed.
    fetchVersion(versionId, "")
      .then((data) => {
        setV(data);
        return listHistory(data.space, data.slug);
      })
      .then(setHist)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    load();
  }, [versionId]);

  if (error) return <div className="notice error">{error}</div>;
  if (!v) return <div className="notice">Loading…</div>;

  const canAct = hist?.is_owner === true && v.state === "in_review";

  const onApprove = async () => {
    setActing(true);
    try { await approveVersion(v.id); await refresh(v, setV, setHist); }
    catch (e) { alert((e as Error).message); }
    finally { setActing(false); }
  };
  const onReject = async () => {
    const reason = prompt("Reason for rejection?");
    if (!reason) return;
    setActing(true);
    try { await rejectVersion(v.id, reason); await refresh(v, setV, setHist); }
    catch (e) { alert((e as Error).message); }
    finally { setActing(false); }
  };

  return (
    <div className="review">
      <header className="review-header">
        <div>
          <h1>{v.title}</h1>
          <span className="muted">
            <a href={`#/d/${v.space}/${v.slug}`}>{v.space} / {v.slug}</a> · v{v.number}
          </span>
        </div>
        <div className="header-right">
          <StateBadge state={v.state} />
          {me
            ? <span className="muted small">{me.name}</span>
            : <a href="#/login" className="muted small">log in</a>}
        </div>
      </header>
      <div className="review-body">
        <iframe
          className="doc-frame"
          title={v.title}
          sandbox="allow-scripts"
          src={v.content_url}
        />
        <aside className="review-side">
          <ProvenancePanel v={v} />
          {canAct && (
            <div className="actions">
              <button className="btn primary" disabled={acting} onClick={onApprove}>Approve</button>
              <button className="btn danger" disabled={acting} onClick={onReject}>Reject</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

async function refresh(
  v: VersionDetail,
  setV: (v: VersionDetail) => void,
  setHist: (h: HistoryResponse) => void,
) {
  const fresh = await fetchVersion(v.id, "");
  setV(fresh);
  setHist(await listHistory(fresh.space, fresh.slug));
}
