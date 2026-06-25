#!/usr/bin/env node
// Confer — highlight-and-ask layer for local HTML docs, answered by a headless
// Claude Code agent running in your repo. Run it like a tool: launch with no doc
// and pick one from the in-browser file finder; Confer connects the agent to that
// folder's git repo and its latest Claude Code session.
//
//   confer                     # launcher: pick a doc from the UI file finder
//   confer serve <doc.html>    # open one doc directly
//   confer <doc.html>          # alias for `serve`
//
// Zero dependencies — Node built-ins only.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, watch, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveState } from './lib/state.mjs';
import { buildPrompt, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { listSessions, sessionCounts } from './lib/sessions.mjs';
import { browse, resolveDoc } from './lib/browse.mjs';
import { createRegistry } from './lib/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const TOKEN = randomUUID(); // simple CSRF guard: only the served page knows it

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = [...argv];
  if (a[0] === 'serve') a.shift();
  const opts = {
    port: 4317, host: '127.0.0.1', root: null, workspace: null,
    model: null, doc: null, session: null, addDirs: [],
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
    else if (v === '--help' || v === '-h') opts.help = true;
    else if (!v.startsWith('-')) opts.doc = path.resolve(v);
  }
  return opts;
}

const HELP = `Confer — highlight & ask any local HTML doc, answered by Claude Code in your repo.

Usage:
  confer                     Launcher: pick a doc from the in-browser file finder
  confer serve <doc.html>    Open one doc directly
  confer <doc.html>          Alias for serve

Options:
  --root <dir>       File-finder boundary (default: your home dir)
  --workspace <dir>  Force the agent's workspace (default: the doc's git root)
  --add-dir <dir>    Extra dir the agent may read (repeatable)
  --model <id>       Override the Claude model
  --session <mode>   Default binding: per-thread | shared | <session-id>
                     (otherwise auto-connects to the workspace's latest session)
  --port <n>         Port (default 4317)
  --host <addr>      Bind address (default 127.0.0.1)
  -h, --help         Show this help

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
// a doc passed on the CLI is pre-opened and served at `/`
const cliDoc = opts.doc ? await registry.get(opts.doc) : null;

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

// Resolve which doc an API/event call is about (from the x-confer-doc header or
// a ?doc= query), confined to ROOT. Falls back to the CLI doc when unspecified.
async function ctxFromReq(req, url) {
  const requested = req.headers['x-confer-doc'] || url.searchParams.get('doc');
  if (!requested) return cliDoc;
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

async function serveDoc(res, ctx) {
  let html = await readFile(ctx.docPath, 'utf8');
  const cfg = { token: TOKEN, doc: ctx.docName, docPath: ctx.docPath };
  const inject = `
<link rel="stylesheet" href="/__confer__/overlay.css">
<script>window.__CONFER__=${JSON.stringify(cfg)};</script>
<script src="/__confer__/overlay.js" defer></script>`;
  if (html.includes('</body>')) html = html.replace('</body>', `${inject}\n</body>`);
  else html += inject;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

async function serveHome(res) {
  let html = await readFile(path.join(PUBLIC, 'home.html'), 'utf8');
  const cfg = { token: TOKEN, root: ROOT, start: START };
  html = html.replace('/*__CONFER_HOME__*/', `window.__CONFER_HOME__=${JSON.stringify(cfg)};`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
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
function ask(res, ctx, t, question) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const { sessionId, isNew, sink } = resolveSession(ctx, t);
  const includeContext = t.messages.length === 0;

  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write',
    '--append-system-prompt', SYSTEM_PROMPT];
  for (const d of ctx.addDirs) args.push('--add-dir', d);
  if (opts.model) args.push('--model', opts.model);
  if (isNew) args.push('--session-id', sessionId);
  else args.push('--resume', sessionId);

  const prompt = buildPrompt({
    includeContext, question, anchor: t.anchor, docName: ctx.docName,
    workspace: ctx.workspace, mdPath: ctx.mdPath, htmlPath: ctx.docPath,
  });

  const child = spawn('claude', args, { cwd: ctx.workspace });
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
      handleEvent(ev);
    }
  });

  function handleEvent(ev) {
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
      if (ev.session_id) sink.sessionId = ev.session_id;
    } else if (ev.type === 'assistant' && !finalText) {
      const txt = (ev.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (txt) finalText = txt;
    }
  }

  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c.toString()));

  child.on('error', (err) => { send('error', { message: `Failed to launch claude: ${err.message}` }); res.end(); });

  child.on('close', async (code) => {
    if (code !== 0 && !finalText) {
      send('error', { message: stderr.trim() || `claude exited ${code}` });
      return res.end();
    }
    t.messages.push({ role: 'user', text: question, ts: Date.now() });
    t.messages.push({ role: 'assistant', text: finalText, cost, ts: Date.now() });
    await saveState(ctx.statePath, ctx.state);
    send('done', { text: finalText, cost, sessionId: sink.sessionId });
    res.end();
  });

  res.on('close', () => { try { child.kill('SIGTERM'); } catch {} });
}

// ── router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // top-level pages (carry the token; confined to ROOT)
    if (p === '/') return cliDoc ? serveDoc(res, cliDoc) : serveHome(res);
    if (p === '/view') {
      const ctx = await ctxFromReq(req, url);
      if (!ctx) { res.writeHead(404); return res.end('Confer: doc not found or outside root'); }
      ensureWatch(ctx.docPath);
      return serveDoc(res, ctx);
    }
    if (p === '/__confer__/overlay.js') return serveStatic(res, path.join(PUBLIC, 'overlay.js'), 'text/javascript');
    if (p === '/__confer__/overlay.css') return serveStatic(res, path.join(PUBLIC, 'overlay.css'), 'text/css');
    if (p === '/__confer__/home.js') return serveStatic(res, path.join(PUBLIC, 'home.js'), 'text/javascript');
    if (p === '/__confer__/home.css') return serveStatic(res, path.join(PUBLIC, 'home.css'), 'text/css');
    if (p === '/__confer__/health') return json(res, 200, { ok: true });
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

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
      else if (mode === 'connected' && sessionId) ctx.state.binding = { mode: 'connected', sessionId };
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
      return ask(res, ctx, t, question.trim());
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
  console.log(`\n  open ▸ ${url}\n`);
});
