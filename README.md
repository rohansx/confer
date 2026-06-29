# Confer

**Highlight any passage in a local HTML or Markdown doc, ask about it, and get answers from a real Claude Code agent running in your repo.**

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
| `--share` | off | Go public over Tailscale Funnel on launch (or use the in-UI **Share** button) |
| `--share-port <n>` | `8443` | Funnel's public port — keeps `:443` free for other tunnels |
| `--share-ttl <min>` | `60` | Auto-expiry for a share, in minutes |
| `--allow-remote-edits` | off | Let remote visitors edit files (default: remote visitors are read-only) |

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

- **In-UI file finder.** Launch with no doc and browse to one. The finder lists directories and docs — **`.html`/`.htm` and `.md`/`.markdown`** — within `--root` (your home dir by default). Folders that are git repos show a **● git** badge with their Claude Code session count.
- **Fuzzy search + quick access.** A search box finds docs by name **anywhere under `--root`** (fzf-style fuzzy match across folders), so you don't have to click through the tree. The launcher also shows **★ Starred** and **🕘 Recent** lists; star any doc from a row, and docs you open are remembered.
- **Markdown docs, rendered.** Open a `.md`/`.markdown` file and Confer renders it to a clean reading view (headings get ids, so highlight-anchoring still targets sections) — highlight-and-ask works exactly as on HTML. Edits go to the Markdown source of truth.
- **Workspace = the doc's git root.** Confer walks up from the doc to the nearest `.git` and runs the agent there, so answers are grounded in the whole repository (falls back to the doc's folder if there's no repo).
- **Auto-connect to the repo's session.** On first open, the doc binds to that repo's most recent Claude Code session. Change it — or pick *isolated per highlight* / *one shared session* — from the panel's session picker.
- **Per-highlight conversations.** Each highlight maps to one Claude Code session; follow-ups continue it via `--resume`.
- **Persistence.** Highlights + threads are saved next to each doc as `<doc>.confer.json` (atomic writes). Re-open the doc and everything is restored.
- **Doc editing.** `Edit`/`Write` are allowed and the agent is instructed to edit the Markdown source (and a sibling `.html`) when you ask — but not to touch repo source unless you explicitly request it. When the file changes on disk, open tabs get a **Reload** toast.

## Files

