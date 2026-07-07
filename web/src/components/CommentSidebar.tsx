import { useEffect, useState } from "react";
import {
  listComments, createComment, resolveComment, replyToComment,
  type CommentRow, type AnchorPayload,
} from "../lib/api";

interface Props {
  space: string;
  slug: string;
  /** The version the dashboard is currently showing (for default anchoring). */
  currentVersionId: string;
  /** Called by parent when user selects text in the iframe. */
  pendingAnchor: AnchorPayload | null;
  /** Called after a comment is posted. */
  onPosted?: () => void;
  canResolve: boolean;
}

export function CommentSidebar({ space, slug, currentVersionId, pendingAnchor, onPosted, canResolve }: Props) {
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const refresh = () => listComments(space, slug).then((r) => setRows(r.comments)).catch((e) => setErr(e.message));

  useEffect(() => { refresh(); }, [space, slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    try {
      await createComment(space, slug, {
        body: body.trim(),
        version_id: currentVersionId,
        anchor: pendingAnchor,
      });
      setBody("");
      await refresh();
      onPosted?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const onResolve = async (id: string) => {
    try { await resolveComment(id); await refresh(); }
    catch (e) { setErr((e as Error).message); }
  };

  const onReply = async (parentId: string) => {
    if (!replyBody.trim()) return;
    try { await replyToComment(parentId, replyBody.trim()); setReplyBody(""); setReplyTo(null); await refresh(); }
    catch (e) { setErr((e as Error).message); }
  };

  if (err) return <div className="comment-sidebar"><div className="notice error">{err}</div></div>;
  if (rows === null) return <div className="comment-sidebar"><div className="notice">Loading…</div></div>;

  // Group by thread (root + replies). Sort roots by created_at desc.
  const roots = rows.filter((r) => r.parent_id === null);
  const replies = rows.filter((r) => r.parent_id !== null);
  const byParent = new Map<string, CommentRow[]>();
  for (const r of replies) {
    const arr = byParent.get(r.parent_id!) ?? [];
    arr.push(r);
    byParent.set(r.parent_id!, arr);
  }
  roots.sort((a, b) => b.created_at - a.created_at);

  return (
    <div className="comment-sidebar">
      <h3 style={{ margin: "0 0 1rem 0" }}>Comments ({rows.length})</h3>
      {rows.length === 0 && <p className="muted small">No comments yet.</p>}

      {roots.map((c) => (
        <div key={c.id} className={`comment ${c.anchor_resolved.lost ? "lost" : ""} ${c.resolved_at ? "comment-resolved" : ""}`}>
          {c.anchor_quote && (
            <div className="comment-quote">
              {c.anchor_resolved.lost ? <span className="muted">(anchor lost) </span> : null}
              “{c.anchor_quote}”
            </div>
          )}
          {c.is_carried_over && <div className="muted small">↳ carried over from an earlier version</div>}
          <div>{c.body}</div>
          <div className="comment-meta">
            <span>{c.author_user_id.slice(0, 8)}</span>
            <span>{new Date(c.created_at).toLocaleString()}</span>
          </div>
          {c.resolved_at
            ? <span className="muted small">resolved</span>
            : (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button className="btn small" onClick={() => setReplyTo(c.id)}>Reply</button>
                {canResolve && <button className="btn small" onClick={() => onResolve(c.id)}>Resolve</button>}
              </div>
            )}

          {(byParent.get(c.id) ?? []).map((r) => (
            <div key={r.id} className="comment" style={{ marginTop: "0.5rem", background: "#f9fafb" }}>
              <div>{r.body}</div>
              <div className="comment-meta">
                <span>{r.author_user_id.slice(0, 8)}</span>
                <span>{new Date(r.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}

          {replyTo === c.id && (
            <div style={{ marginTop: "0.5rem" }}>
              <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Reply…" />
              <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                <button className="btn primary small" onClick={() => onReply(c.id)}>Post</button>
                <button className="btn small" onClick={() => { setReplyTo(null); setReplyBody(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <form onSubmit={submit} className="comment-form">
        <h4 style={{ margin: "0 0 0.5rem 0" }}>New comment</h4>
        {pendingAnchor && (
          <div className="comment-quote">“{pendingAnchor.quote}”</div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={pendingAnchor ? "Comment on the selected text…" : "Comment (optionally select text in the doc to anchor)"}
        />
        <button type="submit" className="btn primary" disabled={posting} style={{ marginTop: "0.5rem" }}>
          {posting ? "Posting…" : "Post"}
        </button>
      </form>
    </div>
  );
}
