// Minimal, dependency-free Markdown → HTML, for serving .md docs in Confer.
//
// Not CommonMark-complete — it covers what docs actually use: headings (with
// slug ids, so Confer's highlight anchoring can still target a section),
// paragraphs, bold/italic/strikethrough, inline + fenced code, links, images,
// GFM tables, blockquotes, lists, and horizontal rules. Unknown constructs
// degrade to readable text. Output is meant to live inside <main>, which the
// overlay scopes its anchoring to.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

// Inline span formatting. Code spans are extracted first so their contents are
// never re-parsed as markdown.
function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return ` ${codes.length - 1} `; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, a, u) => `<img alt="${escAttr(a)}" src="${escAttr(u)}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => `<a href="${escAttr(u)}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/ (\d+) /g, (_, i) => codes[+i]);
}

// Split a GFM table row on `|`, trimming outer pipes and each cell.
function tableCells(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

// GFM column alignment from a separator cell like `:---`, `---:`, `:---:`.
function tableAlign(sep) {
  const l = sep.startsWith(':'), r = sep.endsWith(':');
  if (l && r) return 'center';
  if (r) return 'right';
  if (l) return 'left';
  return null;
}

// Try to collect a GFM table starting at `start`. Returns { html, end } or null.
function tryTable(lines, start) {
  if (start + 2 > lines.length) return null;
  if (!/^\s*\|/.test(lines[start])) return null;
  const sepLine = lines[start + 1] || '';
  if (!/^\s*\|[\s:|_-]+\|/.test(sepLine)) return null;
  const cols = tableCells(lines[start]);
  const aligns = tableCells(sepLine).map(tableAlign);
  const attrFor = (i) => { const a = aligns[i]; return a ? ` style="text-align:${a}"` : ''; };
  const thead = `<thead><tr>${cols.map((c, i) => `<th${attrFor(i)}>${inline(c)}</th>`).join('')}</tr></thead>`;
  const bodyRows = [];
  let i = start + 2;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    const cells = tableCells(lines[i]);
    bodyRows.push(`<tr>${cols.map((_, ci) => `<td${attrFor(ci)}>${inline(cells[ci] ?? '')}</td>`).join('')}</tr>`);
    i++;
  }
  return { html: `<table>${thead}<tbody>${bodyRows.join('')}</tbody></table>`, end: i };
}

export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const slugs = new Set();
  const uniqSlug = (t) => { const base = slugify(t); let s = base, n = 1; while (slugs.has(s)) s = `${base}-${++n}`; slugs.add(s); return s; };
  const isBlockStart = (l) => /^(#{1,6}\s|>|\s*([-*+]|\d+[.)])\s|```|~~~|\s*([-*_])(\s*\3){2,}\s*$|\|)/.test(l);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*(```+|~~~+)(.*)$/);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '```+' : '~~~+'}\\s*$`);
      const lang = fence[2].trim().split(/\s/)[0]; // first word is the language
      i++; const buf = [];
      while (i < lines.length && !close.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
      out.push(`<pre><code${cls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { const lvl = h[1].length; const id = uniqSlug(h[2]); out.push(`<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`); i++; continue; }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // GFM table — header row followed by a separator row of `|---|` cells
    const tbl = tryTable(lines, i);
    if (tbl) { out.push(tbl.html); i = tbl.end; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${inline(m[3])}</li>`);
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}
