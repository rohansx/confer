#!/usr/bin/env node
// Confer — highlight-and-ask layer for local HTML docs, answered by a headless
// Claude Code agent running in your repo. Run it like a tool: launch with no doc
// and pick one from the in-browser file finder; Confer connects the agent to that
// folder's git repo and its latest Claude Code session.
//
//   confer                     # launcher: pick a doc from the UI file finder
//   confer serve <doc.html>    # open one doc directly
//   confer <doc.html>          # alias for `serve`
//   confer --share             # also publish publicly over Tailscale Funnel
//
// Click "Share" in the UI (or pass --share) to bring up a Tailscale Funnel and
// hand out a public link — read-only by default, auto-expiring, with a live
// viewer roster and a one-click kill switch. See lib/share.mjs + lib/viewers.mjs.
//
// Zero dependencies — Node built-ins only.

import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync, watch, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveState } from './lib/state.mjs';
import { buildPrompt, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { listSessions, sessionCounts, sessionExists, findSessionHome } from './lib/sessions.mjs';
import { browse, resolveDoc } from './lib/browse.mjs';
import { createRegistry } from './lib/registry.mjs';
import { createShare, DEFAULT_SHARE_PORT } from './lib/share.mjs';
import { createViewers } from './lib/viewers.mjs';
import { createSearchIndex } from './lib/search.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { createLibrary } from './lib/library.mjs';
import {
  buildSnapshot, listSnapshots, readSnapshot, deleteSnapshot,
  resolveSnapshotPath, buildSnapshotPrompt,
} from './lib/snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const TOKEN = randomUUID(); // simple CSRF guard: only the served page knows it

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = [...argv];
  if (a[0] === 'serve') a.shift();
  const opts = {
    port: 4317, host: '127.0.0.1', root: null, workspace: null,
    model: null, doc: null, session: null, snapshotPath: null, addDirs: [],
    share: false, sharePort: DEFAULT_SHARE_PORT, shareTtlMin: 60, allowRemoteEdits: false,
  };
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v === '--port') opts.port = Number(a[++i]);
    else if (v === '--host') opts.host = a[++i];
    else if (v === '--root') opts.root = path.resolve(a[++i]);
    else if (v === '--workspace' || v === '-w') opts.workspace = path.resolve(a[++i]);
    else if (v === '--add-dir') opts.addDirs.push(path.resolve(a[++i]));
    else if (v === '--model' || v === '-m') opts.model = a[++i];
    else if (v === '--session' || v === '-s') opts.session = a[++i];
    else if (v === '--current-session') opts.currentSession = a[++i];
    else if (v === '--install-snapshot') opts.snapshotPath = path.resolve(a[++i]);
    else if (v === '--share') opts.share = true;
    else if (v === '--share-port') opts.sharePort = Number(a[++i]);
    else if (v === '--share-ttl') opts.shareTtlMin = Number(a[++i]);
    else if (v === '--allow-remote-edits') opts.allowRemoteEdits = true;
    else if (v === '--help' || v === '-h') opts.help = true;
    else if (!v.startsWith('-')) opts.doc = path.resolve(v);
  }
  return opts;
}

const HELP = `Confer — highlight & ask any local HTML doc, answered by Claude Code in your repo.

Usage:
  confer                     Launcher: pick a doc from the UI file finder
  confer serve <doc.html>    Open one doc directly
  confer <doc.html>          Alias for serve
  confer --install-snapshot <snapshot.json>
                             Open a synthetic doc view seeded with a session snapshot —
                             lets anyone chat on top of an existing Claude Code session
                             using their own Claude Code subscription


Options:
  --root <dir>       File-finder boundary (default: your home dir)
  --workspace <dir>  Force the agent's workspace (default: the doc's git root)
  --add-dir <dir>    Extra dir the agent may read (repeatable)
  --model <id>       Override the Claude model
  --session <mode>   Default binding: per-thread | shared | <session-id>
                     (otherwise auto-connects to the workspace's latest session)
  --port <n>         Port (default 4317)
  --host <addr>      Bind address (default 127.0.0.1)

Public sharing (Tailscale Funnel — anyone with the link, any device):
  --share              Go public on launch (or use the in-UI "Share" button)
  --share-port <n>     Funnel's public port (default 8443; keeps :443 free)
  --share-ttl <min>    Auto-expiry of a share, in minutes (default 60)
  --allow-remote-edits Let remote visitors edit files (default: read-only)
  -h, --help           Show this help

Highlights + threads are saved next to each doc as <doc>.confer.json.
`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP); process.exit(0); }
if (opts.doc && !existsSync(opts.doc)) { console.error(`Confer: doc not found: ${opts.doc}`); process.exit(1); }

// the file-finder boundary; the finder starts at cwd but can roam within ROOT
const ROOT = opts.root || os.homedir();
const START = withinRoot(process.cwd()) ? process.cwd() : ROOT;

// the session this Confer was launched from (so the picker can flag it)
const CURRENT_SESSION = opts.currentSession || process.env.CLAUDE_CODE_SESSION_ID || null;

