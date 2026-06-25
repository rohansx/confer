import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findGitRoot, resolveWorkspace } from '../lib/workspace.mjs';

function scratch() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'confer-ws-'));
  mkdirSync(path.join(root, '.git'));
  const docsDir = path.join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  const doc = path.join(docsDir, 'design.html');
  writeFileSync(doc, '<html></html>');
  return { root, docsDir, doc };
}

test('findGitRoot walks up to the nearest .git', () => {
  const { root, docsDir } = scratch();
  assert.equal(findGitRoot(docsDir), root);
  assert.equal(findGitRoot(root), root);
});

test('findGitRoot returns null when there is no repo', () => {
  const bare = mkdtempSync(path.join(os.tmpdir(), 'confer-nogit-'));
  assert.equal(findGitRoot(bare), null);
});

test('resolveWorkspace uses the git root and includes the doc dir', () => {
  const { root, docsDir, doc } = scratch();
  const { workspace, addDirs } = resolveWorkspace(doc);
  assert.equal(workspace, root);
  assert.ok(addDirs.includes(root));
  assert.ok(addDirs.includes(docsDir));
});

test('resolveWorkspace falls back to the doc folder without a repo', () => {
  const bare = mkdtempSync(path.join(os.tmpdir(), 'confer-nogit-'));
  const doc = path.join(bare, 'a.html');
  writeFileSync(doc, '<html></html>');
  assert.equal(resolveWorkspace(doc).workspace, bare);
});

test('resolveWorkspace honours an explicit override', () => {
  const { root, doc } = scratch();
  const { workspace } = resolveWorkspace(doc, { override: root });
  assert.equal(workspace, root);
});
