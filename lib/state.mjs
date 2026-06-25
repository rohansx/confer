// Persistence for Confer threads/highlights — a sidecar JSON next to the doc.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export async function loadState(statePath) {
  if (!existsSync(statePath)) return { version: 1, threads: [] };
  try {
    const raw = await readFile(statePath, 'utf8');
    const s = JSON.parse(raw);
    if (!Array.isArray(s.threads)) s.threads = [];
    return s;
  } catch {
    return { version: 1, threads: [] };
  }
}

// atomic write (tmp + rename) so a crash mid-write can't corrupt the file
export async function saveState(statePath, state) {
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, statePath);
}
