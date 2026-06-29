// Recently-viewed + starred docs for the launcher's quick-access lists.
//
// A tiny JSON kept at ~/.confer/library.json. Recents are appended whenever a
// doc is opened locally (dedup by path, most-recent first, capped). Stars are an
// explicit toggle. Paths are absolute; callers validate them against the finder
// boundary (resolveDoc) before serving, so a stale entry can't escape ROOT.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const kindOf = (p) => (/\.(md|markdown)$/i.test(p) ? 'md' : 'html');

export function createLibrary({
  file = path.join(os.homedir(), '.confer', 'library.json'),
  maxRecents = 24,
  now = () => Date.now(),
} = {}) {
  let data = { recents: [], starred: [] };
  let loaded = false;

  async function ensure() {
    if (loaded) return;
    try {
      const d = JSON.parse(await readFile(file, 'utf8'));
      data = { recents: Array.isArray(d.recents) ? d.recents : [], starred: Array.isArray(d.starred) ? d.starred : [] };
    } catch { /* no file yet → empty */ }
    loaded = true;
  }

  async function persist() {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, file); // atomic
  }

  const entry = (p) => ({ path: p, name: path.basename(p), kind: kindOf(p), ts: now() });

  async function addRecent(p) {
    await ensure();
    data.recents = [entry(p), ...data.recents.filter((r) => r.path !== p)].slice(0, maxRecents);
    await persist();
  }

  // on === undefined → flip; else force on/off. Returns the resulting state.
  async function toggleStar(p, on) {
    await ensure();
    const has = data.starred.some((s) => s.path === p);
    const want = on == null ? !has : !!on;
    data.starred = data.starred.filter((s) => s.path !== p);
    if (want) data.starred.unshift(entry(p));
    await persist();
    return want;
  }

  async function starredSet() {
    await ensure();
    return new Set(data.starred.map((s) => s.path));
  }

  // Snapshot for the UI. filterExist drops entries whose file is gone, and flags
  // each recent with whether it's starred.
  async function view(filterExist = true) {
    await ensure();
    const live = (arr) => (filterExist ? arr.filter((e) => existsSync(e.path)) : arr.slice());
    const starred = new Set(data.starred.map((s) => s.path));
    return {
      recents: live(data.recents).map((r) => ({ ...r, starred: starred.has(r.path) })),
      starred: live(data.starred).map((s) => ({ ...s, starred: true })),
    };
  }

  return { addRecent, toggleStar, starredSet, view };
}