// per-doc state, workspace + session binding live here
const registry = createRegistry({ extraDirs: opts.addDirs, override: opts.workspace });
// recursive fuzzy search over docs (html + md) within the finder boundary
const searchIndex = createSearchIndex({ root: ROOT });
// recently-viewed + starred docs for the launcher's quick-access lists
const library = createLibrary();

// a doc passed on the CLI is pre-opened and served at `/`
let cliDoc = null;
if (opts.snapshotPath) {
  // snapshot mode — serve a synthetic "doc" that's really a chat UI seeded
  // with the snapshot's transcript. No file, no fs writes — the snapshot is
  // read-only context. Workspace is the snapshot's captured cwd if it still
  // exists on disk; falls back to wherever Confer was launched.
  cliDoc = await loadSnapshotContext(opts.snapshotPath, { override: opts.workspace, extraDirs: opts.addDirs });
} else if (opts.doc) {
  cliDoc = await registry.get(opts.doc);
}

// apply a CLI --session default to the launched doc's binding (back-compat)
if (cliDoc && opts.session) {
  if (opts.session === 'shared') cliDoc.state.binding = { mode: 'shared', sessionId: null };
  else if (opts.session !== 'per-thread') cliDoc.state.binding = { mode: 'connected', sessionId: opts.session };
  else cliDoc.state.binding = { mode: 'per-thread' };
  await saveState(cliDoc.statePath, cliDoc.state);
}

function withinRoot(p) {
  const rel = path.relative(ROOT, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ── helpers ──────────────────────────────────────────────────────────────────
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});
const authed = (req) => req.headers['x-confer-token'] === TOKEN;

// ── public sharing (Tailscale Funnel) + viewer observability ──────────────────
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const AUDIT_DIR = path.join(os.homedir(), '.confer');
const AUDIT_FILE = path.join(AUDIT_DIR, `share-${runStamp}.log`);
async function audit(line) {
  try { await mkdir(AUDIT_DIR, { recursive: true }); await appendFile(AUDIT_FILE, `${new Date().toISOString()} ${line}\n`); } catch {}
}

const viewers = createViewers();
const presenceClients = new Set(); // { res, vid, local }
const share = createShare({
  localPort: opts.port,
  sharePort: opts.sharePort,
  ttlMs: Math.max(1, opts.shareTtlMin) * 60 * 1000,
  audit: (l) => audit(l),
  onChange: () => broadcast(),
});

