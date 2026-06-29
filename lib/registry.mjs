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
    const state = await loadState(statePath);

    // The doc is either Markdown (rendered to HTML for viewing) or HTML. Track
    // both the Markdown source of truth and any HTML sibling so the agent edits
    // the right file when asked to change the doc.
    const isMarkdown = /\.(md|markdown)$/i.test(abs);
    let mdPath, htmlPath;
    if (isMarkdown) {
      mdPath = abs;
      const h = abs.replace(/\.(md|markdown)$/i, '.html');
      htmlPath = existsSync(h) ? h : null;
    } else {
      htmlPath = abs;
      const m = abs.replace(/\.html?$/i, '.md');
      mdPath = existsSync(m) ? m : null;
    }

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
      isMarkdown,
      mdPath,
      htmlPath,
      state,
    };
    docs.set(abs, ctx);
    return ctx;
  }

  return { get, opened: () => [...docs.keys()] };
}
