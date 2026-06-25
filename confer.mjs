#!/usr/bin/env node
// Confer — highlight-and-ask layer for any local HTML doc, answered by a
// headless Claude Code agent running in your workspace.
//
//   confer serve <doc.html> [--port 4317] [--workspace <dir>] [--model <id>]
//   confer <doc.html>                 # alias for `serve`
//
// Zero dependencies — Node built-ins only.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, watch, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadState, saveState } from './lib/state.mjs';
import { buildPrompt, SYSTEM_PROMPT } from './lib/prompt.mjs';
import { listSessions } from './lib/sessions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const TOKEN = randomUUID(); // simple CSRF guard: only the served page knows it

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = [...argv];
  if (a[0] === 'serve') a.shift();
  const opts = { port: 4317, host: '127.0.0.1', workspace: process.cwd(), model: null, doc: null, session: null };
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v === '--port') opts.port = Number(a[++i]);
    else if (v === '--host') opts.host = a[++i];
    else if (v === '--workspace' || v === '-w') opts.workspace = path.resolve(a[++i]);
    else if (v === '--model' || v === '-m') opts.model = a[++i];
    else if (v === '--session' || v === '-s') opts.session = a[++i];
    else if (v === '--current-session') opts.currentSession = a[++i];
    else if (v === '--help' || v === '-h') opts.help = true;
    else if (!v.startsWith('-')) opts.doc = path.resolve(v);
  }
  return opts;
}

const HELP = `Confer — highlight & ask any HTML doc, answered by Claude Code in your repo.

Usage:
  confer serve <doc.html> [options]
  confer <doc.html>

Options:
  --port <n>         Port (default 4317)
  --workspace <dir>  Repo root the agent runs in (default: cwd)
  --model <id>       Override the Claude model
  --session <mode>   How chats bind to Claude Code sessions:
                       per-thread (default) | shared | <existing-session-id>
                     (also switchable live from the panel's session picker)
  --host <addr>      Bind address (default 127.0.0.1)
  -h, --help         Show this help

Highlights + threads are saved next to the doc as <doc>.confer.json.
`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts.doc) { process.stdout.write(HELP); process.exit(opts.doc ? 0 : 1); }
if (!existsSync(opts.doc)) { console.error(`Confer: doc not found: ${opts.doc}`); process.exit(1); }

// the session this Confer was launched from (so the picker can flag it)
const CURRENT_SESSION = opts.currentSession || process.env.CLAUDE_CODE_SESSION_ID || null;

const DOC_DIR = path.dirname(opts.doc);
const DOC_NAME = path.basename(opts.doc);
const STATE_PATH = `${opts.doc}.confer.json`;
const MD_PATH = opts.doc.replace(/\.html?$/i, '.md');

// directories the agent may read: workspace + doc dir (+ known sibling repos)
const addDirs = new Set([opts.workspace, DOC_DIR]);
for (const repo of ['Utkrushta', 'utkrushta-assessment', 'recruiter-utkrusht']) {
  const p = path.join(opts.workspace, repo);
  if (existsSync(p)) addDirs.add(p);
}

let state = await loadState(STATE_PATH);
// session binding: how /ask maps to Claude Code sessions
//   {mode:'per-thread'}                     → fresh isolated session per highlight (default)
//   {mode:'shared', sessionId?}             → one session for the whole doc
//   {mode:'connected', sessionId}           → resume an existing Claude Code session
if (!state.binding) {
  if (opts.session === 'shared') state.binding = { mode: 'shared', sessionId: null };
  else if (opts.session && opts.session !== 'per-thread') state.binding = { mode: 'connected', sessionId: opts.session };
  else state.binding = { mode: 'per-thread' };
}
const reloadClients = new Set();

// ── helpers ──────────────────────────────────────────────────────────────────
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});
const authed = (req) => req.headers['x-confer-token'] === TOKEN;
const thread = (id) => state.threads.find((t) => t.id === id);

