import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { StateBadge } from "../components/StateBadge";
import {
  fetchVersion,
  listHistory,
  approveVersion,
  rejectVersion,
  whoami,
  listComments,
  createComment,
  resolveComment,
  fetchDiff,
  starDoc,
  unstarDoc,
  listStarred,
  type VersionDetail,
  type HistoryResponse,
  type User,
  type CommentListResponse,
  type AnchorPayload,
  type DiffResponse,
} from "../lib/api";
import { fadeUp, stagger, staggerItem, easeSoft } from "../lib/motion";
import { ago, shortSha, stateColor, initials } from "../lib/format";

const tabDefs = [
  { k: "comments", l: "Comments" },
  { k: "prov", l: "Provenance" },
  { k: "context", l: "Context" },
] as const;

export function Review({ versionId }: { versionId: string }) {
  const [v, setV] = useState<VersionDetail | null>(null);
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [comments, setComments] = useState<CommentListResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof tabDefs)[number]["k"]>("comments");
  const [acting, setActing] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<AnchorPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [starred, setStarred] = useState(false);
  const [starBusy, setStarBusy] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Tell the sandboxed doc iframe to drop its persistent anchor highlight.
  const clearIframeSelection = () => {
    try { frameRef.current?.contentWindow?.postMessage({ type: "confer:clear-selection" }, "*"); } catch { /* ignore */ }
  };

  const loadComments = () =>
    v && listComments(v.space, v.slug, { includeResolved: true }).then(setComments).catch(() => setComments(null));

  useEffect(() => {
    fetchVersion(versionId, "")
      .then((data) => {
        setV(data);
        listHistory(data.space, data.slug).then(setHist).catch(() => setHist(null));
        listComments(data.space, data.slug, { includeResolved: true }).then(setComments).catch(() => setComments(null));
        listStarred()
          .then((docs) => setStarred(docs.some((d) => d.doc_id === data.doc_id)))
          .catch(() => setStarred(false));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    whoami().then(setMe).catch(() => setMe(null));
  }, [versionId]);

  // capture text selections from the sandboxed iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "confer:selection") return;
      const { quote, prefix, suffix } = e.data;
      if (!quote) return;
      setPendingAnchor({ quote, prefix, suffix });
      setTab("comments"); // surface the composer so the captured quote is in view
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!showDiff || !v) return;
    fetchDiff(v.space, v.slug, { from: hist?.versions.find((x) => x.id !== versionId)?.number, to: v.number })
      .then((d) => { setDiff(d); setDiffError(null); })
      .catch(() => { setDiff(null); setDiffError("No prior version to diff against."); });
  }, [showDiff, v, hist, versionId]);

  if (err) return <div style={{ padding: "3rem", color: "var(--red)" }}>{err} — <a href="#/login">log in</a></div>;
  if (!v) return <div style={{ padding: "3rem", color: "var(--ink3)" }}>Loading…</div>;

  const canAct = hist?.is_owner === true && v.state === "in_review";

  const refresh = async () => {
    const fresh = await fetchVersion(versionId, "");
    setV(fresh);
    setHist(await listHistory(fresh.space, fresh.slug).catch(() => hist));
  };

  const onApprove = async () => {
    setActing(true);
    try { await approveVersion(v.id); await refresh(); }
    catch (e) { alert((e as Error).message); } finally { setActing(false); }
  };
  const confirmReject = async () => {
    if (!rejectReason.trim()) return;
    setRejectOpen(false);
    setActing(true);
    try { await rejectVersion(v.id, rejectReason.trim()); setRejectReason(""); await refresh(); }
    catch (e) { alert((e as Error).message); } finally { setActing(false); }
  };

  const onComment = async () => {
    if (!draft.trim()) return;
    try {
      await createComment(v.space, v.slug, { body: draft.trim(), version_id: v.id, anchor: pendingAnchor });
      setDraft(""); setPendingAnchor(null); clearIframeSelection(); await loadComments();
    } catch (e) { alert((e as Error).message); }
  };

  const toggleStar = async () => {
    setStarBusy(true);
    try {
      if (starred) { await unstarDoc(v.doc_id); setStarred(false); }
      else { await starDoc(v.doc_id); setStarred(true); }
    } catch (e) { alert((e as Error).message); }
    finally { setStarBusy(false); }
  };

  const approved = v.state === "approved";

  const starBtn = (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggleStar}
      disabled={starBusy}
      title={starred ? "Unstar" : "Star this doc"}
      style={{
        background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1,
        color: starred ? "var(--green)" : "var(--ink3)", padding: 0,
      }}
    >
      {starred ? "★" : "☆"}
    </motion.button>
  );

  const headerActions = canAct ? (
    <>
      <motion.button whileTap={{ y: 1 }} onClick={() => setRejectOpen(true)} disabled={acting} style={rejectBtn}>Reject…</motion.button>
      <motion.button whileHover={{ y: -1 }} whileTap={{ y: 1 }} onClick={onApprove} disabled={acting} style={approveBtn}>Approve v{v.number}</motion.button>
    </>
  ) : null;

  const approvedBanner = approved && (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, ease: easeSoft }}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderRadius: 10, background: "rgba(58,125,68,.08)", border: "1.5px solid var(--green)" }}
    >
      <span className="hand" style={{ fontSize: 20, color: "var(--green)" }}>signed ✓</span>
      <span style={{ fontSize: 13, color: "var(--ink)" }}><strong style={{ color: "var(--green)" }}>v{v.number} is live for agents.</strong> Approval recorded in the audit trail.</span>
    </motion.div>
  );

  // doc sheet (shared by normal + maximized layouts)
  const docSheet = (
<section style={{ ...sheetStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid var(--line)", background: "var(--raise)" }}>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>view.conferusercontent.com · sandboxed · zero cookies</span>
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 6, background: "rgba(58,125,68,.1)", color: "var(--green)" }}>+ added</span>
        <span className="mono" style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 6, background: "rgba(176,58,46,.1)", color: "var(--red)" }}>− removed</span>
        <motion.button whileTap={{ y: 1 }} onClick={() => setShowDiff((s) => !s)}
          style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid var(--line)", background: showDiff ? "var(--raise)" : "none", color: "var(--ink2)", fontSize: 11, cursor: "pointer", boxShadow: showDiff ? "var(--sh-inset)" : "none" }}>
          {showDiff ? "view doc" : `diff vs v${hist?.versions.find((x) => x.id !== versionId)?.number ?? "•"}`}
        </motion.button>
        <motion.button whileTap={{ y: 1 }} onClick={() => { window.location.href = v.content_url + "&overlay=1&app=" + encodeURIComponent(window.location.origin) + "&space=" + encodeURIComponent(v.space) + "&slug=" + encodeURIComponent(v.slug) + "&vid=" + v.id; }} title="Maximize — full page"
          style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid var(--line)", background: "none", color: "var(--ink2)", fontSize: 11, cursor: "pointer" }}>
          ⤢ maximize
        </motion.button>
      </div>
      {showDiff ? <DiffBody diff={diff} error={diffError} /> : <iframe ref={frameRef} className="doc-frame" title={v.title} sandbox="allow-scripts" src={v.content_url} style={{ minHeight: "72vh" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", borderTop: "1px solid var(--line)" }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>blake3:{v.id.slice(0, 8)}… · immutable</span>
      </div>
    </section>
  );

  // margin aside (shared)
  const asideNode = (
<motion.aside initial="hidden" animate="show" variants={fadeUp} style={{ ...asideStyle }}>
      <div style={{ display: "flex", gap: 0, padding: 3, borderRadius: 9, boxShadow: "var(--sh-inset)", background: "var(--paper)" }}>
        {tabDefs.map((t) => (
          <motion.button key={t.k} onClick={() => setTab(t.k)} whileTap={{ y: 1 }}
            style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: tab === t.k ? "var(--ink)" : "var(--ink3)", background: tab === t.k ? "var(--raise)" : "none", boxShadow: tab === t.k ? "var(--sh-raise-sm)" : "none" }}>
            {t.l}
          </motion.button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: easeSoft }}>
          {tab === "comments" && (
            <CommentsTab comments={comments} canResolve={!!hist?.is_owner} pendingAnchor={pendingAnchor} draft={draft} setDraft={setDraft}
              onComment={onComment} onResolve={async (id) => { await resolveComment(id); await loadComments(); }} onClearAnchor={() => { setPendingAnchor(null); clearIframeSelection(); }} />
          )}
          {tab === "prov" && <ProvenanceTab v={v} hist={hist} />}
          {tab === "context" && <ContextTab />}
        </motion.div>
      </AnimatePresence>
    </motion.aside>
  );

  // timeline rail (normal layout only)
  const timeline = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 0, paddingTop: 6 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink3)", marginBottom: 10, textAlign: "center" }}>History</span>
      {(hist?.versions ?? []).map((vv, i) => {
        const sel = vv.id === versionId;
        return (
          <div key={vv.id}>
            <motion.a href={`#/r/${vv.id}`} whileHover={{ borderColor: "var(--line-strong)" }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 6px", borderRadius: 10, textDecoration: "none", color: sel ? "var(--ink)" : "var(--ink2)", background: sel ? "var(--raise)" : "none", boxShadow: sel ? "var(--sh-raise-sm)" : "none", border: sel ? "1px solid var(--line)" : "1px solid transparent" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: stateColor(vv.state) }} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>v{vv.number}</span>
              <span style={{ fontSize: 9.5, color: "var(--ink3)" }}>{ago(vv.pushedAt)}</span>
            </motion.a>
            {i < (hist?.versions.length ?? 0) - 1 && <div style={{ width: 1, height: 14, background: "var(--line-strong)", margin: "0 auto" }} />}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {/* normal layout */}
      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
        <motion.div initial="hidden" animate="show" variants={fadeUp} style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <a href="#/app" style={{ color: "var(--ink3)", fontSize: 12.5, textDecoration: "none" }}>← Overview</a>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-.01em" }}>{v.title}</h1>
              <StateBadge state={v.state} />
              {starBtn}
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
              {v.space} / {v.slug} · {v.provenance.source_repo ?? "—"} @ {shortSha(v.provenance.commit_sha)} · pushed by {v.provenance.author_name ?? v.provenance.author_type} · {ago(v.provenance.pushed_at)}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {headerActions}
        </motion.div>

        <AnimatePresence>{approvedBanner}</AnimatePresence>

        <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0,1fr) 330px", gap: 20, alignItems: "start" }}>
          {timeline}
          {docSheet}
          {asideNode}
        </div>
      </div>


      <RejectModal
        open={rejectOpen}
        reason={rejectReason}
        setReason={setRejectReason}
        onCancel={() => { setRejectOpen(false); setRejectReason(""); }}
        onConfirm={confirmReject}
      />
    </>
  );
}

function DiffBody({ diff, error }: { diff: DiffResponse | null; error?: string | null }) {
  if (!diff) return <div style={{ padding: "2rem", color: "var(--ink3)", textAlign: "center" }}>{error ?? "Loading diff…"}</div>;
  return (
    <div style={{ padding: "20px 28px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {diff.segments.map((s, i) => {
        if (s.op === "insert") return <span key={i} style={{ background: "rgba(58,125,68,.14)", color: "var(--ink)" }}>{s.text}</span>;
        if (s.op === "delete") return <span key={i} style={{ background: "rgba(176,58,46,.12)", color: "var(--red)", textDecoration: "line-through" }}>{s.text}</span>;
        return <span key={i} style={{ color: "var(--ink2)" }}>{s.text}</span>;
      })}
    </div>
  );
}

function CommentsTab({
  comments, canResolve, pendingAnchor, draft, setDraft, onComment, onResolve, onClearAnchor,
}: {
  comments: CommentListResponse | null;
  canResolve: boolean;
  pendingAnchor: AnchorPayload | null;
  draft: string;
  setDraft: (s: string) => void;
  onComment: () => void;
  onResolve: (id: string) => void;
  onClearAnchor: () => void;
}) {
  const rows = comments?.comments ?? [];
  return (
    <motion.div initial="hidden" animate="show" variants={stagger(0.05)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pendingAnchor && (
        <div style={{ padding: "8px 10px", borderLeft: "2px solid var(--amber)", background: "rgba(224,168,38,.10)", borderRadius: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--amber)", fontWeight: 700 }}>Commenting on</span>
            <div style={{ flex: 1 }} />
            <button onClick={onClearAnchor} title="Clear selection" style={{ background: "none", border: "none", color: "var(--ink3)", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
          </div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "var(--ink2)", fontStyle: "italic" }}>
            “{pendingAnchor.quote.slice(0, 100)}{pendingAnchor.quote.length > 100 ? "…" : ""}”
          </span>
        </div>
      )}
      {rows.length === 0 && <span style={{ fontSize: 12, color: "var(--ink3)" }}>No comments yet. Select text in the doc to anchor one.</span>}
      {rows.map((c) => {
        const res = c.resolved_at != null;
        return (
          <motion.div key={c.id} variants={staggerItem} style={{ display: "flex", flexDirection: "column", gap: 9, padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--raise)", boxShadow: "var(--sh-raise-sm)", opacity: res ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--raise)", boxShadow: "var(--sh-raise-sm)", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, color: "var(--red)" }}>{initials(c.author_name ?? c.author_user_id)}</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{c.author_name ?? c.author_user_id.slice(0, 8)}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink3)" }}>{ago(c.created_at)}</span>
              {c.is_carried_over && <span className="mono" style={{ fontSize: 9, color: "var(--ink3)", background: "var(--paper)", padding: "1px 6px", borderRadius: 5 }}>carried</span>}
            </div>
            {c.anchor_quote && (
              <div style={{ padding: "8px 10px", borderLeft: "2px solid var(--red)", background: "rgba(176,58,46,.05)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "var(--ink3)", fontStyle: "italic" }}>“{c.anchor_quote}”</div>
            )}
            <p style={{ margin: 0, fontFamily: "'Caveat', cursive", fontSize: 18, lineHeight: 1.35, color: "var(--red)" }}>{c.body}</p>
            {canResolve && (
              <motion.button whileTap={{ y: 1 }} onClick={() => onResolve(c.id)} style={res ? resolvedBtn : resolveBtn}>
                {res ? "✓ Resolved — reopen" : "Resolve thread"}
              </motion.button>
            )}
          </motion.div>
        );
      })}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 9, boxShadow: "var(--sh-inset)", background: "var(--paper)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onComment(); }}
          placeholder={pendingAnchor ? "Comment on selection…" : "Comment…"}
          style={{ flex: 1, border: "none", background: "none", outline: "none", fontFamily: "inherit", fontSize: 12, color: "var(--ink)" }}
        />
        <motion.button whileTap={{ y: 1 }} onClick={onComment} style={{ padding: "5px 12px", borderRadius: 7, background: "var(--green)", border: "none", color: "#f6f3e9", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Send</motion.button>
      </div>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: "var(--ink3)" }}>Unresolved threads carry over to the next version — the agent reads them before regenerating.</p>
    </motion.div>
  );
}

function ProvenanceTab({ v, hist }: { v: VersionDetail; hist: HistoryResponse | null }) {
  const p = v.provenance;
  const k: CSSProperties = { color: "var(--ink3)" };
  const val: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5 };
  const rows: [string, React.ReactNode][] = [
    ["space", v.space],
    ["slug", v.slug],
    ["repo", p.source_repo ?? "—"],
    ["commit", p.commit_sha ? <span style={{ color: "var(--green)" }}>{shortSha(p.commit_sha)}</span> : "—"],
    ["branch", p.branch ?? "—"],
    ["tool", p.tool ?? "—"],
    ["author", `${p.author_type} · ${p.author_name ?? "—"}`],
    ["pushed", ago(p.pushed_at)],
    ["content", `blake3:${v.id.slice(0, 8)}…`],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "8px 12px", padding: "4px 2px 14px", fontSize: 12 }}>
        {rows.map(([kk, vv]) => (
          <div key={kk} style={{ display: "contents" }}>
            <span style={k}>{kk}</span>
            <span style={val}>{vv}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderRadius: 9, boxShadow: "var(--sh-inset)", background: "var(--paper)", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink3)" }}>State history</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>
          {v.state === "approved" ? "in_review → approved" : v.state === "rejected" ? "in_review → rejected" : "draft → in_review"}{" "}
          <span style={{ color: "var(--ink3)" }}>(push, {ago(p.pushed_at)})</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>approval requires 1 owner of {v.space}{hist?.is_owner ? " (you)" : ""}</span>
      </div>
    </div>
  );
}

function ContextTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink3)" }}>Session · prompt trail</span>
      <div style={{ padding: 12, borderRadius: 9, boxShadow: "var(--sh-inset)", background: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.6, color: "var(--ink2)" }}>“Document the auth flow for the team wiki.”</div>
      <div style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: "6px 12px", fontSize: 12 }}>
        <span style={{ color: "var(--ink3)" }}>model</span><span className="mono" style={{ fontSize: 11.5 }}>—</span>
        <span style={{ color: "var(--ink3)" }}>tokens</span><span className="mono" style={{ fontSize: 11.5 }}>—</span>
        <span style={{ color: "var(--ink3)" }}>transcript</span><span className="mono" style={{ fontSize: 11.5, color: "var(--ink3)" }}>not attached (opt-in)</span>
      </div>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: "var(--ink3)" }}>Session context is opt-in and passes through the org redaction hook before storage.</p>
    </div>
  );
}

