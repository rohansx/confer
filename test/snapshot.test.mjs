import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildSnapshot, listSnapshots, readSnapshot,
  deleteSnapshot, resolveSnapshotPath, buildSnapshotPrompt,
} from '../lib/snapshot.mjs';

// Build a fake Claude Code project dir + JSONL. Each test points the library
// at a unique tempdir via CONFER_PROJECTS_DIR, so two tests can't step on
// each other's session files.
async function fakeProject(projectsDir, workspace, sessionId, lines) {
  const encoded = workspace.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = path.join(projectsDir, encoded);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

const BASE_LINE = {
  cwd: '/tmp/repo',
  sessionId: 'abc123',
  version: '2.0.0',
  gitBranch: 'main',
  timestamp: '2026-06-29T12:00:00.000Z',
  type: 'user',
  message: { role: 'user', content: 'Hello, world?' },
  uuid: 'u-1',
  parentUuid: null,
  isSidechain: false,
  userType: 'external',
  entrypoint: 'cli',
  requestId: 'r-1',
};

test('extractTextTranscript extracts user/assistant text in order, skips tool results and noise', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-snap-'));
  const projectsDir = path.join(root, 'claude-projects');
  try {
    const ws = path.join(root, 'repo');
    await mkdir(ws, { recursive: true });
    const sid = 'aaaa1111-bbbb-2222-cccc-333344445555';
    const lines = [
      JSON.stringify({ ...BASE_LINE, message: { role: 'user', content: [{ type: 'text', text: 'What is X?' }] } }),
      JSON.stringify({ ...BASE_LINE, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'X is Y.' }] } }),
      JSON.stringify({ ...BASE_LINE, message: { role: 'user', content: [{ type: 'tool_result', content: 'do not surface' }] } }),
      JSON.stringify({ ...BASE_LINE, type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal' }] } }),
      JSON.stringify({ ...BASE_LINE, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>ignored</system-reminder>' }] } }),
    ];
    await fakeProject(projectsDir, ws, sid, lines);
    const out = await buildSnapshot({
      workspace: ws, sessionId: sid,
      docName: 'r.html', docPath: path.join(ws, 'r.html'),
      isMarkdown: false, binding: { mode: 'connected', sessionId: sid },
      highlights: [], snapshotDir: ws, projectsDir,
    });
    const bundle = JSON.parse(await readFile(out.path, 'utf8'));
    assert.equal(out.turns, 2);
    assert.deepEqual(bundle.transcript.map((m) => m.role), ['user', 'assistant']);
    assert.equal(bundle.transcript[0].text, 'What is X?');
    assert.equal(bundle.transcript[1].text, 'X is Y.');
    assert.equal(bundle.thinking, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('includeThinking=true keeps thinking blocks separately from transcript', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-snap-'));
  const projectsDir = path.join(root, 'claude-projects');
  try {
    const ws = path.join(root, 'repo');
    await mkdir(ws, { recursive: true });
    const sid = 'thread2222-3333-4444-5555-666677778888';
    const lines = [
      JSON.stringify({ ...BASE_LINE, message: { role: 'user', content: [{ type: 'text', text: 'Explain memory.' }] } }),
      JSON.stringify({
        ...BASE_LINE, type: 'assistant',
        message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'internal reasoning here' },
          { type: 'text', text: 'Memory is...' },
        ] },
      }),
    ];
    await fakeProject(projectsDir, ws, sid, lines);
    const out = await buildSnapshot({
      workspace: ws, sessionId: sid,
      docName: 'd.html', docPath: path.join(ws, 'd.html'),
      isMarkdown: false, binding: { mode: 'connected', sessionId: sid },
      highlights: [], snapshotDir: ws, includeThinking: true, projectsDir,
    });
    const bundle = JSON.parse(await readFile(out.path, 'utf8'));
    assert.equal(bundle.transcript.length, 2);
    assert.equal(bundle.thinking.length, 1);
    assert.equal(bundle.thinking[0].text, 'internal reasoning here');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('listSnapshots / readSnapshot / deleteSnapshot / resolveSnapshotPath round-trip', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-snap-'));
  const projectsDir = path.join(root, 'claude-projects');
  try {
    const ws = path.join(root, 'repo');
    await mkdir(ws, { recursive: true });
    const sid = 'round3333-4444-5555-6666-777788889999';
    await fakeProject(projectsDir, ws, sid, [
      JSON.stringify({ ...BASE_LINE, message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    ]);
    const docPath = path.join(ws, 'design.html');
    const out = await buildSnapshot({
      workspace: ws, sessionId: sid,
      docName: 'design.html', docPath, isMarkdown: false,
      binding: { mode: 'connected', sessionId: sid },
      highlights: [
        { threadId: 't1', anchor: { quote: 'highlighted' }, messages: [{ role: 'user', text: 'why?', ts: 1 }] },
      ],
      snapshotDir: ws, projectsDir,
    });
    const list = await listSnapshots(docPath);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, out.id);
    assert.equal(list[0].turns, 1);
    assert.equal(list[0].prompts, 1);
    const resolved = resolveSnapshotPath(docPath, out.id);
    assert.equal(resolved, path.join(ws, `design.html.confer.snapshot.${out.id}.json`));
    const bundle = await readSnapshot(resolved);
    assert.equal(bundle.version, 1);
    assert.equal(bundle.prompts[0].messages[0].text, 'why?');
    await deleteSnapshot(resolved);
    const after = await listSnapshots(docPath);
    assert.equal(after.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resolveSnapshotPath rejects malformed ids and missing files', () => {
  const doc = '/tmp/nonexistent.html';
  assert.equal(resolveSnapshotPath(doc, '../escape'), null);
  assert.equal(resolveSnapshotPath(doc, 'deadbeef'), null);
});

test('buildSnapshotPrompt embeds workspace, transcript turns and the new question', () => {
  const out = buildSnapshotPrompt({
    snapshot: {
      workspace: '/home/u/repo',
      doc: { name: 'design.html' },
      transcript: [
        { role: 'user', text: 'first question', ts: '2026-06-29T00:00:00Z' },
        { role: 'assistant', text: 'first answer', ts: '2026-06-29T00:00:05Z' },
      ],
      prompts: [
        { anchor: { quote: 'highlighted bit' }, messages: [{ role: 'user', text: 'why?' }] },
      ],
    },
    question: 'follow-up question',
    anchor: { quote: 'some passage' },
  });
  assert.match(out, /Workspace .* \/home\/u\/repo/);
  assert.match(out, /\[user\] first question/);
  assert.match(out, /\[assistant\] first answer/);
  assert.match(out, /highlighted bit/);
  assert.match(out, /some passage/);
  assert.match(out, /follow-up question/);
  const turnPos = out.indexOf('[user] first question');
  const qPos = out.indexOf('follow-up question');
  assert.ok(turnPos >= 0 && qPos > turnPos, 'turns must precede the question');
});
