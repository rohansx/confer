import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import { uploadVersion, listSpaces, type UploadResult, type SpaceRow } from "../lib/api";
import { fadeUp, stagger, staggerItem, easeSoft } from "../lib/motion";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "doc";
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.trim() : null;
}

export function Upload() {
  const [space, setSpace] = useState("");
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spacesErr, setSpacesErr] = useState(false);
  const [spacesLoaded, setSpacesLoaded] = useState(false);
  const [slug, setSlug] = useState("");
  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("dashboard");
  const [draft, setDraft] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Populate the Space picker from the spaces the user can actually push to.
  // Uploads can only target an existing space (the API 404s otherwise), so a
  // dropdown of real spaces removes the "space not found" foot-gun.
  useEffect(() => {
    listSpaces()
      .then((sp) => {
        setSpaces(sp);
        setSpace((cur) => cur || sp[0]?.slug || "");
      })
      .catch(() => setSpacesErr(true))
      .finally(() => setSpacesLoaded(true));
  }, []);

  const onFile = (file: File) => {
    setError(null);
    setResult(null);
    setFilename(file.name);
    file.text().then((text) => {
      setHtml(text);
      if (!slug) setSlug(slugify(file.name));
      const t = extractTitle(text);
      if (t && !title) setTitle(t);
      if (!t && !title) setTitle(file.name.replace(/\.html?$/i, ""));
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && /\.html?$/i.test(f.name)) onFile(f);
    else setError("Drop an .html file");
  };

  const push = async () => {
    if (!html) return setError("Pick an .html file first");
    if (!space || !slug) return setError("space and slug are required");
    setBusy(true);
    setError(null);
    try {
      const res = await uploadVersion(space, slug, {
        html,
        draft,
        metadata: { title, source_repo: repo || undefined, author, author_type: "human", tool: "confer-dashboard" },
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setHtml(null);
    setFilename("");
    setSlug("");
    setTitle("");
    setError(null);
  };

  return (
    <>
      <TopBar crumb="Upload" />
      <motion.div
        initial="hidden"
        animate="show"
        variants={stagger(0.06)}
        style={{ flex: 1, overflow: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}
      >
        <motion.div variants={staggerItem} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700 }}>Upload a doc</h1>
          <span className="hand" style={{ fontSize: 18, color: "var(--pencil)" }}>drop a single-file HTML — it becomes a new in-review version</span>
        </motion.div>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: easeSoft }}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 10, background: "rgba(58,125,68,.08)", border: "1.5px solid var(--green)" }}
            >
              <span className="hand" style={{ fontSize: 20, color: "var(--green)" }}>{result.deduped ? "already here ✓" : "pushed ✓"}</span>
              <span style={{ fontSize: 13, color: "var(--ink)", flex: 1 }}>
                <strong style={{ color: "var(--green)" }}>{space}/{slug}</strong> · state: in_review
              </span>
              <a href={`#/r/${result.version_id}`} style={{ fontWeight: 600 }}>Open review →</a>
              <button onClick={reset} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "var(--ink2)" }}>Upload another</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* dropzone */}
        <motion.div
          variants={staggerItem}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          whileHover={{ y: -2 }}
          style={{
            ...dropzone,
            border: dragOver ? "2px dashed var(--green)" : "2px dashed var(--line-strong)",
            background: dragOver ? "rgba(58,125,68,.06)" : "var(--card)",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".html,.htm,text/html"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {filename ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>{filename}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{html ? `${(html.length / 1024).toFixed(1)} kB` : "reading…"}</span>
              <span style={{ fontSize: 12, color: "var(--ink3)" }}>click to replace</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span className="hand" style={{ fontSize: 22, color: "var(--pencil)" }}>drop an .html here, or click to pick</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>single-file · inline assets · ≤ 5 MB</span>
            </div>
          )}
        </motion.div>

        {/* fields */}
        <motion.div variants={staggerItem} style={cardStyle}>
          <Row label="Space">
            <select value={space} onChange={(e) => setSpace(e.target.value)} style={inputStyle} disabled={spaces.length === 0}>
              {spaces.length === 0 && <option value="">{!spacesLoaded ? "loading spaces…" : spacesErr ? "— couldn't load spaces —" : "— no spaces yet —"}</option>}
              {spaces.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.slug}{s.name && s.name !== s.slug ? ` — ${s.name}` : ""}{s.orgId ? "" : " (personal)"}
                </option>
              ))}
            </select>
            {spacesErr && (
              <span style={{ marginTop: 5, fontSize: 12, color: "var(--red)" }}>
                Couldn't load your spaces — <a href="#/login">log in</a> first.
              </span>
            )}
          </Row>
          <Row label="Slug">
            <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} style={inputStyle} placeholder="auto from filename" />
          </Row>
          <Row label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="doc title" />
          </Row>
          <Row label="Source repo">
            <input value={repo} onChange={(e) => setRepo(e.target.value)} style={inputStyle} placeholder="e.g. utkrusht-task" />
          </Row>
          <Row label="Author">
            <input value={author} onChange={(e) => setAuthor(e.target.value)} style={inputStyle} placeholder="dashboard" />
          </Row>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink2)" }}>
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
            Save as draft (skip review queue)
          </label>
        </motion.div>

        {error && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}

        <motion.button
          variants={staggerItem}
          whileHover={{ y: -1 }}
          whileTap={{ y: 1 }}
          onClick={push}
          disabled={busy || !html}
          style={{
            padding: "13px 22px", borderRadius: 12, cursor: busy || !html ? "default" : "pointer",
            background: html ? "var(--green)" : "var(--ink3)", border: "none", color: "#f6f3e9",
            fontSize: 15, fontWeight: 700, boxShadow: "var(--sh-raise-sm)",
            opacity: html ? 1 : 0.7,
          }}
        >
          {busy ? "Pushing…" : "Push to review"}
        </motion.button>
      </motion.div>
    </>
  );
}

const dropzone: CSSProperties = {
  borderRadius: 14,
  padding: "36px 24px",
  cursor: "pointer",
  textAlign: "center",
  boxShadow: "var(--sh-raise-sm)",
  transition: "border-color .15s ease, background .15s ease",
};
const cardStyle: CSSProperties = {
  display: "grid",
  gap: "0.85rem",
  padding: 22,
  borderRadius: 12,
  background: "var(--card)",
  boxShadow: "var(--sh-raise-sm)",
  border: "1px solid var(--line)",
};
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 9,
  border: "1px solid var(--line)",
  boxShadow: "var(--sh-inset)",
  background: "var(--paper)",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  color: "var(--ink)",
  outline: "none",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
      {label}
      {children}
    </label>
  );
}