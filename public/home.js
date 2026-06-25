/* Confer launcher — browse folders, open an HTML doc. No framework, no build. */
(() => {
  const CFG = window.__CONFER_HOME__ || {};
  const TOKEN = CFG.token;
  const ROOT = CFG.root;

  const list = document.getElementById('list');
  const crumbs = document.getElementById('crumbs');
  const upBtn = document.getElementById('up');
  const refresh = document.getElementById('refresh');
  document.getElementById('rootlabel').textContent = ROOT;

  let cur = CFG.start || ROOT;

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rootName = ROOT === '/' ? '/' : (ROOT.split('/').filter(Boolean).pop() || '/');

  async function load(p) {
    list.innerHTML = '<div class="empty">Loading…</div>';
    let data;
    try {
      const r = await fetch('/__confer__/browse?path=' + encodeURIComponent(p), { headers: { 'x-confer-token': TOKEN } });
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
      parts.forEach((part, i) => {
        acc += '/' + part;
        crumbs.appendChild(el('span', 'sep', '/'));
        addSeg(part, acc, i === parts.length - 1);
      });
    }
    crumbs.scrollLeft = crumbs.scrollWidth;
  }

  function renderList(data) {
    list.innerHTML = '';
    if (!data.entries.length) {
      list.appendChild(el('div', 'empty', 'No subfolders or <b>.html</b> docs here.'));
      return;
    }
    for (const e of data.entries) {
      if (e.type === 'dir') {
        const badge = e.isGitRoot
          ? `<span class="badge">● git${e.sessions ? ` · ${e.sessions} session${e.sessions === 1 ? '' : 's'}` : ''}</span>`
          : '';
        const row = el('div', 'row dir', `<span class="ic">📁</span><span class="nm">${esc(e.name)}</span>${badge}`);
        row.onclick = () => load(e.path);
        list.appendChild(row);
      } else {
        const row = el('div', 'row doc', `<span class="ic">📄</span><span class="nm">${esc(e.name)}</span><span class="open">Open →</span>`);
        row.onclick = () => { location.href = '/view?doc=' + encodeURIComponent(e.path); };
        list.appendChild(row);
      }
    }
  }

  refresh.onclick = () => load(cur);
  load(cur);
})();
