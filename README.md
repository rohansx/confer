# Confer

**Highlight any passage in a local HTML doc, ask about it, and get answers from a real Claude Code agent running in your repo.**

Run `confer`, pick a doc from the **in-browser file finder**, and Confer serves it with an injected annotation layer. Select text → click **Ask Claude** → a side-panel thread opens. Your question (plus the highlighted passage and the section it came from) is sent to a **headless Claude Code agent** (`claude -p`) running in that doc's repository — so it can `Grep`/`Read` the actual codebase and answer with concrete `file:line` references. It even **auto-connects to that repo's latest Claude Code session**, so the agent picks up the context you already built in your terminal. Ask it to edit the doc and it patches the source.

Zero dependencies — Node built-ins only. Uses your existing `claude` CLI (same auth, model, settings, MCP servers).

## Usage

```bash
# Launcher — pick a doc from the UI, no path needed:
confer

# …or open one doc directly:
confer serve path/to/doc.html
```

Then open the printed URL (`http://127.0.0.1:4317/`). In launcher mode you get a file finder rooted at where you launched it; browse to any `.html` doc and click it. Confer figures out the doc's git repo, connects the agent there, and binds to that repo's most recent Claude Code session (switchable any time from the panel's session picker).

Options:

| Flag | Default | Meaning |
|------|---------|---------|
| `--root <dir>` | your home dir | File-finder boundary — the finder can roam anywhere under this |
| `--workspace <dir>` | the doc's git root | Force the repo the agent runs in |
| `--add-dir <dir>` | — | Extra dir the agent may read (repeatable) |
| `--model <id>` | (your default) | Override the Claude model |
| `--session <mode>` | auto-latest | `per-thread` \| `shared` \| `<session-id>` for a doc opened on the CLI |
| `--port <n>` | `4317` | Port to serve on |
| `--host <addr>` | `127.0.0.1` | Bind address (localhost only by default) |

Install globally:

```bash
cd confer && npm link     # then: confer
```

## How it works

```
Browser                              confer.mjs (localhost)              Claude Code
  / (launcher)  ──GET /browse──▶  list dirs + .html docs (under --root)
  click a doc   ──GET /view────▶  serve doc + overlay; resolve git root;
                                  auto-bind latest session for that repo
  select text → "Ask Claude"  ──POST /ask──▶  spawn: claude -p \         (in that repo)
  side-panel thread (SSE)     ◀──stream────   --output-format stream-json \
  highlights persist                          --resume <session> \
                                              --allowedTools Read Grep Glob Edit Write \
                                              --add-dir <git root + doc dir>
```

- **In-UI file finder.** Launch with no doc and browse to one. The finder only ever lists directories and `.html`/`.htm` files, and only within `--root` (your home dir by default). Folders that are git repos show a **● git** badge with their Claude Code session count.
- **Workspace = the doc's git root.** Confer walks up from the doc to the nearest `.git` and runs the agent there, so answers are grounded in the whole repository (falls back to the doc's folder if there's no repo).
- **Auto-connect to the repo's session.** On first open, the doc binds to that repo's most recent Claude Code session. Change it — or pick *isolated per highlight* / *one shared session* — from the panel's session picker.
- **Per-highlight conversations.** Each highlight maps to one Claude Code session; follow-ups continue it via `--resume`.
- **Persistence.** Highlights + threads are saved next to each doc as `<doc>.confer.json` (atomic writes). Re-open the doc and everything is restored.
- **Doc editing.** `Edit`/`Write` are allowed and the agent is instructed to edit the Markdown source (and a sibling `.html`) when you ask — but not to touch repo source unless you explicitly request it. When the file changes on disk, open tabs get a **Reload** toast.

## Files

| File | Role |
|------|------|
| `confer.mjs` | CLI + HTTP server (launcher, multi-doc routing) + Claude bridge (SSE) |
| `lib/browse.mjs` | Safe directory listing for the file finder (the one security-critical module) |
| `lib/workspace.mjs` | Resolve a doc's git-root workspace + the agent's read dirs |
| `lib/registry.mjs` | Per-doc context: sidecar state, workspace, session binding |
| `lib/sessions.mjs` | List / find Claude Code sessions for a workspace |
| `lib/state.mjs` | Load/save the sidecar threads JSON |
| `lib/prompt.mjs` | System prompt + per-question prompt construction |
| `public/home.{html,css,js}` | The launcher / file-finder UI |
| `public/overlay.{js,css}` | Selection → pill → thread panel → streaming chat → highlight anchoring |

## Develop

```bash
npm test     # node --test — unit tests for browse safety, workspace, prompt
```

## Security

Binds to `127.0.0.1` only. The served page carries a random per-run token that every API call must echo (`x-confer-token`), so other local pages can't drive the agent. The file finder can only list directories and `.html`/`.htm` files, and only within `--root`, so it can't be used to read arbitrary files. The agent runs with `--permission-mode acceptEdits`, so it can apply file edits without prompting — and browsing to a repo connects the agent there with read access to the workspace and write access to do doc edits. Keep that in mind when choosing what to open.

## Limitations / ideas

- Highlights that span multiple block elements are listed as threads but not visually wrapped (the underlying range can't be cleanly surrounded). The text anchor still works.
- Re-rendering a bespoke HTML doc from edited Markdown isn't automatic — Confer reloads the HTML when it changes on disk, but you regenerate the HTML yourself if your pipeline needs it.
- No persistent "recent docs" list yet, and no multi-user / remote support by design (local dev tool).