| File | Role |
|------|------|
| `confer.mjs` | CLI + HTTP server (launcher, multi-doc routing) + Claude bridge (SSE) |
| `lib/share.mjs` | Tailscale Funnel control + the public-share session lifecycle (start/stop/expiry) |
| `lib/viewers.mjs` | Viewer registry — who joined, who's watching, device, local-vs-remote |
| `lib/search.mjs` | Recursive fuzzy doc search (html + md) within `--root` |
| `lib/markdown.mjs` | Dependency-free Markdown → HTML for the `.md` reading view |
| `lib/library.mjs` | Recently-viewed + starred docs (the launcher's quick-access lists) |
| `lib/browse.mjs` | Safe directory listing for the file finder (the one security-critical module) |
| `lib/workspace.mjs` | Resolve a doc's git-root workspace + the agent's read dirs |
| `lib/registry.mjs` | Per-doc context: sidecar state, workspace, session binding |
| `lib/sessions.mjs` | List / find Claude Code sessions for a workspace |
| `lib/state.mjs` | Load/save the sidecar threads JSON |
| `lib/prompt.mjs` | System prompt + per-question prompt construction |
| `public/home.{html,css,js}` | The launcher / file-finder UI |
| `public/overlay.{js,css}` | Selection → pill → thread panel → streaming chat → highlight anchoring |
| `public/share.{js,css}` | The **Share** widget — go live, QR + link, live viewer roster, kill switch |

## Develop

```bash
npm test     # node --test — unit tests for browse safety, workspace, prompt
```

## Security

Binds to `127.0.0.1` only. The served page carries a random per-run token that every API call must echo (`x-confer-token`), so other local pages can't drive the agent. The file finder can only list directories and `.html`/`.htm` files, and only within `--root`, so it can't be used to read arbitrary files. The agent runs with `--permission-mode acceptEdits`, so it can apply file edits without prompting — and browsing to a repo connects the agent there with read access to the workspace and write access to do doc edits. Keep that in mind when choosing what to open.

When you **share publicly** (below), the model changes — read [Public sharing](#public-sharing-tailscale-funnel) for what a link-holder can and can't do.

## Remote access (Tailscale)

Confer shells out to your local `claude` CLI (your auth, your sessions) and reads/writes your local git repos, so don't deploy it to Vercel or any stateless host. To reach it from other devices, put them on a private [Tailscale](https://tailscale.com) tailnet — only devices you've authenticated can connect.

```bash
# Install + start (Arch/CachyOS shown; use your distro's package + tailscale.com/download otherwise)
sudo pacman -S --needed tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up --operator=$USER        # prints a login URL; sign in (free)
```

**Tailnet-only (private)** — keep Confer on localhost and proxy it over HTTPS to *your* devices:

```bash
confer
tailscale serve --bg 4317                  # → https://<machine>.<tailnet>.ts.net/  (tailnet devices only)
```

First run may ask you to enable HTTPS in the tailnet admin console (DNS tab → Enable HTTPS) — one toggle.

## Public sharing (Tailscale Funnel)

Want it on your **phone over cellular**, or to hand a link to someone **not** on your tailnet? Click **Share** in the Confer UI (or launch with `--share`). Confer brings up a [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) on a second public port (`:8443` by default, so it never collides with anything on `:443`) and shows you the public HTTPS link plus a QR code. The same link every time; works from any device, no Tailscale needed on their end.

One-time account step: Tailscale requires you to enable Funnel for your tailnet once (a public-exposure opt-in). The CLI prints an enable link the first time; click it, then Confer's Share button works.

This is an **open link** — anyone who has it can open it. Confer makes that safe to live with by giving you control and visibility instead of a password:

- **Read-only by default.** Remote visitors get a `Read`/`Grep`/`Glob` agent — it answers questions but **cannot edit your files**. Flip **Allow edits** in the Share panel (owner-only) if you want them to be able to patch docs. (You always keep full edit power locally.)
- **Auto-expires.** Every share self-destructs after 60 min (`--share-ttl`); **Extend +30m** in the panel, or stop it instantly with **Stop sharing**.
- **Hard kill switch.** Stop is server-side, so it ends the funnel even after you've closed the browser. Confer also tears the funnel down on exit, so you never leave a dangling public link.
- **Live observability.** The Share panel shows how many devices **joined**, who's **watching now**, each visitor's device/browser, whether they're you or remote, and a best-effort self-reported IP. You get a toast (and a chime) when a new visitor joins. Every share is logged to `~/.confer/share-<timestamp>.log`.

> ⚠️ The link **is** the access control. The agent can read your repo (and, if you allow edits, write to it), and the file finder can browse docs under `--root`. Launch with a specific doc (`confer serve path/to/doc.html`) to keep a shared session scoped to that doc, share links only with people you trust, and **Stop sharing** when you're done.

A note on IPs: Tailscale Funnel hides the visitor's real public IP from the server by design, so the per-visitor IP shown in the roster is **self-reported by their browser** (handy, but spoofable). The device/browser, join count, and live presence are observed server-side and reliable.

## Limitations / ideas

- Highlights that span multiple block elements are listed as threads but not visually wrapped (the underlying range can't be cleanly surrounded). The text anchor still works.
- Re-rendering a bespoke HTML doc from edited Markdown isn't automatic — Confer reloads the HTML when it changes on disk, but you regenerate the HTML yourself if your pipeline needs it.
- No persistent "recent docs" list yet.
- Public sharing is an *unlisted-link* model (no per-link password); access control is the link plus the read-only default, auto-expiry, and kill switch. A token/password gate could be layered on later.
