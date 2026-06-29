// Tailscale Funnel control + the public-share session lifecycle.
//
// Confer is a localhost tool. "Sharing" brings up a Tailscale Funnel on a second
// public port (default 8443, so it never collides with anything you already run
// on :443) that proxies the public internet to Confer on 127.0.0.1. A session is
// owner-controlled: a hard kill switch plus a default auto-expiry. Teardown is
// surgical — only our port — so any other funnel on the node is left untouched.
//
// The command builders and URL parser are pure so they can be unit-tested; the
// actual `tailscale` calls go through an injectable `runTailscale` for the same
// reason.

import { execFile, spawnSync } from 'node:child_process';

export const DEFAULT_SHARE_PORT = 8443;
export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes

// `--bg` keeps the funnel alive in tailscaled after the call returns (so it
// survives the browser, even the Confer-launching terminal). `--https=<port>`
// chooses the public port; the trailing arg is the local target port.
export const funnelStartArgs = (sharePort, localPort) =>
  ['funnel', '--bg', `--https=${sharePort}`, String(localPort)];

// Targeted teardown of ONLY our port. NEVER `reset` — that wipes every funnel on
// the node (e.g. another project sharing :443).
export const funnelStopArgs = (sharePort) =>
  ['funnel', `--https=${sharePort}`, 'off'];

// Pull the public URL out of `tailscale funnel --bg` stdout, e.g.
//   "https://arch.tail52c6d7.ts.net:8443/"
export function parsePublicUrl(stdout = '') {
  const m = stdout.match(/https:\/\/[^\s/]+/);
  return m ? m[0].replace(/\/+$/, '') : null;
}

const defaultRun = (args) => new Promise((resolve, reject) => {
  execFile('tailscale', args, { timeout: 15000 }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message || '').toString().trim())) : resolve(stdout || ''));
});

export function createShare({
  localPort,
  sharePort = DEFAULT_SHARE_PORT,
  ttlMs = DEFAULT_TTL_MS,
  runTailscale = defaultRun,
  audit = () => {},
  onChange = () => {},
} = {}) {
  let session = null; // null = not sharing
  let timer = null;

  function arm() {
    clearTimeout(timer);
    timer = setTimeout(() => { stop('expired'); }, Math.max(0, session.expiresAt - Date.now()));
    if (timer && timer.unref) timer.unref();
  }

  async function start({ allowEdits = false } = {}) {
    if (session) return state();
    const stdout = await runTailscale(funnelStartArgs(sharePort, localPort));
    const url = parsePublicUrl(stdout);
    if (!url) throw new Error(`funnel started but no URL parsed from:\n${stdout}`);
    const startedAt = Date.now();
    session = { url, sharePort, localPort, allowEdits: !!allowEdits, startedAt, ttlMs, expiresAt: startedAt + ttlMs };
    arm();
    audit(`START url=${url} port=${sharePort} ttlMs=${ttlMs} allowEdits=${!!allowEdits}`);
    onChange();
    return state();
  }

  async function stop(reason = 'manual') {
    if (!session) return state();
    clearTimeout(timer); timer = null;
    const port = session.sharePort;
    session = null;
    audit(`STOP reason=${reason}`);
    try { await runTailscale(funnelStopArgs(port)); } catch { /* best-effort; tear down anyway */ }
    onChange();
    return state();
  }

  function extend(ms = ttlMs) {
    if (!session) return state();
    session.ttlMs = ms;
    session.expiresAt = Date.now() + ms;
    arm();
    audit(`EXTEND ms=${ms}`);
    onChange();
    return state();
  }

  function setAllowEdits(on) {
    if (session) { session.allowEdits = !!on; audit(`ALLOW_EDITS=${!!on}`); onChange(); }
    return state();
  }

  function state() {
    if (!session) return { active: false, sharePort };
    return {
      active: true,
      url: session.url,
      sharePort: session.sharePort,
      allowEdits: session.allowEdits,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      remainingMs: Math.max(0, session.expiresAt - Date.now()),
    };
  }

  // Synchronous, best-effort teardown for process-exit handlers, where we can't
  // await. Ensures we never leave a dangling public funnel on crash/Ctrl-C.
  function stopSync() {
    if (!session) return;
    const port = session.sharePort;
    session = null;
    clearTimeout(timer);
    try { spawnSync('tailscale', funnelStopArgs(port), { timeout: 8000 }); } catch { /* ignore */ }
  }

  return { start, stop, extend, setAllowEdits, state, stopSync, get active() { return !!session; } };
}
