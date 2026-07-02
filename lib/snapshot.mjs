// Session snapshots — take a Claude Code session that a doc is bound to and
// freeze it into a portable, normalized bundle that anyone can drop into
// their own ~/.claude/projects/ and resume in their own Claude subscription.
//
// The artifact format is intentionally minimal:
//   { version, createdAt, doc, workspace, binding,
//     transcript: [{ role, text, ts }, ...],
//     prompts:    [{ threadId, anchor, messages: [{role,text,ts}] }, ...] }
//
// - No raw JSONL: no real sessionId from the owner's machine, no file paths
//   beyond what the doc needs to render, no subscription/account hints.
// - When a viewer installs a snapshot, their Confer seeds a fresh per-thread
//   Claude Code session by piping the snapshot turns into a `claude -p` call
//   (same code path as ask(), just seeded differently).
//
// Snapshots live next to the doc:
//   <doc>.confer.snapshot.<short-id>.json
// so they travel with the file (which is exactly where the doc-bound threads
// already live) and are easy to find, copy, or share alongside the doc itself.

import { readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const SNAP_VERSION = 1;

// Stream a Claude Code JSONL transcript line-by-line and pull out every
// genuine user/assistant message. Skips tool_result turns, system reminders,
// injected noise, thinking blocks (kept separately if requested), and any
// non-message rows (mode / permission-mode / title / etc.).
//
// Returns: { messages: [{ role, text, ts }], thinking: [{ role, text, ts }] }
async function extractTextTranscript(file, { includeThinking = false } = {}) {
  const messages = [];
  const thinking = [];
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const m = o.message; if (!m) continue;
    const c = m.content;
    if (!Array.isArray(c)) continue;

    // user turns: skip pure tool_result responses and any turn that's just
    // a tool-result echo (those don't carry conversation context).
    if (o.type === 'user') {
      if (c.some((b) => b.type === 'tool_result')) continue;
      const txt = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
      if (!txt) continue;
      if (/^(<|Caveat:|\[Image:|\[Request interrupted)/.test(txt)) continue;
      messages.push({ role: 'user', text: txt, ts: o.timestamp || null });
      continue;
    }

    // assistant turns: gather visible text. Thinking blocks are kept aside
    // (only emitted if the owner opts into them) so the default bundle stays
    // small and free of long internal reasoning.
    const textParts = [];
    const thinkParts = [];
    for (const b of c) {
      if (b.type === 'text') textParts.push(b.text);
      else if (b.type === 'thinking' && b.thinking) thinkParts.push(b.thinking);
    }
    const text = textParts.join('\n').trim();
    if (text) messages.push({ role: 'assistant', text, ts: o.timestamp || null });
    if (includeThinking && thinkParts.length) {
      for (const t of thinkParts) thinking.push({ role: 'assistant', text: t, ts: o.timestamp || null });
    }
  }
  // chronological order — JSONL is already in chronological order, but guard
  // against any clock drift between tools.
  messages.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  thinking.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return { messages, thinking };
}

// Resolve the on-disk path to a Claude Code session file for a (workspace,
// sessionId) pair. Returns null if the session isn't there. The caller can
// pass an explicit projectsDir (used by tests); otherwise we honor
// CONFER_PROJECTS_DIR, falling back to ~/.claude/projects.
export function sessionFilePath(workspace, sessionId, projectsDir = process.env.CONFER_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')) {
  // Path safety: allow alphanumeric + dash (real Claude Code IDs are UUIDs,
  // but we don't want to over-restrict against forward-compatible formats).
  // Existence of the .jsonl is the actual authority — invalid ids here simply
  // resolve to no file.
  const safe = String(sessionId || '').trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(safe)) return null;
  // Reject things that would traverse out of the projects dir.
  if (safe.includes('..') || safe.startsWith('-') || safe.endsWith('-')) return null;
  const encoded = String(workspace || '').replace(/[^a-zA-Z0-9]/g, '-');
  const p = path.join(projectsDir, encoded, `${safe}.jsonl`);
  return existsSync(p) ? p : null;
}

// Build a snapshot from a (workspace, sessionId). Pure: just reads + writes
// once. No spawning of claude, no network — that's for the installer.
export async function buildSnapshot({
  workspace, sessionId, docName, docPath, isMarkdown, binding,
  highlights = [],                  // [{ threadId, anchor, messages }]
  snapshotDir,                      // resolved by caller (next to doc)
  includeThinking = false,
  projectsDir,
}) {
  const file = sessionFilePath(workspace, sessionId, projectsDir);
  if (!file) throw new Error('session not found');
  const { messages, thinking } = await extractTextTranscript(file, { includeThinking });

  // Embed the highlights (the questions visitors asked on this doc, plus
  // their answers as captured by ask()) so the doc-specific context travels
  // with the session. Anchors are tiny {quote, prefix, suffix, sectionId}
  // dicts — totally safe to ship.
  const prompts = (highlights || []).map((h) => ({
    threadId: h.threadId,
    anchor: h.anchor || null,
    messages: Array.isArray(h.messages) ? h.messages.map((m) => ({
      role: m.role, text: m.text || '', ts: m.ts || null,
    })) : [],
  }));

  const shortId = randomBytes(4).toString('hex');
  const createdAt = new Date().toISOString();
  const bundle = {
    version: SNAP_VERSION,
    id: shortId,
    createdAt,
    doc: { name: docName, path: docPath, isMarkdown: !!isMarkdown },
    workspace,
    binding: binding ? { mode: binding.mode, sessionId: binding.sessionId || null } : null,
    transcript: messages,
    thinking: includeThinking ? thinking : undefined,
    prompts,
  };
  const outPath = path.join(snapshotDir, `${docName}.confer.snapshot.${shortId}.json`);
  // atomic: tmp + rename, so a crash mid-write can't leave a half-baked file.
  const tmp = `${outPath}.tmp`;
  await writeFile(tmp, JSON.stringify(bundle));
  await rename(tmp, outPath);
  return { id: shortId, path: outPath, turns: messages.length, prompts: prompts.length };
}

// List snapshots for a doc. Lightweight — just stats, not parses the JSON.
// Returns: [{ id, createdAt, turns, prompts, path }]
export async function listSnapshots(docPath) {
  const dir = path.dirname(docPath);
  const base = path.basename(docPath);
  const prefix = `${base}.confer.snapshot.`;
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of await readdir(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith('.json')) continue;
    const full = path.join(dir, f);
    try {
      const raw = await readFile(full, 'utf8');
      const b = JSON.parse(raw);
      out.push({
        id: b.id || f.slice(prefix.length, -'.json'.length),
        createdAt: b.createdAt || null,
        turns: Array.isArray(b.transcript) ? b.transcript.length : 0,
        prompts: Array.isArray(b.prompts) ? b.prompts.length : 0,
        path: full,
      });
    } catch {}
  }
  // newest first
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

// Read a snapshot back as JSON. Caller is responsible for bounds-checking
// the path (we read whatever you point us at — this is owner-only code).
export async function readSnapshot(snapshotPath) {
  const raw = await readFile(snapshotPath, 'utf8');
  return JSON.parse(raw);
}

// Drop a snapshot file from disk. Idempotent.
export async function deleteSnapshot(snapshotPath) {
  if (existsSync(snapshotPath)) await unlink(snapshotPath);
}

// Resolve a snapshot file from a doc + a short id (the `.id` field on the
// bundle). Returns the absolute path, or null if no such snapshot lives next
// to the doc — so the route can 404 cleanly when the user passes a stale id.
export function resolveSnapshotPath(docPath, shortId) {
  if (!/^[0-9a-f]+$/i.test(String(shortId || ''))) return null;
  const base = path.basename(docPath);
  const candidate = path.join(path.dirname(docPath), `${base}.confer.snapshot.${shortId}.json`);
  return existsSync(candidate) ? candidate : null;
}

// Build the prompt that seeds a fresh Claude Code session with a snapshot.
// Same shape as the first-turn shape in lib/prompt.mjs: open with the
// workspace + doc context, then dump the transcript as a labeled block, then
// drop the visitor's first real question at the bottom.
//
// The transcript is wrapped in a fenced "Conversation history" block so the
// model clearly sees where context ends and the new question begins. This is
// the same trick Claude's own --resume uses under the hood, just normalized.
export function buildSnapshotPrompt({ snapshot, question, anchor }) {
  const turn = (m) => `[${m.role}] ${m.text}`;
  const lines = [
    `Workspace (the repository you are running in): ${snapshot.workspace}`,
    `Use Read/Grep/Glob to ground every answer in this codebase and cite concrete file:line references.`,
    ``,
    `Below is a normalized transcript of a prior conversation about the document "${snapshot.doc?.name || '(unknown)'}" that you are continuing. Treat it as your established context — do not re-answer questions already covered.`,
    ``,
    `---`,
    ``,
    ...(snapshot.transcript || []).map((m, i) => `${i + 1}. ${turn(m)}`),
    ``,
    `---`,
    ``,
  ];
  if (snapshot.prompts && snapshot.prompts.length) {
    lines.push(`For reference, here are the questions that were highlighted on the document during that conversation:`);
    lines.push(``);
    for (const p of snapshot.prompts) {
      const quote = p.anchor?.quote ? ` (on “${p.anchor.quote}”)` : '';
      lines.push(`- ${quote}${p.messages?.[0]?.text ? `: ${p.messages[0].text}` : ''}`);
    }
    lines.push(``);
  }
  if (anchor?.quote) {
    lines.push(`The visitor is now highlighting this passage from the document:`);
    lines.push(``);
    lines.push(`"""`);
    lines.push(anchor.quote.trim());
    lines.push(`"""`);
    lines.push(``);
  }
  lines.push(`Their question:`);
  lines.push(question);
  return lines.join('\n');
}
