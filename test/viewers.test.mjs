import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createViewers, deviceFromUA } from '../lib/viewers.mjs';

test('deviceFromUA recognises common devices and browsers', () => {
  assert.equal(deviceFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E Safari/604.1'), 'iPhone · Safari');
  assert.match(deviceFromUA('Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0 Safari/537'), /Windows · Chrome/);
  assert.match(deviceFromUA('Mozilla/5.0 (X11; Linux x86_64) Gecko Firefox/121.0'), /Linux · Firefox/);
  assert.equal(deviceFromUA('curl/8.0'), 'Device · curl');
});

test('touch creates a viewer once, counts one join, and enriches over calls', () => {
  const v = createViewers();
  v.touch('a', { ua: 'curl/8', origin: 'remote', ip: '1.2.3.4' });
  v.touch('a', { selfIp: '9.9.9.9' }); // later self-report must not clobber earlier fields
  assert.equal(v.counts().joined, 1);
  const [row] = v.roster();
  assert.equal(row.origin, 'remote');
  assert.equal(row.ip, '1.2.3.4');
  assert.equal(row.selfIp, '9.9.9.9');
  assert.equal(row.hits, 2);
});

test('live() counts only currently-watching viewers and how many are remote', () => {
  const v = createViewers();
  v.touch('a', { origin: 'remote' });
  v.touch('b', { origin: 'local' });
  v.live('a', +1); v.live('b', +1);
  let c = v.counts();
  assert.equal(c.joined, 2);
  assert.equal(c.watching, 2);
  assert.equal(c.remotes, 1);
  v.live('a', -1);
  c = v.counts();
  assert.equal(c.watching, 1);
  assert.equal(c.remotes, 0);
});

test('touch ignores an empty id', () => {
  const v = createViewers();
  assert.equal(v.touch(null, {}), null);
  assert.equal(v.counts().joined, 0);
});
