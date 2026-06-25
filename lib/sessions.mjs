// List existing Claude Code sessions for a workspace, so a Confer doc can
// connect to one instead of spawning fresh isolated sessions.
import { readdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

// Claude Code encodes the cwd into the project dir name by replacing every
// non-alphanumeric char with '-'. Fall back to scanning if that guess misses.
async function resolveProjectDir(workspace) {
  const guess = path.join(PROJECTS, workspace.replace(/[^a-zA-Z0-9]/g, '-'));
  if (existsSync(guess)) return guess;
  if (!existsSync(PROJECTS)) return null;
  for (const d of await readdir(PROJECTS)) {
    const dir = path.join(PROJECTS, d);
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
      if (!files.length) continue;
      const head = await readHead(path.join(dir, files[0]), 4096);
      const cwd = firstCwd(head);
      if (cwd && path.resolve(cwd) === path.resolve(workspace)) return dir;
    } catch {}
  }
  return null;
}

function readHead(file, bytes) {
  return new Promise((resolve) => {
    const s = createReadStream(file, { start: 0, end: bytes - 1, encoding: 'utf8' });
    let buf = ''; s.on('data', (c) => (buf += c)); s.on('end', () => resolve(buf)); s.on('error', () => resolve(buf));
  });
}

function firstCwd(head) {
  for (const line of head.split('\n')) {
    try { const o = JSON.parse(line); if (o.cwd) return o.cwd; } catch {}
  }
  return null;
}

// Stream a transcript and return the first genuine human message (skipping
// tool results, system reminders, command wrappers). Falls back to the
// compaction summary line. Early-exits so big transcripts stay cheap.
function extractLabel(file) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let summary = ''; let count = 0; let done = false;
    const finish = (v) => { if (done) return; done = true; rl.close(); resolve(v); };
    rl.on('line', (line) => {
      if (done || ++count > 1500) return finish(summary);
      let o; try { o = JSON.parse(line); } catch { return; }
      if (o.type === 'summary' && o.summary && !summary) summary = o.summary.replace(/\s+/g, ' ').trim().slice(0, 90);
      if (o.type !== 'user' || !o.message) return;
      const c = o.message.content;
      let txt = '';
      if (typeof c === 'string') txt = c;
      else if (Array.isArray(c)) {
        if (c.some((b) => b.type === 'tool_result')) return; // a tool-result turn, not a prompt
        txt = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      }
      txt = (txt || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      if (/^(<|Caveat:|\[Image:|\[Request interrupted)/.test(txt)) return; // injected noise
      finish(txt.slice(0, 90));
    });
    rl.on('close', () => finish(summary));
    rl.on('error', () => finish(summary));
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

export async function listSessions(workspace, limit = 40) {
  const dir = await resolveProjectDir(workspace);
  if (!dir) return [];
  const files = (await readdir(dir)).filter((f) => UUID_RE.test(f));
  const out = [];
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      const st = await stat(full);
      const snippet = await extractLabel(full);
      out.push({ id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size, snippet: snippet || '(no prompt)' });
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}
