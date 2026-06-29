import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fuzzyScore, createSearchIndex } from '../lib/search.mjs';

test('fuzzyScore requires all query chars in order', () => {
  assert.ok(fuzzyScore('dsn', 'design.html') > 0);   // subsequence match
  assert.equal(fuzzyScore('xyz', 'design.html'), -1); // not a subsequence
  assert.equal(fuzzyScore('', 'anything'), 0);
});

test('fuzzyScore rewards contiguous + word-boundary matches', () => {
  // "design" contiguous from a word boundary should beat scattered chars
  assert.ok(fuzzyScore('design', 'design.html') > fuzzyScore('dsgn', 'design.html'));
  assert.ok(fuzzyScore('arch', 'architecture.md') > fuzzyScore('arch', 'a-r-c-h.md'));
});

function tree() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'confer-search-'));
  mkdirSync(path.join(root, 'docs', 'design'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'design', 'architecture.md'), '# arch');
  writeFileSync(path.join(root, 'docs', 'readme.html'), '<html></html>');
  writeFileSync(path.join(root, 'notes.markdown'), '# notes');
  writeFileSync(path.join(root, 'data.txt'), 'nope');               // not a doc
  writeFileSync(path.join(root, 'node_modules', 'pkg', 'junk.md'), '# junk'); // skipped dir
  return root;
}

test('search indexes html+md across folders, skips junk dirs and non-docs', async () => {
  const idx = createSearchIndex({ root: tree() });
  const all = await idx.search('', 50);
  const names = all.map((r) => r.name).sort();
  assert.deepEqual(names, ['architecture.md', 'notes.markdown', 'readme.html']);
  assert.ok(!names.includes('junk.md'), 'node_modules must be skipped');
  assert.ok(!names.includes('data.txt'), 'non-docs excluded');
});

test('search ranks fuzzy matches and tags kind', async () => {
  const idx = createSearchIndex({ root: tree() });
  const res = await idx.search('arch', 10);
  assert.equal(res[0].name, 'architecture.md');
  assert.equal(res[0].kind, 'md');
  assert.match(res[0].rel, /docs\/design\/architecture\.md/);
});

test('empty query returns recent docs (by mtime)', async () => {
  const idx = createSearchIndex({ root: tree() });
  const res = await idx.search('', 50);
  assert.ok(res.length === 3);
});
