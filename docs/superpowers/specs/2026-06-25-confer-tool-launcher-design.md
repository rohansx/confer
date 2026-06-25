# Confer as a runnable tool — design

**Date:** 2026-06-25
**Status:** Approved

## Problem

Confer today requires the doc path on the CLI (`confer serve <doc.html>`) and the
agent workspace defaults to wherever it was launched. We want to run Confer like
an app: launch it once, **find the doc inside the UI** via a file browser, and
have the agent **connect to that folder's Claude Code session** automatically.

## Decisions

| Question | Decision |
|----------|----------|
| File finder reach | Browser **starts at the launch folder**, can roam up/down anywhere **under `$HOME`** (the boundary). |
| Agent workspace | The **git repo root** containing the doc (walk up to nearest `.git`; fall back to the doc's folder). |
| Session binding | **Auto-connect to the latest** Claude Code session for that workspace, with the existing picker to switch. |
| Doc types | **HTML only** (`.html`/`.htm`). Markdown rendering stays out of scope. |
| Project specificity | **Drop the hardcoded Utkrushta repo names** from the prompt/add-dirs; make it a general tool. |

## Architecture (chosen: single long-lived server + multi-doc registry)

Rejected alternatives: (B) a launcher that spawns one `confer serve` child per doc
on a new port — port-hopping, multiple processes, awkward session connect; (C) an
Electron/native wrapper — kills the zero-dependency ethos, overkill for a local tool.

### Entry points
- `confer` (no doc) → **launcher mode**: `/` serves the home screen (file finder).
- `confer serve <doc>` / `confer <doc>` → **direct mode**, unchanged (`/` serves that doc).
- `--root <dir>` overrides the browse boundary (default `$HOME`). Browse start = launch cwd.
- `--add-dir <dir>` (repeatable) adds extra read dirs for the agent (replaces the
  hardcoded sibling-repo list).

### Components / files
- **`lib/browse.mjs`** (new) — safe directory listing. Given a path, returns
  `{path, parent, entries}` where entries are subdirectories + `.html`/`.htm` docs
  only. Rejects anything outside `root` (the `$HOME` boundary), resolves symlinks,
  no path traversal. The one security-critical module.
- **`lib/workspace.mjs`** (new) — `findGitRoot(dir)` walks up to the nearest `.git`;
  `resolveWorkspace(docPath)` returns `{ workspace, addDirs }` (git root or doc dir,
  plus the doc's own folder and any `--add-dir`s).
- **`lib/registry.mjs`** (new) — multi-doc context map. `getDocContext(docPath)`
  lazily builds/caches `{docPath, dir, docName, workspace, addDirs, statePath,
  mdPath, binding, state}` keyed by absolute path. On first build with no saved
  binding, sets `binding = {mode:'connected', sessionId: latest}` when a session
  exists, else `{mode:'per-thread'}`.
- **`lib/sessions.mjs`** (change) — add `latestSession(workspace)` (reuses `listSessions`).
- **`lib/prompt.mjs`** (change) — remove Utkrushta-specific lines; generic
  workspace-aware wording.
- **`confer.mjs`** (refactor) — launcher mode, multi-doc routing, browse + view
  routes, generic `--add-dir`. All `/__confer__/*` API routes select the doc via an
  `x-confer-doc` header (GET reload `/events` uses a `?doc=` query since EventSource
  can't set headers).
- **`public/home.html` + `home.css` + `home.js`** (new) — the launcher UI, reusing
  the overlay green theme.
- **`public/overlay.js`** (change) — read `docPath` from injected config, send it as
  `x-confer-doc` on every API call and as `?doc=` on the reload stream.

### Routes
- `GET /` → `home.html` (launcher) when no CLI doc, else `serveDoc(cliDoc)`.
- `GET /view?doc=<abs path>` → `serveDoc(path)`. Path must be `.html`/`.htm` under `root`.
- `GET /__confer__/browse?path=<dir>` → token-guarded JSON listing (dirs + docs,
  git-root + session-count badges), confined to `root`.
- Existing API (`/state`, `/ask`, `/thread…`, `/sessions`, `/connect`, `/events`)
  → unchanged behavior, but scoped to the doc named by `x-confer-doc` / `?doc=`.

### Home screen layout
```
┌─ Confer ────────────────────────────────────┐
│  ~/Desktop/utkrusht-ai/confer         [↻]    │  ← breadcrumb path bar
├──────────────────────────────────────────────┤
│  ⬆  ..                                        │
│  📁 docs                 ● git · 3 sessions   │
│  📁 public                                    │
│  📄 design.html                               │  ← click → /view?doc=…
│  📄 report.html                               │
└──────────────────────────────────────────────┘
```

## Error handling
- `browse` on a missing/denied dir or a path outside `root` → JSON `{error}`.
- `/view` on a non-HTML path or outside `root` → 404.
- No sessions for the workspace → graceful `per-thread` fallback (no error).
- `claude` spawn failure → existing SSE `error` event.

## Testing
`node --test` unit tests for the pure / security-critical logic:
- `browse`: rejects `../` escapes, paths outside `root`, and non-HTML files; lists
  dirs + docs correctly.
- `workspace.findGitRoot`: finds the nearest `.git`, falls back to the doc dir.
- `prompt.buildPrompt`: includes the passage/section on first turn, bare question after.

Add `"test": "node --test"` to `package.json`. HTTP/SSE + `claude` spawn paths are
covered by a manual smoke run (start server, hit `/browse`, open a doc, ask).

## Security
- Binds `127.0.0.1` only; every API call echoes the per-run `x-confer-token`.
- The file finder can only list directories and `.html`/`.htm` files, and only
  within `root` (`$HOME` by default) — no arbitrary file exfiltration.
- The agent still runs `--permission-mode acceptEdits` with `Read/Grep/Glob/Edit/Write`
  over the resolved workspace. Browsing to a repo and connecting to its session gives
  the agent edit reach there — intended, but noted in the README.

## Out of scope (future)
- Markdown rendering / regenerating HTML from edited Markdown.
- A persistent "recent docs" index.
- Multi-user / remote access.
