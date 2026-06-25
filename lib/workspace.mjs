// Resolve the agent's workspace (the dir it Reads/Greps and runs in) for a doc.
// The workspace is the git repo root containing the doc, so answers are grounded
// in the whole repository — falling back to the doc's own folder when there's no
// repo. Pure + synchronous so it's trivial to unit test.
import { existsSync } from 'node:fs';
import path from 'node:path';

// Walk up from `dir` to the nearest ancestor that contains a `.git` entry.
// Returns the git root, or null if the filesystem root is reached first.
export function findGitRoot(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null; // hit filesystem root
    cur = parent;
  }
}

// Resolve { workspace, addDirs } for a doc.
//   workspace = override, else the git root containing the doc, else the doc dir
//   addDirs   = workspace + the doc's own folder + any (existing) extra dirs
export function resolveWorkspace(docPath, { extraDirs = [], override = null } = {}) {
  const dir = path.dirname(path.resolve(docPath));
  const workspace = override ? path.resolve(override) : (findGitRoot(dir) || dir);
  const addDirs = new Set([workspace, dir]);
  for (const d of extraDirs) {
    const r = path.resolve(d);
    if (existsSync(r)) addDirs.add(r);
  }
  return { workspace, addDirs: [...addDirs] };
}
