import { useEffect, useState } from "react";
import { fetchVersion, type VersionDetail } from "../lib/api";
import { StateBadge } from "../components/StateBadge";
import { ProvenancePanel } from "../components/ProvenancePanel";

/**
 * The review page: renders a version's doc inside a sandboxed iframe served
 * from the content origin, alongside its provenance. In dev the version id and
 * a read token come from the query string (?v=…&token=…); session auth replaces
 * the token param in the auth phase.
 */
export function ReviewPage() {
  const [v, setV] = useState<VersionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const id = q.get("v");
    const token = q.get("token");
    if (!id || !token) {
      setError("Provide ?v=<versionId>&token=<readToken>");
      return;
    }
    fetchVersion(id, token)
      .then(setV)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div className="notice error">{error}</div>;
  if (!v) return <div className="notice">Loading…</div>;

  return (
    <div className="review">
      <header className="review-header">
        <div>
          <h1>{v.title}</h1>
          <span className="muted">
            {v.space} / {v.slug} · v{v.number}
          </span>
        </div>
        <StateBadge state={v.state} />
      </header>
      <div className="review-body">
        <iframe
          className="doc-frame"
          title={v.title}
          sandbox="allow-scripts"
          src={v.content_url}
        />
        <ProvenancePanel v={v} />
      </div>
    </div>
  );
}
