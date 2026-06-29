/* Confer launcher — fuzzy search, recents, stars, folder browser. No build. */
(() => {
  const CFG = window.__CONFER_HOME__ || {};
  const TOKEN = CFG.token;
  const ROOT = CFG.root;

  const list = document.getElementById('list');
  const crumbs = document.getElementById('crumbs');
  const upBtn = document.getElementById('up');
  const refresh = document.getElementById('refresh');
  const bar = document.getElementById('bar');
  const quick = document.getElementById('quick');
  const q = document.getElementById('q');
  const qclear = document.getElementById('qclear');
  document.getElementById('rootlabel').textContent = ROOT;

  let cur = CFG.start || ROOT;
  let searchSeq = 0;

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rootName = ROOT === '/' ? '/' : (ROOT.split('/').filter(Boolean).pop() || '/');
  const api = (p, opts = {}) => fetch(`/__confer__/${p}`, { ...opts, headers: { 'content-type': 'application/json', 'x-confer-token': TOKEN, ...(opts.headers || {}) } });
  const icon = (kind) => (kind === 'md' ? '📝' : '📄');
  const openDoc = (path) => { location.href = '/view?doc=' + encodeURIComponent(path); };

  // ── a doc row, reused by search results, recents, stars, and the browser ──────
  function docRow(d, { showPath = false } = {}) {
    const row = el('div', 'row doc');
    const sub = showPath && d.rel ? `<span class="path">${esc(d.rel)}</span>` : '';
    row.innerHTML = `<span class="ic">${icon(d.kind)}</span><span class="nm"><span class="t">${esc(d.name)}</span>${sub}</span>`;
    const star = el('button', 'star' + (d.starred ? ' on' : ''), d.starred ? '★' : '☆');
    star.title = d.starred ? 'Unstar' : 'Star';
    star.onclick = async (ev) => {
      ev.stopPropagation();
      try {
        const r = await api('star', { method: 'POST', body: JSON.stringify({ path: d.path, on: !d.starred }) });
        const j = await r.json();
        if (r.ok) { d.starred = j.starred; star.classList.toggle('on', d.starred); star.textContent = d.starred ? '★' : '☆'; star.title = d.starred ? 'Unstar' : 'Star'; if (!q.value.trim()) loadQuick(); }
      } catch {}
    };
    const open = el('span', 'open', 'Open →');
    row.append(star, open);
    row.onclick = () => openDoc(d.path);
    return row;
  }

  // ── fuzzy search ──────────────────────────────────────────────────────────────
  let searchTimer = null;
  q.oninput = () => { qclear.hidden = !q.value; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 130); };
  q.onkeydown = (e) => {
    if (e.key === 'Enter') { const first = list.querySelector('.row.doc'); if (first) first.click(); }
    else if (e.key === 'Escape') { q.value = ''; qclear.hidden = true; runSearch(); }
  };
  qclear.onclick = () => { q.value = ''; qclear.hidden = true; q.focus(); runSearch(); };

  async function runSearch() {
    const query = q.value.trim();
    if (!query) { showBrowseMode(); return; }
    const seq = ++searchSeq;
    bar.style.display = 'none'; quick.style.display = 'none';
    list.innerHTML = '<div class="empty">Searching…</div>';
    let data;
    try { data = await (await api('search?q=' + encodeURIComponent(query))).json(); }
    catch (e) { list.innerHTML = `<div class="empty err">Search failed: ${esc(String(e))}</div>`; return; }
    if (seq !== searchSeq) return; // a newer keystroke won
    list.innerHTML = '';
    if (!data.results.length) { list.appendChild(el('div', 'empty', `No docs matching <b>${esc(query)}</b> under <code>${esc(rootName)}</code>.`)); return; }
    list.appendChild(el('div', 'section-h', `${data.results.length} match${data.results.length === 1 ? '' : 'es'}`));
    for (const d of data.results) list.appendChild(docRow(d, { showPath: true }));
  }

  // ── quick access (starred + recent), shown only when not searching ────────────
  async function loadQuick() {
    let lib;
    try { lib = await (await api('library')).json(); } catch { quick.innerHTML = ''; return; }
    quick.innerHTML = '';
    const section = (title, items, showPath) => {
      if (!items.length) return;
      quick.appendChild(el('div', 'section-h', title));
      const wrap = el('div', 'qlist');
      for (const d of items) wrap.appendChild(docRow(d, { showPath }));
      quick.appendChild(wrap);
    };
    section('★ Starred', lib.starred, true);
    section('🕘 Recent', lib.recents.slice(0, 8), true);
  }

  function showBrowseMode() {
    bar.style.display = ''; quick.style.display = '';
    loadQuick();
    load(cur);
  }

  // ── folder browser ──────────────────────────────────────────────────────────────
  async function load(p) {
    list.innerHTML = '<div class="empty">Loading…</div>';
    let data;
    try {
      const r = await api('browse?path=' + encodeURIComponent(p));
      data = await r.json();
      if (!r.ok) throw new Error(data.error || `server ${r.status}`);
    } catch (e) {
      list.innerHTML = `<div class="empty err">Couldn't open this folder:<br>${esc(String(e.message || e))}</div>`;
      return;
    }
    cur = data.path;
    renderCrumbs(data.path);
    upBtn.disabled = !data.parent;
    upBtn.onclick = () => data.parent && load(data.parent);
    renderList(data);
  }

  function renderCrumbs(p) {
    crumbs.innerHTML = '';
    const addSeg = (label, target, isCur) => {
      const s = el('span', 'seg' + (isCur ? ' cur' : ''), esc(label));
      if (!isCur) s.onclick = () => load(target);
      crumbs.appendChild(s);
    };
    const here = p === ROOT;
    addSeg(rootName, ROOT, here);
    if (!here) {
      const rel = p.slice(ROOT.length).replace(/^\//, '');
      const parts = rel.split('/').filter(Boolean);
      let acc = ROOT;
      parts.forEach((part, i) => { acc += '/' + part; crumbs.appendChild(el('span', 'sep', '/')); addSeg(part, acc, i === parts.length - 1); });
    }
    crumbs.scrollLeft = crumbs.scrollWidth;
  }

  function renderList(data) {
    list.innerHTML = '';
    if (!data.entries.length) { list.appendChild(el('div', 'empty', 'No subfolders or <b>.html</b> / <b>.md</b> docs here.')); return; }
    for (const e of data.entries) {
      if (e.type === 'dir') {
        const badge = e.isGitRoot ? `<span class="badge">● git${e.sessions ? ` · ${e.sessions} session${e.sessions === 1 ? '' : 's'}` : ''}</span>` : '';
        const row = el('div', 'row dir', `<span class="ic">📁</span><span class="nm">${esc(e.name)}</span>${badge}`);
        row.onclick = () => load(e.path);
        list.appendChild(row);
      } else {
        list.appendChild(docRow(e));
      }
    }
  }

  refresh.onclick = () => load(cur);
  showBrowseMode();
})();