const sheetStyle: CSSProperties = {
  borderRadius: 4, background: "var(--docbg)", boxShadow: "var(--sh-raise), 0 26px 42px -22px rgba(80,70,50,.38)",
  border: "1px solid var(--line)", overflow: "hidden", display: "flex", flexDirection: "column", transform: "rotate(-.25deg)",
};
const asideStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 14, padding: 16, borderRadius: 10,
  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
  backdropFilter: "blur(var(--blur))", WebkitBackdropFilter: "blur(var(--blur))", boxShadow: "var(--sh-raise-sm)",
};
const approveBtn: CSSProperties = {
  padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
  background: "var(--green)", color: "#f6f3e9", boxShadow: "var(--sh-raise-sm)", border: "none",
};
const rejectBtn: CSSProperties = {
  padding: "10px 18px", borderRadius: 10, background: "none", border: "1px solid var(--line-strong)",
  color: "var(--ink2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const resolveBtn: CSSProperties = {
  alignSelf: "flex-start", padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600,
  color: "var(--ink2)", background: "var(--raise)", border: "1px solid var(--line)", boxShadow: "var(--sh-raise-sm)",
};
const resolvedBtn: CSSProperties = {
  ...resolveBtn, color: "var(--green)", background: "rgba(58,125,68,.1)", border: "1px solid var(--green)", boxShadow: "none",
};