// Decide which Claude Code session a question runs against, per the doc's binding.
// Returns { sessionId, isNew, sink } where sink is the object whose .sessionId
// should record the resolved id (the thread, or the doc-level binding).
function resolveSession(t) {
  const b = state.binding || { mode: 'per-thread' };
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

async function serveDoc(res) {
  let html = await readFile(opts.doc, 'utf8');
  const inject = `
<link rel="stylesheet" href="/__confer__/overlay.css">
<script>window.__CONFER__=${JSON.stringify({ token: TOKEN, doc: DOC_NAME })};</script>
<script src="/__confer__/overlay.js" defer></script>`;
  if (html.includes('</body>')) html = html.replace('</body>', `${inject}\n</body>`);
  else html += inject;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// ── Claude bridge (SSE) ──────────────────────────────────────────────────────
function ask(res, t, question) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // resolve which Claude Code session this question runs against
  const { sessionId, isNew, sink } = resolveSession(t);
  // include the highlighted passage whenever this thread is starting a new topic,
  // even if the underlying session is shared/resumed
  const includeContext = t.messages.length === 0;

  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write',
    '--append-system-prompt', SYSTEM_PROMPT];
  for (const d of addDirs) args.push('--add-dir', d);
  if (opts.model) args.push('--model', opts.model);
  if (isNew) args.push('--session-id', sessionId);
  else args.push('--resume', sessionId);

  const prompt = buildPrompt({
    includeContext, question, anchor: t.anchor, docName: DOC_NAME,
    workspace: opts.workspace, mdPath: existsSync(MD_PATH) ? MD_PATH : null, htmlPath: opts.doc,
  });

  const child = spawn('claude', args, { cwd: opts.workspace });
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
      // fallback if partial deltas weren't emitted
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
    await saveState(STATE_PATH, state);
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
    if (p === '/' || p === `/${DOC_NAME}`) return serveDoc(res);
    if (p === '/__confer__/overlay.js') return serveStatic(res, path.join(PUBLIC, 'overlay.js'), 'text/javascript');
    if (p === '/__confer__/overlay.css') return serveStatic(res, path.join(PUBLIC, 'overlay.css'), 'text/css');
    if (p === '/__confer__/health') return json(res, 200, { ok: true, doc: DOC_NAME });
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    // reload stream (doc file changed on disk)
    if (p === '/__confer__/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      reloadClients.add(res);
      req.on('close', () => reloadClients.delete(res));
      return;
    }

    // everything below is API → require token
    if (!authed(req)) return json(res, 403, { error: 'forbidden' });

    if (p === '/__confer__/state' && req.method === 'GET') return json(res, 200, { threads: state.threads, binding: state.binding });

    if (p === '/__confer__/sessions' && req.method === 'GET') {
      const sessions = await listSessions(opts.workspace);
      return json(res, 200, { sessions, current: CURRENT_SESSION });
    }

    if (p === '/__confer__/connect' && req.method === 'POST') {
      const { mode, sessionId } = await readBody(req);
      if (mode === 'per-thread') state.binding = { mode: 'per-thread' };
      else if (mode === 'shared') state.binding = { mode: 'shared', sessionId: null };
      else if (mode === 'connected' && sessionId) state.binding = { mode: 'connected', sessionId };
      else return json(res, 400, { error: 'bad binding' });
      await saveState(STATE_PATH, state);
      return json(res, 200, { binding: state.binding });
    }

    if (p === '/__confer__/thread' && req.method === 'POST') {
      const { anchor } = await readBody(req);
      const t = { id: randomUUID(), sessionId: null, anchor, messages: [], createdAt: Date.now() };
      state.threads.push(t); await saveState(STATE_PATH, state);
      return json(res, 200, { id: t.id });
    }

    if (p.startsWith('/__confer__/thread/') && req.method === 'DELETE') {
      const id = p.split('/').pop();
      state.threads = state.threads.filter((t) => t.id !== id);
      await saveState(STATE_PATH, state);
      return json(res, 200, { ok: true });
    }

    // append an extra highlighted passage to an existing thread (ask in same thread)
    if (/^\/__confer__\/thread\/[^/]+\/anchor$/.test(p) && req.method === 'POST') {
      const id = p.split('/')[3];
      const t = thread(id);
      if (!t) return json(res, 404, { error: 'no such thread' });
      const { anchor } = await readBody(req);
      (t.anchors ||= []).push(anchor);
      await saveState(STATE_PATH, state);
      return json(res, 200, { ok: true });
    }

    if (p === '/__confer__/ask' && req.method === 'POST') {
      const { threadId, question } = await readBody(req);
      const t = thread(threadId);
      if (!t) return json(res, 404, { error: 'no such thread' });
      if (!question?.trim()) return json(res, 400, { error: 'empty question' });
      return ask(res, t, question.trim());
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});

// watch the doc for external edits → tell open tabs to offer a reload
try {
  watch(opts.doc, { persistent: false }, () => {
    for (const c of reloadClients) c.write('event: reload\ndata: {}\n\n');
  });
} catch {}

server.listen(opts.port, opts.host, () => {
  const url = `http://${opts.host}:${opts.port}/`;
  console.log(`\n  Confer ▸ ${DOC_NAME}`);
  console.log(`  brain  ▸ headless Claude Code in ${opts.workspace}`);
  const bd = state.binding.mode === 'connected' ? `connected → ${state.binding.sessionId?.slice(0, 8)}…`
    : state.binding.mode === 'shared' ? 'shared (one session for the doc)' : 'per-thread (isolated)';
  console.log(`  session▸ ${bd}`);
  if (CURRENT_SESSION) console.log(`  current▸ ${CURRENT_SESSION.slice(0, 8)}… (this Claude Code session, flagged in the picker)`);
  console.log(`  state  ▸ ${path.basename(STATE_PATH)}  (${state.threads.length} thread${state.threads.length === 1 ? '' : 's'})`);
  console.log(`\n  open ▸ ${url}\n`);
});
