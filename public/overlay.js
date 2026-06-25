/* Confer overlay — client annotation layer. No framework, no build. */
(() => {
  const CFG = window.__CONFER__ || {};
  const TOKEN = CFG.token;
  const api = (p, opts = {}) => fetch(`/__confer__/${p}`, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-confer-token': TOKEN, ...(opts.headers || {}) },
  });

  let threads = [];
  let binding = { mode: 'per-thread' };
  let view = { mode: 'list', threadId: null }; // 'list' | 'thread' | 'sessions'

  // ── DOM scaffold ────────────────────────────────────────────────────────────
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const launch = el('button', 'cf-launch', `<span>Confer</span><span class="cf-badge" id="cf-count">0</span>`);
  const panel = el('div', 'cf-panel');
  panel.innerHTML = `
    <div class="cf-head">
      <span class="cf-logo">Confer</span>
      <button class="cf-sessbtn" id="cf-sessbtn" title="Choose which Claude Code session answers">⛁ <span id="cf-sesslabel">per-thread</span></button>
      <button class="cf-x" title="Close">×</button>
    </div>
    <div class="cf-tabs">
      <button class="cf-tab cf-active" data-tab="list">Threads</button>
      <button class="cf-tab" data-tab="help">How</button>
    </div>
    <div class="cf-body" id="cf-body"></div>`;
  document.body.append(launch, panel);
  const body = panel.querySelector('#cf-body');

  // open/close also shift the page so the panel never covers doc content
  const openPanel = () => { panel.classList.add('cf-open'); document.documentElement.classList.add('cf-shift'); };
  const closePanel = () => { panel.classList.remove('cf-open'); document.documentElement.classList.remove('cf-shift'); };

  launch.onclick = () => { openPanel(); render(); };
  panel.querySelector('.cf-x').onclick = () => closePanel();
  panel.querySelector('#cf-sessbtn').onclick = () => { openPanel(); renderSessions(); };
  panel.querySelectorAll('.cf-tab').forEach((t) => t.onclick = () => {
    panel.querySelectorAll('.cf-tab').forEach((x) => x.classList.toggle('cf-active', x === t));
    if (t.dataset.tab === 'help') renderHelp(); else { view = { mode: 'list' }; render(); }
  });

  function sessLabel() {
    if (binding.mode === 'connected') return 'connected: ' + (binding.sessionId || '').slice(0, 8) + '…';
    if (binding.mode === 'shared') return 'shared';
    return 'per-thread';
  }
  function updateSessLabel() { panel.querySelector('#cf-sesslabel').textContent = sessLabel(); }

  // ── selection pill ───────────────────────────────────────────────────────────
  let pill = null;
  const killPill = () => { if (pill) { pill.remove(); pill = null; } };

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('.cf-panel,.cf-pill,.cf-launch,.cf-toast')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel && sel.toString().trim();
      killPill();
      if (!text || text.length < 2) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const anchor = buildAnchor(range, text);
      const openTid = (view.mode === 'thread' && panel.classList.contains('cf-open')) ? view.threadId : null;
      const askIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-7.6-4.7L3 21l1.7-1.9A8.5 8.5 0 1 1 21 11.5z"/></svg>';
      pill = el('div', 'cf-pill');
      if (openTid) {
        // a thread is open → let the user fold this selection into it (same session)
        const add = el('button', 'cf-pill-btn cf-pill-primary', '+ This thread');
        add.onclick = () => { killPill(); addToCurrent(openTid, anchor); };
        const nw = el('button', 'cf-pill-btn', 'New');
        nw.onclick = () => { killPill(); createThread(anchor); };
        pill.append(add, nw);
      } else {
        const ask = el('button', 'cf-pill-btn cf-pill-primary', `${askIcon} Ask Claude`);
        ask.onclick = () => { killPill(); createThread(anchor); };
        pill.append(ask);
      }
      pill.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
      pill.style.top = `${rect.top + window.scrollY}px`;
      document.body.appendChild(pill);
    }, 1);
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.cf-pill')) killPill(); });

  // ── anchoring ────────────────────────────────────────────────────────────────
  function buildAnchor(range, quote) {
    const host = range.startContainer.parentElement?.closest('[id]');
    const sectionId = host?.id || null;
    const ctxNode = (host || document.body);
    const full = ctxNode.textContent || '';
    const idx = full.indexOf(quote);
    const prefix = idx > 0 ? full.slice(Math.max(0, idx - 24), idx) : '';
    const suffix = idx >= 0 ? full.slice(idx + quote.length, idx + quote.length + 24) : '';
    return { quote, sectionId, prefix, suffix };
  }

  // find a Range matching an anchor's quote (prefix-biased) and wrap it
  function highlightAnchor(anchor, threadId) {
    const scope = anchor.sectionId ? document.getElementById(anchor.sectionId) : null;
    const root = scope || document.querySelector('main') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.parentElement?.closest('.cf-panel,.cf-pill,script,style')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    // build a flat index of text for searching across nodes
    const nodes = []; let combined = '';
    while (walker.nextNode()) { const n = walker.currentNode; nodes.push([n, combined.length]); combined += n.nodeValue; }
    const needle = (anchor.prefix + anchor.quote);
    let at = combined.indexOf(needle);
    let start = at >= 0 ? at + anchor.prefix.length : combined.indexOf(anchor.quote);
    if (start < 0) return false;
    const end = start + anchor.quote.length;
    const find = (pos) => {
      for (let i = 0; i < nodes.length; i++) { const [n, base] = nodes[i]; if (pos < base + n.nodeValue.length) return [n, pos - base]; }
      return null;
    };
    const s = find(start), eN = find(end);
    if (!s || !eN) return false;
    try {
      const r = document.createRange();
      r.setStart(s[0], s[1]); r.setEnd(eN[0], eN[1]);
      const mark = el('mark', 'cf-hl'); mark.dataset.thread = threadId;
      mark.onclick = (ev) => { ev.stopPropagation(); openThread(threadId); };
      r.surroundContents(mark);
      return true;
    } catch { return false; } // range spans element boundaries → skip wrap, thread still listed
  }

  function paintAll() {
    document.querySelectorAll('.cf-hl').forEach((m) => { const t = m.parentNode; t.replaceChild(document.createTextNode(m.textContent), m); t.normalize(); });
    for (const t of threads) {
      if (t.anchor) highlightAnchor(t.anchor, t.id);
      (t.anchors || []).forEach((a) => highlightAnchor(a, t.id));
    }
    document.getElementById('cf-count').textContent = threads.length;
  }

  // ── data ops ───────────────────────────────────────────────────────────────
  async function load() {
    const r = await api('state'); const d = await r.json();
    threads = d.threads || [];
    if (d.binding) binding = d.binding;
    updateSessLabel();
    paintAll();
  }
  async function createThread(anchor) {
    const r = await api('thread', { method: 'POST', body: JSON.stringify({ anchor }) });
    const { id } = await r.json();
    threads.push({ id, anchor, messages: [] });
    paintAll();
    openPanel();
    openThread(id, true);
  }
  async function delThread(id) {
    await api(`thread/${id}`, { method: 'DELETE' });
    threads = threads.filter((t) => t.id !== id);
    paintAll(); view = { mode: 'list' }; render();
  }
  // fold a new selection into an existing thread (same Claude Code session)
  async function addToCurrent(tid, anchor) {
    const t = threads.find((x) => x.id === tid); if (!t) return;
    await api(`thread/${tid}/anchor`, { method: 'POST', body: JSON.stringify({ anchor }) });
    (t.anchors ||= []).push(anchor);
    paintAll();
    if (!(view.mode === 'thread' && view.threadId === tid)) openThread(tid);
    setTimeout(() => {
      const ta = panel.querySelector('.cf-input'); if (!ta) return;
      const ref = `Regarding "${anchor.quote}": `;
      ta.value = ta.value ? `${ta.value}\n${ref}` : ref;
      ta.dispatchEvent(new Event('input')); ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }, 70);
  }

  // ── rendering ─────────────────────────────────────────────────────────────────
  function render() {
    if (view.mode === 'thread') return renderThread(view.threadId);
    if (view.mode === 'sessions') return renderSessions();
    renderList();
  }
  function openThread(id, focus) { view = { mode: 'thread', threadId: id }; openPanel(); renderThread(id, focus); }

  function renderList() {
    const f = panel.querySelector('.cf-foot'); if (f) f.remove();
    body.innerHTML = '';
    if (!threads.length) {
      body.appendChild(el('div', 'cf-empty', `<b>Select any text</b> in the doc, then click<br>“Ask Claude”. Your highlights &amp; chats<br>are saved and grounded in the repo.`));
      return;
    }
    [...threads].reverse().forEach((t) => {
      const last = t.messages[t.messages.length - 1];
      const item = el('div', 'cf-item');
      item.innerHTML = `<div class="cf-quote">“${esc(t.anchor?.quote || '')}”</div>
        <div class="cf-last">${last ? esc(snippet(last.text)) : '<span style="color:#5b6b7d">Ask a question…</span>'}</div>
        <div class="cf-meta">${t.messages.length} message${t.messages.length === 1 ? '' : 's'}</div>`;
      item.onclick = () => openThread(t.id);
      body.appendChild(item);
    });
  }

  function renderThread(id, focus) {
    const t = threads.find((x) => x.id === id); if (!t) { view = { mode: 'list' }; return renderList(); }
    body.innerHTML = '';
    const back = el('button', 'cf-back', '← All threads'); back.onclick = () => { view = { mode: 'list' }; render(); };
    body.appendChild(back);
    body.appendChild(el('div', 'cf-thread-quote', `“${esc(t.anchor?.quote || '')}”`));
    (t.anchors || []).forEach((a) => body.appendChild(el('div', 'cf-thread-quote cf-extra', `+ “${esc(a.quote)}”`)));
    const stream = el('div'); body.appendChild(stream);
    for (const m of t.messages) stream.appendChild(msgEl(m.role, m.text, m.cost));

    const foot = el('div', 'cf-foot');
    const ta = el('textarea', 'cf-input'); ta.placeholder = 'Ask about this passage…';
    ta.rows = 1; ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    const row = el('div', 'cf-send-row');
    const del = el('button', 'cf-del', 'Delete'); del.onclick = () => { if (confirm('Delete this thread & highlight?')) delThread(id); };
    const send = el('button', 'cf-send', 'Ask');
    row.append(del, el('span', 'cf-hint', '⏎ to send'), send);
    foot.append(ta, row);
    // keep composer outside the scrolling body
    const existingFoot = panel.querySelector('.cf-foot'); if (existingFoot) existingFoot.remove();
    panel.appendChild(foot);

    const submit = async () => {
      const q = ta.value.trim(); if (!q) return;
      ta.value = ''; ta.style.height = 'auto'; send.disabled = true;
      stream.appendChild(msgEl('user', q));
      const bubble = msgEl('assistant', ''); stream.appendChild(bubble);
      const tools = bubble.querySelector('.cf-tools'); const md = bubble.querySelector('.cf-bubble');
      md.classList.add('cf-cursor');
      let acc = '';
      await streamAsk(id, q, {
        tool: (n) => { tools.style.display = 'block'; tools.appendChild(el('span', 'cf-t', esc(n))); },
        delta: (txt) => { acc += txt; md.innerHTML = mdToHtml(acc); md.classList.add('cf-cursor'); body.scrollTop = body.scrollHeight; },
        done: ({ text, cost }) => {
          md.classList.remove('cf-cursor'); md.innerHTML = mdToHtml(text || acc || '_(no answer)_');
          if (cost != null) bubble.querySelector('.cf-cost').textContent = `$${cost.toFixed(4)}`;
          t.messages.push({ role: 'user', text: q }, { role: 'assistant', text: text || acc, cost });
          renderList(); paintAll();
        },
        error: (m) => { md.classList.remove('cf-cursor'); md.innerHTML = `<span style="color:#9b2c2c">⚠ ${esc(m)}</span>`; },
      });
      send.disabled = false; ta.focus();
    };
    send.onclick = submit;
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };
    if (focus) setTimeout(() => ta.focus(), 60);
    body.scrollTop = body.scrollHeight;
  }

  function renderHelp() {
    const f = panel.querySelector('.cf-foot'); if (f) f.remove();
    body.innerHTML = `<div style="font-size:13.5px;line-height:1.7;color:#27323d">
      <p><b>1.</b> Select any text in the document.</p>
      <p><b>2.</b> Click the <b>Ask Claude</b> pill that appears.</p>
      <p><b>3.</b> Ask anything — the answer comes from a <b>Claude Code</b> agent running in your repo, so it can grep the codebase and cite <code>file:line</code>.</p>
      <p><b>4.</b> Follow-ups continue the same conversation. Ask it to <b>edit the doc</b> and it will patch the source.</p>
      <p style="color:#5b6b7d">Highlights &amp; threads persist in <code>${esc(CFG.doc)}.confer.json</code>.</p>
    </div>`;
  }

  async function renderSessions() {
    view = { mode: 'sessions' };
    const f = panel.querySelector('.cf-foot'); if (f) f.remove();
    body.innerHTML = `<div class="cf-sess-intro">Which Claude Code session should answer questions in this doc?</div>`;

    const optEl = (active, title, sub, onclick) => {
      const o = el('div', 'cf-sopt' + (active ? ' cf-on' : ''), `<div class="cf-sopt-t">${title}</div><div class="cf-sopt-s">${sub}</div>`);
      o.onclick = onclick; return o;
    };
    body.appendChild(optEl(binding.mode === 'per-thread', 'New isolated session per highlight',
      'Default. Each highlight is its own conversation.', () => connect({ mode: 'per-thread' })));
    body.appendChild(optEl(binding.mode === 'shared', 'One shared session for this doc',
      'All highlights share memory in a single new session.', () => connect({ mode: 'shared' })));

    body.appendChild(el('div', 'cf-sess-h', 'Connect to an existing Claude Code session'));
    const listBox = el('div', 'cf-sess-list', `<div class="cf-empty" style="margin-top:14px">Loading sessions…</div>`);
    body.appendChild(listBox);
    body.appendChild(el('div', 'cf-warn', '⚠ Connecting to a session open in another window may interleave messages. A finished session is safest.'));

    try {
      const r = await api('sessions'); const { sessions, current } = await r.json();
      listBox.innerHTML = '';
      if (!sessions.length) listBox.appendChild(el('div', 'cf-empty', 'No sessions found for this workspace.'));
      sessions.forEach((s, i) => {
        const active = binding.mode === 'connected' && binding.sessionId === s.id;
        const isCurrent = current && s.id === current;
        const tags = [i === 0 ? 'most recent' : '', isCurrent ? '★ this session' : ''].filter(Boolean).join(' · ');
        const row = el('div', 'cf-srow' + (active ? ' cf-on' : '') + (isCurrent ? ' cf-current' : ''),
          `<div class="cf-srow-snip">${esc(s.snippet)}</div>
           <div class="cf-srow-meta">${s.id.slice(0, 8)}…${tags ? ' · ' + tags : ''}</div>
           ${isCurrent ? '<div class="cf-srow-note">⚠ live now — connecting here interleaves with your terminal</div>' : ''}`);
        row.onclick = () => connect({ mode: 'connected', sessionId: s.id });
        listBox.appendChild(row);
      });
    } catch (e) {
      listBox.innerHTML = `<div class="cf-empty" style="color:#9b2c2c">Couldn't list sessions: ${esc(String(e))}</div>`;
    }
  }

  async function connect(payload) {
    const r = await api('connect', { method: 'POST', body: JSON.stringify(payload) });
    const d = await r.json(); if (d.binding) binding = d.binding;
    updateSessLabel();
    view = { mode: 'list' };
    panel.querySelectorAll('.cf-tab').forEach((x) => x.classList.toggle('cf-active', x.dataset.tab === 'list'));
    render();
  }

  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function msgEl(role, text, cost) {
    const m = el('div', `cf-msg cf-${role}`);
    m.innerHTML = `<div class="cf-role">${role === 'user' ? 'You' : 'Claude'}</div>
      <div class="cf-tools" style="display:none"></div>
      <div class="cf-bubble">${role === 'user' ? esc(text) : mdToHtml(text)}</div>
      <div class="cf-cost">${cost != null ? '$' + cost.toFixed(4) : ''}</div>`;
    return m;
  }

  // ── SSE-over-fetch ────────────────────────────────────────────────────────────
  async function streamAsk(threadId, question, cb) {
    let res;
    try { res = await api('ask', { method: 'POST', body: JSON.stringify({ threadId, question }) }); }
    catch (e) { return cb.error(String(e)); }
    if (!res.ok || !res.body) return cb.error(`server ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event: (.*)$/m) || [])[1];
        const dl = (block.match(/^data: (.*)$/m) || [])[1];
        if (!ev || dl == null) continue;
        let data; try { data = JSON.parse(dl); } catch { continue; }
        if (ev === 'delta') cb.delta(data.text);
        else if (ev === 'tool') cb.tool(data.name);
        else if (ev === 'done') cb.done(data);
        else if (ev === 'error') cb.error(data.message);
      }
    }
  }

  // ── tiny markdown ─────────────────────────────────────────────────────────────
  function esc(s) { return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function snippet(s) { s = (s || '').replace(/[#*`>]/g, '').trim(); return s.length > 120 ? s.slice(0, 120) + '…' : s; }
  function mdToHtml(src) {
    if (!src) return '';
    const fences = [];
    src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => { fences.push(`<pre><code>${esc(code)}</code></pre>`); return ` ${fences.length - 1} `; });
    let h = esc(src)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    h = h.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    h = h.replace(/ (\d+) /g, (_, i) => fences[+i]);
    return h;
  }

  // ── live reload when the doc file changes on disk ─────────────────────────────
  try {
    const es = new EventSource('/__confer__/events');
    es.addEventListener('reload', () => showReload());
  } catch {}
  function showReload() {
    if (document.querySelector('.cf-toast')) return;
    const t = el('div', 'cf-toast', 'Doc changed on disk. <button>Reload</button>');
    t.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(t); setTimeout(() => t.remove(), 12000);
  }

  load();
})();
