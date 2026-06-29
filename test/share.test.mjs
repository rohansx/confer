import { test } from 'node:test';
import assert from 'node:assert/strict';

import { funnelStartArgs, funnelStopArgs, parsePublicUrl, createShare } from '../lib/share.mjs';

test('funnelStartArgs builds a backgrounded HTTPS funnel for the given ports', () => {
  assert.deepEqual(funnelStartArgs(8443, 4317), ['funnel', '--bg', '--https=8443', '4317']);
});

test('funnelStopArgs targets only our port and NEVER resets', () => {
  const args = funnelStopArgs(8443);
  assert.deepEqual(args, ['funnel', '--https=8443', 'off']);
  assert.ok(!args.includes('reset')); // `reset` would nuke every funnel on the node
});

test('parsePublicUrl extracts the URL and trims the trailing slash', () => {
  const out = 'Available on the internet:\n\nhttps://arch.tail52c6d7.ts.net:8443/\n|-- proxy http://127.0.0.1:4317\n';
  assert.equal(parsePublicUrl(out), 'https://arch.tail52c6d7.ts.net:8443');
  assert.equal(parsePublicUrl('nothing here'), null);
});

test('createShare start/stop drive tailscale and track session state', async () => {
  const calls = [];
  const runTailscale = async (args) => {
    calls.push(args);
    return args.includes('--bg') ? 'https://node.ts.net:8443/\n' : '';
  };
  const share = createShare({ localPort: 4317, sharePort: 8443, ttlMs: 60_000, runTailscale });

  assert.equal(share.active, false);
  const st = await share.start();
  assert.equal(st.active, true);
  assert.equal(st.url, 'https://node.ts.net:8443');
  assert.equal(st.allowEdits, false);
  assert.ok(st.remainingMs > 0 && st.remainingMs <= 60_000);
  assert.deepEqual(calls[0], funnelStartArgs(8443, 4317));

  share.setAllowEdits(true);
  assert.equal(share.state().allowEdits, true);

  await share.stop();
  assert.equal(share.active, false);
  assert.deepEqual(calls.at(-1), funnelStopArgs(8443));
});

test('createShare auto-expires after its TTL and tears the funnel down', async () => {
  const calls = [];
  const runTailscale = async (args) => { calls.push(args); return 'https://node.ts.net:8443/\n'; };
  const share = createShare({ localPort: 4317, sharePort: 8443, ttlMs: 20, runTailscale });
  await share.start();
  assert.equal(share.active, true);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(share.active, false, 'should auto-stop after the ttl');
  assert.ok(calls.some((a) => a[0] === 'funnel' && a.includes('off')), 'funnel off must have run');
});

test('extend pushes the expiry further out', async () => {
  const runTailscale = async () => 'https://node.ts.net:8443/\n';
  const share = createShare({ localPort: 4317, ttlMs: 1000, runTailscale });
  await share.start();
  const before = share.state().expiresAt;
  share.extend(50_000);
  assert.ok(share.state().expiresAt > before);
  await share.stop();
});
