// Multi-doc registry. Confer is now a long-lived server that can open any doc the
// user picks from the file finder, so it can't hold a single global doc state.
// Each doc gets a lazily-built, cached context: its sidecar state, the git-root
// workspace, the Claude Code add-dirs, and the session binding (auto-connected to
// the workspace's latest session on first open).
import { existsSync } from 'node:fs';
import path from 'node:path';

import { loadState, saveState } from './state.mjs';
import { resolveWorkspace } from './workspace.mjs';
import { latestSession } from './sessions.mjs';

export function createRegistry({ extraDirs = [], override = null } = {}) {
  const docs = new Map(); // absolute docPath -> context

  async function get(docPath) {
    const abs = path.resolve(docPath);
    if (docs.has(abs)) return docs.get(abs);

    const { workspace, addDirs } = resolveWorkspace(abs, { extraDirs, override });
    const statePath = `${abs}.confer.json`;
    const mdGuess = abs.replace(/\.html?$/i, '.md');
    const state = await loadState(statePath);

    // first open with no saved binding → auto-connect to the workspace's latest
    // Claude Code session, else fall back to an isolated session per highlight
    if (!state.binding) {
      const latest = await latestSession(workspace);
      state.binding = latest ? { mode: 'connected', sessionId: latest } : { mode: 'per-thread' };
      await saveState(statePath, state);
    }

    const ctx = {
      docPath: abs,
      dir: path.dirname(abs),
      docName: path.basename(abs),
      workspace,
      addDirs,
      statePath,
      mdPath: existsSync(mdGuess) ? mdGuess : null,
      state,
    };
    docs.set(abs, ctx);
    return ctx;
  }

  return { get, opened: () => [...docs.keys()] };
}