// request → who/where. Funnel/serve always set x-forwarded-for; a direct
// localhost hit (you, on this machine) has none — that's our local/remote signal.
const isLocalReq = (req) => !req.headers['x-forwarded-for'];
function clientHints(req) {
  const xff = req.headers['x-forwarded-for'];
  return { ua: req.headers['user-agent'] || '', origin: xff ? 'remote' : 'local', ip: xff ? String(xff).split(',')[0].trim() : null };
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const viewerVid = (req) => parseCookies(req).confer_vid || null;
// stable per-browser id; returns [vid, setCookieHeaderOrNull]
function ensureVid(req) {
  const existing = viewerVid(req);
  if (existing) return [existing, null];
  const vid = randomUUID();
  return [vid, `confer_vid=${vid}; Path=/; Max-Age=31536000; SameSite=Lax`];
}

// roster (with IPs) goes only to local/owner subscribers; remote viewers get counts.
const snapshotFor = (local) => ({ share: share.state(), counts: viewers.counts(), roster: local ? viewers.roster() : [] });
function sendSnapshot(client) {
  try { client.res.write(`event: snapshot\ndata: ${JSON.stringify(snapshotFor(client.local))}\n\n`); } catch {}
}
function broadcast() { for (const c of presenceClients) sendSnapshot(c); }
// heartbeat: keep SSE alive through proxies, refresh countdown/roster/last-seen
setInterval(() => { if (presenceClients.size) broadcast(); }, 10000).unref?.();

function printShare(st) {
  if (st && st.active) {
    console.log(`\n  ⚡ SHARING LIVE ▸ ${st.url}`);
    console.log(`     ${st.allowEdits ? 'read & write' : 'read-only'} · auto-expires in ${Math.round(st.remainingMs / 60000)} min · stop from the UI\n`);
  } else { console.log(`\n  ⏹ sharing stopped\n`); }
  return st;
}

// Resolve which doc an API/event call is about (from the x-confer-doc header or
// a ?doc= query), confined to ROOT. Falls back to the CLI doc when unspecified.
async function ctxFromReq(req, url) {
  const requested = req.headers['x-confer-doc'] || url.searchParams.get('doc');
  if (!requested) return cliDoc;
  // snapshot mode — the URL's "doc" is a virtual path that doesn't live on
  // disk; the CLI-loaded `cliDoc` IS that path. If they match, route there.
  if (cliDoc && requested === cliDoc.docPath) return cliDoc;
  try { return await registry.get(await resolveDoc(ROOT, requested)); }
  catch { return null; }
}

const thread = (ctx, id) => ctx.state.threads.find((t) => t.id === id);

// Decide which Claude Code session a question runs against, per the doc's binding.
function resolveSession(ctx, t) {
  const b = ctx.state.binding || { mode: 'per-thread' };
  if (b.mode === 'connected' && b.sessionId) return { sessionId: b.sessionId, isNew: false, sink: b };
  if (b.mode === 'shared') {
    if (!b.sessionId) { b.sessionId = randomUUID(); return { sessionId: b.sessionId, isNew: true, sink: b }; }
    return { sessionId: b.sessionId, isNew: false, sink: b };
  }
  if (!t.sessionId) { t.sessionId = randomUUID(); return { sessionId: t.sessionId, isNew: true, sink: t }; }
  return { sessionId: t.sessionId, isNew: false, sink: t };
}

function serveStatic(res, file, type) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

// Wrap rendered Markdown in a minimal, readable HTML page. Content lives in
// <main>, which the overlay scopes its highlight anchoring to.
const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MD_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fbfcfd; }
  main.confer-md { max-width: 760px; margin: 0 auto; padding: 56px 28px 120px;
    font: 16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933; }
  main.confer-md h1, main.confer-md h2, main.confer-md h3 { line-height: 1.25; margin: 1.8em 0 .6em; font-weight: 700; }
  main.confer-md h1 { font-size: 2em; margin-top: .2em; }
  main.confer-md h2 { font-size: 1.5em; border-bottom: 1px solid #eceff2; padding-bottom: .25em; }
  main.confer-md h3 { font-size: 1.2em; }
  main.confer-md p { margin: 0 0 1em; }
  main.confer-md a { color: #1763d6; }
  main.confer-md code { font: .88em ui-monospace, SFMono-Regular, Menlo, monospace; background: #eef1f4; padding: .15em .4em; border-radius: 5px; }
  main.confer-md pre { background: #0f1722; color: #e6edf3; padding: 14px 16px; border-radius: 10px; overflow: auto; }
  main.confer-md pre code { background: none; padding: 0; color: inherit; }
  main.confer-md blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #cdd6df; color: #52606d; }
  main.confer-md ul, main.confer-md ol { padding-left: 1.5em; margin: 0 0 1em; }
  main.confer-md li { margin: .25em 0; }
  main.confer-md hr { border: 0; border-top: 1px solid #e6eaee; margin: 2em 0; }
  main.confer-md img { max-width: 100%; }
  main.confer-md table { border-collapse: collapse; margin: 1em 0; }
  main.confer-md td, main.confer-md th { border: 1px solid #dde3e9; padding: 6px 10px; }`;
function mdScaffold(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${MD_CSS}</style>
</head><body><main class="confer-md">${bodyHtml}</main></body></html>`;
}

async function serveDoc(req, res, ctx) {
  // Snapshot-mode "doc" — synthesize an HTML reading view that's really just
  // the snapshot metadata + transcript rendered as a single page. The text
  // content is the prior conversation; the right rail is where new questions
  // land (existing overlay.js, unchanged) using the viewer's own Claude.
  let html;
  if (ctx.state.snapshot) {
    html = snapshotScaffold(ctx.state.snapshot);
  } else {
    html = ctx.isMarkdown
      ? mdScaffold(ctx.docName, renderMarkdown(await readFile(ctx.docPath, 'utf8')))
      : await readFile(ctx.docPath, 'utf8');
  }
  const [vid, setCookie] = ensureVid(req);
  viewers.touch(vid, clientHints(req));
  if (!ctx.state.snapshot && isLocalReq(req)) library.addRecent(ctx.docPath).catch(() => {}); // your quick-access list, not visitors'
  const cfg = { token: TOKEN, doc: ctx.docName, docPath: ctx.docPath, snapshot: !!ctx.state.snapshot };
  const shareCfg = { token: TOKEN, sharePort: opts.sharePort, isLocal: isLocalReq(req), allowSnapshotShare: false };
  const inject = `
<link rel="stylesheet" href="/__confer__/overlay.css">
<link rel="stylesheet" href="/__confer__/share.css">
<script>window.__CONFER__=${JSON.stringify(cfg)};window.__CONFER_SHARE__=${JSON.stringify(shareCfg)};</script>
<script src="/__confer__/overlay.js" defer></script>
<script src="/__confer__/share.js" defer></script>`;
  if (html.includes('</body>')) html = html.replace('</body>', `${inject}\n</body>`);
  else html += inject;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(200, headers);
  res.end(html);
}

// Minimal read-only viewer for a snapshot — a header with the doc name +
// workspace, then the transcript rendered as a flowing conversation, with
// anchor back-links for the highlighted questions when available. The right
// side stays Confer's overlay panel for asking new questions.
function snapshotScaffold(snap) {
  const turns = (snap.transcript || []).map((m) => {
    const cls = m.role === 'user' ? 'cf-snippet-q' : 'cf-snippet-a';
    return `<div class="${cls}"><b>${m.role === 'user' ? 'Q' : 'A'}</b><div>${escHtml(m.text)}</div></div>`;
  }).join('');
  const prompts = (snap.prompts || []).map((p) => {
    const q = p.messages?.[0]?.text || '(no question)';
    const quote = p.anchor?.quote ? ` <i>“${escHtml(p.anchor.quote.slice(0, 80))}${p.anchor.quote.length > 80 ? '…' : ''}”</i>` : '';
    return `<li><b>${escHtml(q)}</b>${quote}</li>`;
  }).join('');
  const meta = `
    <header style="margin-bottom:24px">
      <div style="font-size:13px;color:#52606d;text-transform:uppercase;letter-spacing:.06em">Session snapshot</div>
      <h1 style="margin:.2em 0 .1em;font-size:1.6em">${escHtml(snap.doc?.name || 'Untitled')}</h1>
      <div style="color:#52606d;font-size:14px">workspace: <code>${escHtml(snap.workspace || '(unspecified)')}</code> · ${(snap.transcript || []).length} turns · captured ${escHtml((snap.createdAt || '').slice(0, 10))}</div>
    </header>`;
  const promptsBlock = prompts ? `
    <section style="margin-top:36px">
      <h2 style="font-size:1.05em;color:#27323d;text-transform:uppercase;letter-spacing:.06em">Questions highlighted on the doc</h2>
      <ul style="line-height:1.7;color:#27323d;padding-left:1.2em">${prompts}</ul>
    </section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(snap.doc?.name || 'Snapshot')} · snapshot</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fbfcfd; font: 15px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2933; }
  main.confer-snap { max-width: 760px; margin: 0 auto; padding: 48px 28px 120px; }
  .cf-snippet-q, .cf-snippet-a { padding: 12px 16px; border-radius: 10px; margin: 10px 0; }
  .cf-snippet-q { background: #eef4ff; border-left: 3px solid #4f7ed8; }
  .cf-snippet-a { background: #f5f7fa; border-left: 3px solid #c5cdd6; }
  .cf-snippet-q b, .cf-snippet-a b { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #5b6b7d; display: block; margin-bottom: 4px; }
  .cf-banner { background: #fff7e0; border: 1px solid #f7d774; padding: 10px 14px; border-radius: 8px; margin-bottom: 24px; font-size: 13.5px; color: #6e5614; }
</style>
</head><body>
<main class="confer-snap">
  <div class="cf-banner"><b>You're viewing a session snapshot.</b> Use the right panel to ask new questions — answers come from your local Claude Code, billed to your subscription. The transcript below is the prior conversation the snapshot captured.</div>
  ${meta}
  <section>${turns || '<i>(this snapshot has no transcript turns yet)</i>'}</section>
  ${promptsBlock}
</main>
</body></html>`;
}

async function serveHome(req, res) {
  let html = await readFile(path.join(PUBLIC, 'home.html'), 'utf8');
  const [vid, setCookie] = ensureVid(req);
  viewers.touch(vid, clientHints(req));
  const cfg = { token: TOKEN, root: ROOT, start: START };
  const shareCfg = { token: TOKEN, sharePort: opts.sharePort, isLocal: isLocalReq(req) };
  html = html.replace('/*__CONFER_HOME__*/', `window.__CONFER_HOME__=${JSON.stringify(cfg)};window.__CONFER_SHARE__=${JSON.stringify(shareCfg)};`);
  const inject = `<link rel="stylesheet" href="/__confer__/share.css"><script src="/__confer__/share.js" defer></script>`;
  if (html.includes('</body>')) html = html.replace('</body>', `${inject}\n</body>`);
  else html += inject;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(200, headers);
  res.end(html);
}

// ── reload watchers (one per open doc) ────────────────────────────────────────
const reloadClients = new Map(); // docPath -> Set<res>
const watchers = new Set();      // docPaths already being watched
function ensureWatch(docPath) {
  if (watchers.has(docPath)) return;
  watchers.add(docPath);
  try {
    watch(docPath, { persistent: false }, () => {
      for (const c of reloadClients.get(docPath) || []) c.write('event: reload\ndata: {}\n\n');
    });
  } catch {}
}

// ── Claude bridge (SSE) ──────────────────────────────────────────────────────
// Shared event-stream runner: spawns claude -p, parses stream-json, and
// streams tool / delta / thinking / done / error events back to the client.
// The per-thread persistence lives in `ask()` (which wraps this) and the
// snapshot installer has its own onDone hook — keeping the streaming protocol
// in one place so the two surfaces stay identical.
function streamClaude({ res, workspace, addDirs, prompt, allowEdits, sessionId, isNew, onDone, onSession }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // read-only while shared (unless the owner allowed edits): simply omit the
  // write tools — the agent can't call what isn't in --allowedTools.
  const tools = allowEdits ? ['Read', 'Grep', 'Glob', 'Edit', 'Write'] : ['Read', 'Grep', 'Glob'];
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...tools,
    '--append-system-prompt', SYSTEM_PROMPT];
  for (const d of addDirs) args.push('--add-dir', d);
  if (opts.model) args.push('--model', opts.model);
  if (isNew) args.push('--session-id', sessionId);
  else args.push('--resume', sessionId);

  const child = spawn('claude', args, { cwd: workspace });
  child.stdin.write(prompt); child.stdin.end();

  let buf = '';
  let finalText = '';
  let cost = null;

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
          send('tool', { name: e.content_block.name });
        } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          send('delta', { text: e.delta.text });
        } else if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') {
          send('thinking', { text: e.delta.thinking });
        }
      } else if (ev.type === 'result') {
        finalText = ev.result || finalText;
        cost = ev.total_cost_usd ?? null;
        if (ev.session_id && onSession) onSession(ev.session_id);
      } else if (ev.type === 'assistant' && !finalText) {
        const txt = (ev.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (txt) finalText = txt;
      }
    }
  });

  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c.toString()));

  child.on('error', (err) => {
    send('error', { message: `Failed to launch claude: ${err.message}` });
    res.end();
  });

  child.on('close', async (code) => {
    if (code !== 0 && !finalText) {
      send('error', { message: stderr.trim() || `claude exited ${code}` });
      return res.end();
    }
    if (onDone) {
      try { await onDone({ text: finalText, cost }); }
      catch (e) { send('error', { message: `save failed: ${e.message}` }); }
    }
    send('done', { text: finalText, cost, sessionId });
    res.end();
  });

  res.on('close', () => { try { child.kill('SIGTERM'); } catch {} });
}

function ask(res, ctx, t, question, { allowEdits = true } = {}) {
  const { sessionId, isNew, sink } = resolveSession(ctx, t);
  const includeContext = t.messages.length === 0;
  const prompt = buildPrompt({
    includeContext, question, anchor: t.anchor, docName: ctx.docName,
    workspace: ctx.workspace, mdPath: ctx.mdPath, htmlPath: ctx.htmlPath,
  });
  // A cross-workspace binding must resume in the session's own home dir
  // (--resume can't see it from anywhere else); the doc's workspace stays
  // readable through --add-dir.
  const b = ctx.state.binding || {};
  const spawnWs = (b.mode === 'connected' && b.workspace) ? b.workspace : ctx.workspace;
  streamClaude({
    res, workspace: spawnWs, addDirs: ctx.addDirs, prompt, allowEdits,
    sessionId, isNew,
    onSession: (id) => { sink.sessionId = id; },
    onDone: async ({ text, cost }) => {
      t.messages.push({ role: 'user', text: question, ts: Date.now() });
      t.messages.push({ role: 'assistant', text, cost, ts: Date.now() });
      await saveState(ctx.statePath, ctx.state);
    },
  });
}

// Seeder used by snapshot install — same streaming protocol, but the prompt
// carries the snapshot transcript instead of the per-thread highlight context,
// and there's no persisted thread to update.
function seedFromSnapshot(res, ctx, snapshot, question, anchor, { allowEdits = true } = {}) {
  const sessionId = randomUUID();
  const prompt = buildSnapshotPrompt({ snapshot, question, anchor });
  // If the workspace folder from the snapshot exists on this viewer's
  // machine, run the agent there. Otherwise fall back to a path-less run; the
  // Read/Grep/Glob tools will fail gracefully rather than spawning in /.
  const ws = existsSyncSafe(snapshot.workspace) ? snapshot.workspace : ctx?.workspace || process.cwd();
  streamClaude({
    res, workspace: ws, addDirs: ctx?.addDirs || (existsSyncSafe(snapshot.workspace) ? [snapshot.workspace] : []),
    prompt, allowEdits, sessionId, isNew: true,
  });
}

function existsSyncSafe(p) { try { return existsSync(p); } catch { return false; } }

// Build a synthetic in-memory doc context for `--install-snapshot`. The
// synthetic "path" is `<snap-id>.confer-snapshot@<workspace>`, which means
// ctxFromReq routes on it the same way it routes on a real file. We don't
// save anything to disk: the snapshot itself is read-only context, and any
// new Q&A turns are kept in memory for the lifetime of the server (the user
// can copy the chat out as they go via the panel).
async function loadSnapshotContext(snapPath, { override, extraDirs = [] } = {}) {
  if (!existsSync(snapPath)) { console.error(`Confer: snapshot not found: ${snapPath}`); process.exit(1); }
  const snap = await readSnapshot(snapPath);
  const ws = override || snap.workspace || process.cwd();
  const docId = `${path.basename(snapPath, '.json')}+${path.basename(ws)}`;
  const virtualPath = `__snapshot__/${docId}`;
  return {
    docPath: virtualPath,
    dir: path.dirname(snapPath),
    docName: snap.doc?.name || `Snapshot ${snap.id || ''}`,
    workspace: existsSyncSafe(ws) ? ws : process.cwd(),
    addDirs: existsSyncSafe(ws) ? [ws, ...extraDirs] : [...extraDirs],
    statePath: null,                // synthetic — no sidecar
    isMarkdown: false,
    mdPath: snap.doc?.isMarkdown ? snap.doc.path : null,
    htmlPath: !snap.doc?.isMarkdown ? snap.doc.path : null,
    state: {
      version: 1,
      binding: { mode: 'per-thread' }, // each question gets a fresh session; that's the whole point
      threads: [],                    // populated lazily as the user asks
      snapshot,                       // kept verbatim for the install endpoint
    },
  };
}

// ── router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // top-level pages (carry the token; confined to ROOT)
    if (p === '/') return cliDoc ? serveDoc(req, res, cliDoc) : serveHome(req, res);
    if (p === '/view') {
      const ctx = await ctxFromReq(req, url);
      if (!ctx) { res.writeHead(404); return res.end('Confer: doc not found or outside root'); }
      ensureWatch(ctx.docPath);
      return serveDoc(req, res, ctx);
    }
    if (p === '/__confer__/overlay.js') return serveStatic(res, path.join(PUBLIC, 'overlay.js'), 'text/javascript');
    if (p === '/__confer__/overlay.css') return serveStatic(res, path.join(PUBLIC, 'overlay.css'), 'text/css');
    if (p === '/__confer__/share.js') return serveStatic(res, path.join(PUBLIC, 'share.js'), 'text/javascript');
    if (p === '/__confer__/share.css') return serveStatic(res, path.join(PUBLIC, 'share.css'), 'text/css');
    if (p === '/__confer__/home.js') return serveStatic(res, path.join(PUBLIC, 'home.js'), 'text/javascript');
    if (p === '/__confer__/home.css') return serveStatic(res, path.join(PUBLIC, 'home.css'), 'text/css');
    if (p === '/__confer__/health') return json(res, 200, { ok: true });
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    // share presence stream (who's watching) — open like the reload stream so
    // EventSource (which can't set a token header) can subscribe; the roster
    // (with IPs) is only sent to local/owner subscribers.
    if (p === '/__confer__/share/events') {
      const vid = viewerVid(req);
      const client = { res, vid, local: isLocalReq(req) };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      if (vid) { viewers.touch(vid, clientHints(req)); viewers.live(vid, +1); }
      presenceClients.add(client);
      sendSnapshot(client);
      broadcast();
      req.on('close', () => { presenceClients.delete(client); if (vid) viewers.live(vid, -1); broadcast(); });
      return;
    }

    // reload stream (doc file changed on disk), scoped to one doc
    if (p === '/__confer__/events') {
      const ctx = await ctxFromReq(req, url);
      if (!ctx) return json(res, 404, { error: 'no such doc' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      ensureWatch(ctx.docPath);
      let set = reloadClients.get(ctx.docPath);
      if (!set) reloadClients.set(ctx.docPath, (set = new Set()));
      set.add(res);
      req.on('close', () => set.delete(res));
      return;
    }

    // everything below is API → require token
    if (!authed(req)) return json(res, 403, { error: 'forbidden' });

    // file finder: list a directory (dirs + html docs) confined to ROOT
    if (p === '/__confer__/browse' && req.method === 'GET') {
      try {
        const listing = await browse(ROOT, url.searchParams.get('path'));
        const counts = await sessionCounts();
        for (const e of listing.entries) {
          if (e.type === 'dir' && e.isGitRoot) e.sessions = counts.get(path.resolve(e.path)) || 0;
        }
        return json(res, 200, listing);
      } catch (err) {
        return json(res, err.code === 'EOUTSIDE' ? 403 : 404, { error: String(err.message || err) });
      }
    }

    // fuzzy search across docs (html + md) anywhere under ROOT
    if (p === '/__confer__/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const results = await searchIndex.search(q, 40);
      const starred = await library.starredSet();
      for (const r of results) r.starred = starred.has(r.path);
      return json(res, 200, { query: q.trim(), results });
    }

    // recently-viewed + starred docs (the launcher's quick-access lists)
    if (p === '/__confer__/library' && req.method === 'GET') {
      return json(res, 200, await library.view(true));
    }
    if (p === '/__confer__/star' && req.method === 'POST') {
      const { path: docPath, on } = await readBody(req);
      try {
        const abs = await resolveDoc(ROOT, docPath); // validate: a real doc under ROOT
        const starred = await library.toggleStar(abs, on);
        return json(res, 200, { path: abs, starred });
      } catch (err) {
        return json(res, err.code === 'EOUTSIDE' ? 403 : 400, { error: String(err.message || err) });
      }
    }

    // ── public-sharing controls (not doc-scoped) ────────────────────────────────
    if (p === '/__confer__/share/state' && req.method === 'GET') {
      return json(res, 200, snapshotFor(isLocalReq(req)));
    }
    if (p === '/__confer__/share/whoami' && req.method === 'POST') {
      const vid = viewerVid(req);
      const { ip } = await readBody(req);
      if (vid && ip) { viewers.touch(vid, { ...clientHints(req), selfIp: String(ip).slice(0, 64) }); broadcast(); }
      return json(res, 200, { ok: true });
    }
    if (p === '/__confer__/share/start' && req.method === 'POST') {
      try { printShare(await share.start({ allowEdits: opts.allowRemoteEdits })); }
      catch (e) { return json(res, 500, { error: String(e.message || e) }); }
      return json(res, 200, snapshotFor(isLocalReq(req)));
    }
    if (p === '/__confer__/share/stop' && req.method === 'POST') {
      printShare(await share.stop('manual'));
      return json(res, 200, snapshotFor(isLocalReq(req)));
    }
    if (p === '/__confer__/share/extend' && req.method === 'POST') {
      const { ms } = await readBody(req);
      share.extend(Number(ms) > 0 ? Number(ms) : undefined);
      return json(res, 200, snapshotFor(isLocalReq(req)));
    }
    if (p === '/__confer__/share/allow-edits' && req.method === 'POST') {
      if (!isLocalReq(req)) return json(res, 403, { error: 'the edit toggle is owner-only' });
      const { on } = await readBody(req);
      share.setAllowEdits(!!on);
      return json(res, 200, snapshotFor(isLocalReq(req)));
    }

    // all remaining API routes are scoped to a doc
    const ctx = await ctxFromReq(req, url);
    if (!ctx) return json(res, 404, { error: 'no such doc' });

    if (p === '/__confer__/state' && req.method === 'GET') {
      return json(res, 200, { threads: ctx.state.threads, binding: ctx.state.binding });
    }

    if (p === '/__confer__/sessions' && req.method === 'GET') {
      const sessions = await listSessions(ctx.workspace);
      return json(res, 200, { sessions, current: CURRENT_SESSION, workspace: ctx.workspace });
    }

    if (p === '/__confer__/connect' && req.method === 'POST') {
      const { mode, sessionId } = await readBody(req);
      if (mode === 'per-thread') ctx.state.binding = { mode: 'per-thread' };
      else if (mode === 'shared') ctx.state.binding = { mode: 'shared', sessionId: null };
      else if (mode === 'connected' && sessionId) {
        if (await sessionExists(ctx.workspace, sessionId)) {
          ctx.state.binding = { mode: 'connected', sessionId };
        } else {
          // Not in this doc's workspace — the session may live in another
          // project dir. --resume only works from the session's own cwd, so
          // record that home and spawn the agent there on ask.
          const home = await findSessionHome(sessionId);
          if (!home || !existsSync(home)) {
            return json(res, 404, { error: `No session ${String(sessionId).slice(0, 8)}… found in any Claude Code workspace on this machine (or the folder it was started in no longer exists).` });
          }
          ctx.state.binding = { mode: 'connected', sessionId, workspace: home };
        }
      }
      else return json(res, 400, { error: 'bad binding' });
      await saveState(ctx.statePath, ctx.state);
      return json(res, 200, { binding: ctx.state.binding });
    }

    if (p === '/__confer__/thread' && req.method === 'POST') {
      const { anchor } = await readBody(req);
      const t = { id: randomUUID(), sessionId: null, anchor, messages: [], createdAt: Date.now() };
      ctx.state.threads.push(t); await saveState(ctx.statePath, ctx.state);
      return json(res, 200, { id: t.id });
    }

    if (p.startsWith('/__confer__/thread/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      ctx.state.threads = ctx.state.threads.filter((t) => t.id !== id);
      await saveState(ctx.statePath, ctx.state);
      return json(res, 200, { ok: true });
    }

    // append an extra highlighted passage to an existing thread (ask in same thread)
    if (/^\/__confer__\/thread\/[^/]+\/anchor$/.test(p) && req.method === 'POST') {
      const id = p.split('/')[3];
      const t = thread(ctx, id);
      if (!t) return json(res, 404, { error: 'no such thread' });
      const { anchor } = await readBody(req);
      (t.anchors ||= []).push(anchor);
      await saveState(ctx.statePath, ctx.state);
      return json(res, 200, { ok: true });
    }

    if (p === '/__confer__/ask' && req.method === 'POST') {
      const { threadId, question } = await readBody(req);
      const t = thread(ctx, threadId);
      if (!t) return json(res, 404, { error: 'no such thread' });
      if (!question?.trim()) return json(res, 400, { error: 'empty question' });
      // While shared, remote visitors are read-only unless the owner allowed edits.
      const allowEdits = !share.active || share.state().allowEdits || isLocalReq(req);
      return ask(res, ctx, t, question.trim(), { allowEdits });
    }

    // ── session snapshots ────────────────────────────────────────────────────
    // GET  /__confer__/snapshots        → list snapshots for this doc
    // POST /__confer__/snapshot         → build one (owner-only — touches local ~/.claude)
    // GET  /__confer__/snapshot?id=...  → fetch one (used by viewer's Continue flow)
    // DEL  /__confer__/snapshot?id=...  → delete one
    // POST /__confer__/snapshot/install → seed a fresh claude session from a snapshot
    if (p === '/__confer__/snapshots' && req.method === 'GET') {
      return json(res, 200, { snapshots: await listSnapshots(ctx.docPath) });
    }
    if (p === '/__confer__/snapshot' && req.method === 'POST') {
      // Build phase always needs the owner's local ~/.claude, so it's strictly
      // local-only — even with public sharing + allowEdits, we won't hand
      // visitors the ability to mint snapshots against your account.
      if (!isLocalReq(req)) return json(res, 403, { error: 'snapshot build is owner-only' });
      const { includeThinking = false } = await readBody(req);
      const b = ctx.state.binding || {};
      if (b.mode !== 'connected' || !b.sessionId) {
        return json(res, 400, { error: 'snapshot needs a connected session binding' });
      }
      // Sidecar directory = the doc's folder. Same convention as
      // <doc>.confer.json — snapshots travel with the doc.
      const dir = path.dirname(ctx.docPath);
      try {
        const out = await buildSnapshot({
          // cross-workspace binding: the transcript lives in the session's
          // home project dir, not the doc's
          workspace: b.workspace || ctx.workspace,
          sessionId: b.sessionId,
          docName: ctx.docName,
          docPath: ctx.docPath,
          isMarkdown: ctx.isMarkdown,
          binding: b,
          highlights: ctx.state.threads,
          snapshotDir: dir,
          includeThinking: !!includeThinking,
        });
        audit(`SNAPSHOT id=${out.id} turns=${out.turns} prompts=${out.prompts}`);
        return json(res, 200, out);
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }
    if (p === '/__confer__/snapshot' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      const sp = resolveSnapshotPath(ctx.docPath, id);
      if (!sp) return json(res, 404, { error: 'no such snapshot' });
      try {
        const snap = await readSnapshot(sp);
        // Strip the local doc absolute path unless the requester is local —
        // public viewers get the metadata (workspace, transcript, prompts)
        // but not the filesystem identity of the doc on the owner's machine.
        const publicView = !isLocalReq(req) ? { ...snap, doc: { ...snap.doc, path: null } } : snap;
        return json(res, 200, { snapshot: publicView, path: sp });
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) });
      }
    }
    if (p === '/__confer__/snapshot' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const sp = resolveSnapshotPath(ctx.docPath, id);
      if (!sp) return json(res, 404, { error: 'no such snapshot' });
      await deleteSnapshot(sp);
      audit(`SNAPSHOT_DELETE id=${id}`);
      return json(res, 200, { ok: true });
    }
    if (p === '/__confer__/snapshot/install' && req.method === 'POST') {
      // Viewer-side: take a snapshot id (read from a doc-path the viewer is
      // already bound to), pipe the snapshot turns into a fresh per-thread
      // Claude session, stream the response back. Cost runs on the VIEWER's
      // Claude subscription — owner pays nothing.
      const { id, snapshot: provided, question, anchor } = await readBody(req);
      // Two ways to install: (a) the viewer has the snapshot id + is bound
      // to a doc that has a local snapshot file (owner's server scenario);
      // (b) the viewer shipped the snapshot body inline (snapshot-mode
      // scenario, e.g. when they ran `confer --install-snapshot <file>`).
      let snap;
      if (provided && typeof provided === 'object') {
        snap = provided;
      } else {
        const sp = resolveSnapshotPath(ctx.docPath, id);
        if (!sp) return json(res, 404, { error: 'no such snapshot' });
        snap = await readSnapshot(sp);
      }
      if (!question?.trim()) return json(res, 400, { error: 'empty question' });
      // Remote installs always run read-only. Locally, edits are allowed.
      const allowEdits = isLocalReq(req);
      return seedFromSnapshot(res, ctx, snap, question.trim(), anchor || null, { allowEdits });
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(opts.port, opts.host, () => {
  const url = `http://${opts.host}:${opts.port}/`;
  console.log(`\n  Confer`);
  if (cliDoc) {
    const bd = cliDoc.state.binding.mode === 'connected' ? `connected → ${cliDoc.state.binding.sessionId?.slice(0, 8)}…`
      : cliDoc.state.binding.mode === 'shared' ? 'shared (one session for the doc)' : 'per-thread (isolated)';
    console.log(`  doc    ▸ ${cliDoc.docName}`);
    console.log(`  brain  ▸ headless Claude Code in ${cliDoc.workspace}`);
    console.log(`  session▸ ${bd}`);
  } else {
    console.log(`  mode   ▸ launcher — pick a doc from the file finder`);
    console.log(`  finder ▸ ${START}  (boundary: ${ROOT})`);
  }
  if (CURRENT_SESSION) console.log(`  current▸ ${CURRENT_SESSION.slice(0, 8)}… (this Claude Code session, flagged in the picker)`);
  console.log(`  share  ▸ click “Share” in the UI to publish over Tailscale Funnel (any device)`);
  console.log(`\n  open ▸ ${url}\n`);
  if (opts.share) share.start({ allowEdits: opts.allowRemoteEdits }).then(printShare).catch((e) => console.error(`  share failed: ${e.message || e}`));
});

// never leave a dangling public funnel — tear it down on exit
function shutdown() { try { share.stopSync(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { share.stopSync(); } catch {} });
