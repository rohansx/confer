// Fuzzy, recursive doc search across the file-finder boundary (`root`).
//
// The launcher's folder browser is one-directory-at-a-time; this powers the
// search box that finds .html/.htm/.md/.markdown docs anywhere under `root`.
// We walk once and cache the file list (a keystroke must not re-walk the disk),
// then fuzzy-match in memory. The walk skips dotdirs, well-known junk dirs, and
// symlinks (loops / boundary escapes), and is bounded by depth + file count so
// even `--root /` stays responsive. Everything stays within `root`, preserving
// the finder's safety model.
import { readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const DOC_RE = /\.(html?|md|markdown)$/i;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next',
  '.cache', '.venv', 'venv', '__pycache__', 'coverage', '.svn', '.hg',
  '.illuminate', '.fastembed_cache',
]);

const kindOf = (name) => (/\.(md|markdown)$/i.test(name) ? 'md' : 'html');

// Subsequence fuzzy score (fzf-style): all query chars must appear in order.
// Rewards consecutive matches and word-boundary starts. Returns -1 on no match.
export function fuzzyScore(query, str) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = str.toLowerCase();
  let qi = 0, score = 0, prev = -2, consec = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      let pts = 1;
      if (i === prev + 1) { consec += 1; pts += consec * 2; } else consec = 0;
      if (i === 0 || /[/\-_. ]/.test(t[i - 1])) pts += 3; // word-boundary bonus
      score += pts; prev = i; qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

export function createSearchIndex({ root, ttlMs = 20000, maxFiles = 8000, maxDepth = 12 } = {}) {
  let files = null;
  let builtAt = 0;
  let building = null;

  async function build() {
    const rootReal = await realpath(path.resolve(root)).catch(() => path.resolve(root));
    const out = [];
    async function walk(dir, depth) {
      if (depth > maxDepth || out.length >= maxFiles) return;
      let names;
      try { names = await readdir(dir); } catch { return; }
      for (const name of names) {
        if (out.length >= maxFiles) return;
        if (name.startsWith('.')) continue;
        const full = path.join(dir, name);
        let st;
        try { st = await lstat(full); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) await walk(full, depth + 1); }
        else if (st.isFile() && DOC_RE.test(name)) {
          out.push({ name, path: full, rel: path.relative(rootReal, full), kind: kindOf(name), mtime: st.mtimeMs });
        }
      }
    }
    await walk(rootReal, 0);
    files = out;
    builtAt = Date.now();
    return { files, truncated: out.length >= maxFiles };
  }

  async function ensure() {
    if (files && Date.now() - builtAt < ttlMs) return files;
    if (!building) building = build().then((r) => r.files).finally(() => { building = null; });
    return building;
  }

  const pick = (f) => ({ name: f.name, path: f.path, rel: f.rel, kind: f.kind });

  async function search(query, limit = 40) {
    const idx = await ensure();
    const q = (query || '').trim();
    if (!q) {
      return [...idx].sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(pick); // recent docs
    }
    const scored = [];
    for (const f of idx) {
      const sName = fuzzyScore(q, f.name);
      const sRel = fuzzyScore(q, f.rel);
      const s = Math.max(sName, sRel);
      if (s < 0) continue;
      scored.push({ f, s: s + (sName >= 0 ? 5 : 0) }); // filename hits rank above path hits
    }
    scored.sort((a, b) => b.s - a.s || a.f.rel.length - b.f.rel.length || b.f.mtime - a.f.mtime);
    return scored.slice(0, limit).map(({ f }) => pick(f));
  }

  return { search, refresh: build };
}
