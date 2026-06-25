# Confer

**Highlight any text in a local HTML doc, ask about it, and get answers from a real Claude Code agent running in your repo.**

Confer serves an HTML document with an injected annotation layer. Select text → click **Ask Claude** → a side-panel thread opens. Your question (plus the highlighted passage and the section it came from) is sent to a **headless Claude Code agent** (`claude -p`) running in your workspace — so it can `Grep`/`Read` the actual codebase and answer with concrete `file:line` references. Ask it to edit the doc and it patches the source.

Zero dependencies — Node built-ins only. Uses your existing `claude` CLI (same auth, model, settings, MCP servers).

## Usage

```bash
# from your repo root (so the agent can see the code):
node confer/confer.mjs serve docs/explanation-video/2026-06-25-task-explanation-video-design.html

# then open the printed URL (http://127.0.0.1:4317/)
```

Options:

| Flag | Default | Meaning |
|------|---------|---------|
| `--port <n>` | `4317` | Port to serve on |
| `--workspace <dir>` | `cwd` | Repo root the agent runs in (it auto-adds the three Utkrushta repos if present) |
| `--model <id>` | (your default) | Override the Claude model |
| `--host <addr>` | `127.0.0.1` | Bind address (localhost only by default) |

Install globally (optional):

```bash
cd confer && npm link     # then: confer serve <doc.html>
```

## How it works

```
Browser (doc + overlay.js)            confer.mjs (localhost)              Claude Code
  select text → "Ask Claude"  ──POST /ask──▶  spawn: claude -p \            (in your repo)
  side-panel thread (SSE)     ◀──stream────   --output-format stream-json \
  highlights persist                          --include-partial-messages \
                                              --resume <thread session> \
                                              --allowedTools Read Grep Glob Edit Write \
                                              --add-dir <repos>
```

- **Per-highlight conversations.** Each highlight maps to one Claude Code **session id**; follow-ups continue it via `--resume`.
- **Persistence.** Highlights + threads are saved next to the doc as `<doc>.confer.json` (atomic writes). Re-open the doc and everything is restored.
- **Repo-aware.** The agent runs with `Read`/`Grep`/`Glob` over your workspace, so answers are grounded in the code, not just the doc text.
- **Doc editing.** `Edit`/`Write` are allowed and the agent is instructed to edit the Markdown source (and sibling `.html`) when you ask — but not to touch repo source unless you explicitly request it. When the file changes on disk, open tabs get a **Reload** toast.

## Files

| File | Role |
|------|------|
| `confer.mjs` | CLI + HTTP server + Claude bridge (SSE) |
| `lib/state.mjs` | Load/save the sidecar threads JSON |
| `lib/prompt.mjs` | System prompt + per-question prompt construction |
| `public/overlay.css` | Annotation-layer styles (matches the Utkrusht green theme) |
| `public/overlay.js` | Selection → pill → thread panel → streaming chat → highlight anchoring |

## Security

Binds to `127.0.0.1` only. The served page carries a random per-run token that every API call must echo (`x-confer-token`), so other local pages can't drive the agent. The agent runs with `--permission-mode acceptEdits`, so it can apply file edits without prompting — keep that in mind, since it has read access to your workspace and write access to do doc edits.

## Limitations / ideas

- Highlights that span multiple block elements are listed as threads but not visually wrapped (the underlying range can't be cleanly surrounded). The text anchor still works.
- Re-rendering a bespoke HTML doc from edited Markdown isn't automatic — Confer reloads the HTML when it changes on disk, but you regenerate the HTML yourself if your pipeline needs it.
- No multi-user / remote support by design (local dev tool).
