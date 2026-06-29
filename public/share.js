/* Confer public-share widget — go live over Tailscale Funnel, watch who joins,
   kill it instantly. No framework, no build. */
(() => {
  const CFG = window.__CONFER_SHARE__ || {};
  const TOKEN = CFG.token;
  const IS_LOCAL = !!CFG.isLocal; // request didn't arrive via funnel/serve → it's you

  const api = (p, opts = {}) => fetch(`/__confer__/share/${p}`, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-confer-token': TOKEN, ...(opts.headers || {}) },
  });
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const btn = el('button', 'cfs-btn', '🔗 <span class="cfs-lbl">Share</span>');
  const drawer = el('div', 'cfs-drawer');
  document.body.append(btn, drawer);
  let open = false;
  btn.onclick = () => { open = !open; drawer.classList.toggle('cfs-on', open); render(); };

  let snap = { share: { active: false }, counts: { joined: 0, watching: 0, remotes: 0 }, roster: [] };
  let prevRemotes = 0;
  let tick = null;
  let reportedIp = false;

  // Self-report our public IP — the only way to surface a visitor's real IP,
  // since Tailscale Funnel hides it server-side. Best-effort, labelled,
  // spoofable, and only ever fired once a share is actually live (so a purely
  // local Confer session never pings a third party).
  async function reportSelfIp() {
    if (reportedIp) return;
    reportedIp = true;
    try {
      const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const { ip } = await r.json();
      if (ip) await api('whoami', { method: 'POST', body: JSON.stringify({ ip }) });
    } catch { /* blocked or offline — roster just shows device/browser instead */ }
  }

  // ── live presence stream ──────────────────────────────────────────────────────
  try {
    const es = new EventSource('/__confer__/share/events');
    es.addEventListener('snapshot', (e) => { try { apply(JSON.parse(e.data)); } catch {} });
  } catch {}
  // also poll state once so the button is right even before the first SSE push
  refresh();

  async function refresh() {
    try { const r = await api('state'); if (r.ok) apply(await r.json()); } catch {}
  }
  function apply(s) {
    snap = { share: s.share || { active: false }, counts: s.counts || snap.counts, roster: s.roster || snap.roster };
    // alert when a new *remote* viewer starts watching
    if (snap.counts.remotes > prevRemotes && snap.share.active) newRemoteAlert();
    prevRemotes = snap.counts.remotes;
    if (snap.share.active) reportSelfIp(); // self-report our IP once, only while live
    paintButton();
    if (open) render();
  }

  function paintButton() {
    const a = snap.share.active;
    btn.classList.toggle('cfs-live', a);
    btn.innerHTML = a
      ? `<span class="cfs-dot"></span><span class="cfs-lbl">LIVE · ${snap.counts.watching} 👁</span>`
      : '🔗 <span class="cfs-lbl">Share</span>';
  }

  function newRemoteAlert() {
    const t = el('div', 'cfs-toast', '👀 Someone just joined your shared link');
    document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 660; g.gain.value = 0.04; o.start(); setTimeout(() => { o.stop(); a.close(); }, 140); } catch {}
  }

  // ── drawer rendering ────────────────────────────────────────────────────────────
  function render() {
    clearInterval(tick); tick = null;
    drawer.innerHTML = '';
    drawer.appendChild(head());
    if (snap.share.active) renderLive(); else renderIdle();
  }

  function head() {
    const h = el('div', 'cfs-h', '<b>Public sharing</b>');
    const x = el('button', 'cfs-x', '×'); x.onclick = () => { open = false; drawer.classList.remove('cfs-on'); };
    h.appendChild(x); return h;
  }

  function renderIdle() {
    drawer.appendChild(el('div', 'cfs-note',
      'Publish this over the internet with Tailscale Funnel. Anyone with the link can open it from any device — phone included. <b>Read-only</b> by default, <b>auto-expires in 60 min</b>, and you can stop it anytime.'));
    if (!IS_LOCAL) {
      drawer.appendChild(el('div', 'cfs-warn', 'Start it from the machine running Confer.'));
      return;
    }
    const go = el('button', 'cfs-go', 'Go live →');
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Starting funnel…';
      try { apply(await (await api('start', { method: 'POST', body: '{}' })).json()); }
      catch (e) { go.disabled = false; go.textContent = 'Go live →'; alert('Could not start sharing: ' + e); }
    };
    drawer.appendChild(go);
  }

  function renderLive() {
    const url = snap.share.url || '';
    // URL + copy
    const urlRow = el('div', 'cfs-url');
    const input = el('input'); input.readOnly = true; input.value = url; input.onclick = () => input.select();
    const copy = el('button', 'cfs-copy', 'Copy');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); } catch { input.select(); document.execCommand('copy'); } };
    urlRow.append(input, copy); drawer.appendChild(urlRow);

    // QR for phones (image generator; falls back to the link if blocked/offline)
    const qr = el('div', 'cfs-qr');
    const img = el('img'); img.alt = url; img.referrerPolicy = 'no-referrer';
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=' + encodeURIComponent(url);
    img.onerror = () => qr.remove();
    qr.appendChild(img); drawer.appendChild(qr);

    // status + extend + countdown
    const status = el('div', 'cfs-status');
    const lbl = el('span', 'cfs-live-lbl');
    const extend = el('button', 'cfs-mini', 'Extend +30m');
    extend.onclick = async () => { apply(await (await api('extend', { method: 'POST', body: JSON.stringify({ ms: 30 * 60 * 1000 }) })).json()); };
    status.append(lbl, extend); drawer.appendChild(status);
    const paintCountdown = () => {
      const ms = (snap.share.expiresAt || 0) - Date.now();
      const m = Math.max(0, Math.floor(ms / 60000)), s = Math.max(0, Math.floor((ms % 60000) / 1000));
      lbl.textContent = `🟢 LIVE · expires in ${m}:${String(s).padStart(2, '0')}`;
    };
    paintCountdown(); tick = setInterval(paintCountdown, 1000);

    // access mode + allow-edits toggle (escalation → owner/local only)
    const mode = el('div', 'cfs-row', `<span>Access</span><b>${snap.share.allowEdits ? 'Read &amp; write' : 'Read-only'}</b>`);
    if (IS_LOCAL) {
      const cb = el('input', 'cfs-toggle'); cb.type = 'checkbox'; cb.checked = !!snap.share.allowEdits; cb.title = 'Let visitors ask the agent to edit files';
      cb.onchange = async () => { apply(await (await api('allow-edits', { method: 'POST', body: JSON.stringify({ on: cb.checked }) })).json()); };
      mode.appendChild(cb);
    }
    drawer.appendChild(mode);

    // observability
    const c = snap.counts;
    drawer.appendChild(el('div', 'cfs-counts', `${c.watching} watching <span>now</span> · ${c.joined} joined <span>total</span>`));
    if (snap.roster && snap.roster.length) {
      const list = el('div', 'cfs-list');
      for (const v of snap.roster) list.appendChild(viewerRow(v));
      drawer.appendChild(list);
    } else if (IS_LOCAL) {
      drawer.appendChild(el('div', 'cfs-note', 'No visitors yet. Send someone the link above.'));
    }

    const stop = el('button', 'cfs-stop', 'Stop sharing');
    stop.onclick = async () => { stop.disabled = true; stop.textContent = 'Stopping…'; apply(await (await api('stop', { method: 'POST', body: '{}' })).json()); };
    drawer.appendChild(stop);
  }

  function viewerRow(v) {
    const watching = v.live > 0;
    const tag = v.origin === 'remote' ? '<span class="cfs-tag cfs-remote">Remote</span>' : '<span class="cfs-tag cfs-you">You</span>';
    const ip = v.selfIp ? `${esc(v.selfIp)} <em>· self-reported</em>` : (v.ip ? `${esc(v.ip)} <em>· via tailnet</em>` : '<em>ip hidden</em>');
    const row = el('div', 'cfs-v' + (watching ? ' cfs-watching' : ''),
      `<span class="cfs-vdot"></span>
       <div class="cfs-vmain">
         <div class="cfs-vdev">${esc(v.device || 'Device')} ${tag}</div>
         <div class="cfs-vsub">${ip} · joined ${ago(v.firstSeen)}</div>
       </div>`);
    return row;
  }

  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
})();
