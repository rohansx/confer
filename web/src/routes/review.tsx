import { useEffect, useState } from "react";
import {
  fetchVersion, whoami, approveVersion, rejectVersion, listHistory,
  type VersionDetail, type User, type HistoryResponse, type AnchorPayload,
} from "../lib/api";
import { StateBadge } from "../components/StateBadge";
import { ProvenancePanel } from "../components/ProvenancePanel";
import { CommentSidebar } from "../components/CommentSidebar";
import { DiffViewer } from "../components/DiffViewer";

interface Props { versionId: string }

const CONTEXT_CHARS = 32;

/**
 * The review page. Renders the doc in a sandboxed iframe, with a right-side
 * rail that has (1) Provenance, (2) Approve/Reject buttons, (3) Comment sidebar.
 * Text selected in the iframe is captured via postMessage and pre-fills the
 * comment composer.
 */
export function ReviewPage({ versionId }: Props) {
  const [v, setV] = useState<VersionDetail | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<AnchorPayload | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    fetchVersion(versionId, "")
      .then((data) => {
        setV(data);
        return listHistory(data.space, data.slug);
      })
      .then(setHist)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    whoami().then(setMe).catch(() => setMe(null));
  }, [versionId]);

  // Capture selection messages from the iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "confer:selection") return;
      const { quote, prefix, suffix, start, end } = e.data;
      if (!quote) return;
      setPendingAnchor({ quote, prefix, suffix });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
          {hist && hist.versions.length > 1 && (
            <button className="btn small" onClick={() => setShowDiff((s) => !s)}>
              {showDiff ? "Hide diff" : `Diff vs v${hist.versions[1]?.number}`}
            </button>
          )}
          {me
            ? <span className="muted small">{me.name}</span>
            : <a href="#/login" className="muted small">log in</a>}
        </div>
      </header>
      <div className="review-body">
        {showDiff ? (
          <div className="review-main">
            <DiffViewer space={v.space} slug={v.slug} from={hist?.versions[1]?.number} to={v.number} onClose={() => setShowDiff(false)} />
          </div>
        ) : (
          <iframe
            className="doc-frame"
            title={v.title}
            sandbox="allow-scripts"
            src={v.content_url}
          />
        )}
        <aside className="review-side">
          <ProvenancePanel v={v} />
          {canAct && (
            <div className="actions">
              <button className="btn primary" disabled={acting} onClick={onApprove}>Approve</button>
              <button className="btn danger" disabled={acting} onClick={onReject}>Reject</button>
            </div>
          )}
          <CommentSidebar
            space={v.space}
            slug={v.slug}
            currentVersionId={v.id}
            pendingAnchor={pendingAnchor}
            canResolve={!!hist?.is_owner}
            onPosted={() => setPendingAnchor(null)}
          />
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
