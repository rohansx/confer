import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { browse, resolveDoc } from '../lib/browse.mjs';

function tree() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'confer-browse-'));
  mkdirSync(path.join(root, 'docs'));
  mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
  mkdirSync(path.join(root, '.hidden'));
  writeFileSync(path.join(root, 'design.html'), '<html></html>');
  writeFileSync(path.join(root, 'page.htm'), '<html></html>');
  writeFileSync(path.join(root, 'notes.md'), '# nope');
  writeFileSync(path.join(root, 'secret.txt'), 'nope');
  return root;
}

test('browse lists dirs + html/md docs only, hides dotfiles and non-docs', async () => {
  const root = tree();
  const { entries } = await browse(root, root);
  const names = entries.map((e) => e.name);
  assert.deepEqual(names, ['docs', 'repo', 'design.html', 'notes.md', 'page.htm']); // dirs first, then docs A→Z
  assert.ok(!names.includes('.hidden'));
  assert.ok(!names.includes('secret.txt'));
  assert.equal(entries.find((e) => e.name === 'notes.md').kind, 'md');
  assert.equal(entries.find((e) => e.name === 'design.html').kind, 'html');
});

test('browse flags git-root directories', async () => {
  const root = tree();
  const { entries } = await browse(root, root);
  const repo = entries.find((e) => e.name === 'repo');
  const docs = entries.find((e) => e.name === 'docs');
  assert.equal(repo.isGitRoot, true);
  assert.equal(docs.isGitRoot, false);
});

test('browse exposes a parent only while inside root', async () => {
  const root = tree();
  assert.equal((await browse(root, root)).parent, null);
  assert.equal((await browse(root, path.join(root, 'docs'))).parent, root);
});

test('browse rejects paths that escape the root', async () => {
  const root = tree();
  await assert.rejects(() => browse(root, path.join(root, '..')), /outside/);
  await assert.rejects(() => browse(root, '/etc'), /outside/);
});

test('resolveDoc accepts html + md under root, rejects non-docs and escapes', async () => {
  const root = tree();
  assert.equal(await resolveDoc(root, path.join(root, 'design.html')), path.join(root, 'design.html'));
  assert.equal(await resolveDoc(root, path.join(root, 'notes.md')), path.join(root, 'notes.md'));
  await assert.rejects(() => resolveDoc(root, path.join(root, 'secret.txt')), /\.md|doc/);
  await assert.rejects(() => resolveDoc(root, '/etc/hosts'), /\.md|doc|outside/);
  await assert.rejects(() => resolveDoc(root, path.join(root, 'missing.html')), /ENOENT|no such/i);
});
