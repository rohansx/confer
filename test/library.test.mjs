import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createLibrary } from '../lib/library.mjs';

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'confer-lib-'));
  const a = path.join(dir, 'a.html'); writeFileSync(a, '<html></html>');
  const b = path.join(dir, 'b.md'); writeFileSync(b, '# b');
  const file = path.join(dir, 'library.json');
  let t = 1000;
  const lib = createLibrary({ file, now: () => (t += 1000) });
  return { lib, a, b, dir };
}

test('addRecent dedupes and keeps most-recent first', async () => {
  const { lib, a, b } = setup();
  await lib.addRecent(a);
  await lib.addRecent(b);
  await lib.addRecent(a); // re-view a → moves to front, no duplicate
  const { recents } = await lib.view();
  assert.deepEqual(recents.map((r) => r.path), [a, b]);
  assert.equal(recents[0].kind, 'html');
});

test('toggleStar flips and forces, and view marks recents as starred', async () => {
  const { lib, a, b } = setup();
  await lib.addRecent(a);
  assert.equal(await lib.toggleStar(a), true);   // flip on
  assert.equal(await lib.toggleStar(a), false);  // flip off
  assert.equal(await lib.toggleStar(b, true), true);
  const v = await lib.view();
  assert.deepEqual(v.starred.map((s) => s.path), [b]);
  assert.equal((await lib.starredSet()).has(b), true);
  await lib.addRecent(b);
  const v2 = await lib.view();
  assert.equal(v2.recents.find((r) => r.path === b).starred, true);
});

test('view filters out entries whose file no longer exists', async () => {
  const { lib, a, dir } = setup();
  const gone = path.join(dir, 'gone.md');
  await lib.addRecent(a);
  await lib.addRecent(gone); // never created on disk
  const { recents } = await lib.view(true);
  assert.deepEqual(recents.map((r) => r.path), [a]);
});

test('library persists across instances (same file)', async () => {
  const { lib, a, dir } = setup();
  await lib.toggleStar(a, true);
  const lib2 = createLibrary({ file: path.join(dir, 'library.json') });
  assert.equal((await lib2.starredSet()).has(a), true);
});