function RejectModal({
  open, reason, setReason, onCancel, onConfirm,
}: {
  open: boolean;
  reason: string;
  setReason: (s: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}
          style={{ position: "fixed", inset: 0, background: "rgba(43,40,32,.45)", display: "grid", placeItems: "center", zIndex: 170, backdropFilter: "blur(2px)" }}>
          <motion.div initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ ease: easeSoft }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 460, maxWidth: "90vw", background: "var(--paper-hi)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--sh-raise)", padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="hand" style={{ fontSize: 21, color: "var(--red)" }}>reject with a reason ↴</span>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>The agent reads this before regenerating. A reason is required.</span>
            </div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={4} placeholder="What's wrong / what to fix…"
              style={{ padding: "12px", borderRadius: 10, border: "1px solid var(--line)", boxShadow: "var(--sh-inset)", background: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none", resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <motion.button whileTap={{ y: 1 }} onClick={onCancel} style={{ padding: "9px 16px", borderRadius: 10, background: "none", border: "1px solid var(--line)", color: "var(--ink2)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</motion.button>
              <motion.button whileTap={{ y: 1 }} onClick={onConfirm} disabled={!reason.trim()} style={{ padding: "9px 18px", borderRadius: 10, background: reason.trim() ? "var(--red)" : "var(--ink3)", border: "none", color: "#f6f3e9", fontSize: 13, fontWeight: 700, cursor: reason.trim() ? "pointer" : "default" }}>Reject version</motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}