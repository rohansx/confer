/**
 * Confer viewer overlay — injected at serve time into the doc HTML on the
 * content (view) origin. Two modes, picked from the query string at runtime:
 *
 *  1. Embedded (no `overlay` param): a tiny read-only script that reports text
 *     selections to the parent dashboard via postMessage, so the dashboard's
 *     comment composer can anchor a quote. Used by the in-app review iframe.
 *
 *  2. Full-page (`?overlay=1`): the doc is the whole browser page (maximized,
 *     full fidelity). This script renders a comments sidebar (in a Shadow DOM
 *     so the doc's own CSS can't touch it), and reaches the app's comment API
 *     through a HIDDEN, cookie-bearing bridge iframe on the app origin
 *     (`${app}/api/v1/comment-bridge`). The app's session cookie never leaves
 *     the app origin — the doc page (view origin) can only postMessage to the
 *     bridge, never read it. A "minimize" button returns to the dashboard.
 *
 * CSP on the view origin allows `script-src 'unsafe-inline'` (this inline
 * script) and, in overlay mode, `frame-src <app origin>` (the bridge iframe).
 */
export const VIEWER_OVERLAY_SCRIPT = `
<script>
(function() {
  var params = new URLSearchParams(location.search);
  var mode = params.get('overlay');
  var app = params.get('app');
  var space = params.get('space');
  var slug = params.get('slug');
  var vid = params.get('vid');

  // --- selection reporting (always on; the dashboard uses it too) ---------
  function postSelection(payload) {
    try { parent.postMessage(Object.assign({type:'confer:selection'}, payload), '*'); } catch (e) {}
  }
  function capture() {
    try {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { postSelection({quote: ''}); return; }
      var text = sel.toString();
      if (!text) { postSelection({quote: ''}); return; }
      var doc = document.body ? document.body.innerText : '';
      var idx = doc.indexOf(text);
      var prefix = idx >= 0 ? doc.substring(Math.max(0, idx - 32), idx) : '';
      var suffix = idx >= 0 ? doc.substring(idx + text.length, Math.min(doc.length, idx + text.length + 32)) : '';
      postSelection({quote: text, prefix: prefix, suffix: suffix, start: idx, end: idx + text.length});
    } catch (e) {}
  }
  document.addEventListener('selectionchange', capture);
  document.addEventListener('mouseup', capture);
  document.addEventListener('touchend', capture);

  if (mode !== '1' || !app || !space || !slug) return; // embedded mode stops here

  // --- full-page overlay mode: comments sidebar + bridge -------------------
  // Shift the page left so the doc doesn't sit under the sidebar.
  var shift = document.createElement('style');
  shift.textContent = 'html{padding-right:380px !important;}@media(max-width:900px){html{padding-right:0 !important;}}';
  document.head.appendChild(shift);

  var host = document.createElement('div');
  host.id = 'confer-comments-host';
  host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:380px;z-index:2147483647';
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({mode:'open'}) : host;

  var CSS = [
    ':host,:host *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}',
    '.wrap{display:flex;flex-direction:column;height:100vh;background:#f7f4ea;color:#2b2820;border-left:1px solid rgba(60,55,40,.13);}',
    '.hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(60,55,40,.13);background:linear-gradient(145deg,#f9f6ed,#ebe6d7);}',
    '.hd b{font-size:14px;font-weight:600;flex:1}',
    '.btn{font:inherit;font-size:12px;font-weight:600;border:1px solid rgba(60,55,40,.26);border-radius:8px;background:#fff;padding:6px 12px;cursor:pointer;color:#6b665a}',
    '.list{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
    '.c{background:#f9f6ed;border:1px solid rgba(60,55,40,.13);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;box-shadow:-3px -3px 8px rgba(255,255,255,.85),4px 5px 12px rgba(120,110,88,.24)}',
    '.c.res{opacity:.55}',
    '.ch{display:flex;align-items:center;gap:7px}',
    '.av{width:20px;height:20px;border-radius:50%;background:linear-gradient(145deg,#f9f6ed,#ebe6d7);display:grid;place-items:center;font-size:9px;font-weight:700;color:#b03a2e}',
    '.who{font-size:12px;font-weight:600}',
    '.when{font-family:ui-monospace,monospace;font-size:10px;color:#8f8b7e}',
    '.tag{font-family:ui-monospace,monospace;font-size:9px;background:#f3efe4;padding:1px 6px;border-radius:5px;color:#8f8b7e}',
    '.q{border-left:2px solid #b03a2e;background:rgba(176,58,46,.05);padding:7px 9px;font-family:ui-monospace,monospace;font-size:10.5px;color:#8f8b7e;font-style:italic}',
    '.body{margin:0;font-family:Caveat,cursive;font-size:18px;line-height:1.3;color:#b03a2e}',
    '.resbtn{align-self:flex-start;font:inherit;font-size:11px;font-weight:600;border:1px solid rgba(60,55,40,.13);border-radius:7px;background:linear-gradient(145deg,#f9f6ed,#ebe6d7);padding:5px 12px;cursor:pointer;color:#6b665a}',
    '.resbtn.done{color:#3a7d44;background:rgba(58,125,68,.1);border-color:#3a7d44}',
    '.pend{border-left:2px solid #b03a2e;background:rgba(176,58,46,.05);padding:7px 9px;font-family:ui-monospace,monospace;font-size:10.5px;color:#8f8b7e;font-style:italic}',
    '.cmp{display:flex;gap:7px;padding:11px 12px;border-top:1px solid rgba(60,55,40,.13);background:#f3efe4}',
    '.cmp input{flex:1;border:none;background:transparent;outline:none;font:inherit;font-size:12px;color:#2b2820}',
    '.send{font:inherit;font-size:11px;font-weight:700;border:none;border-radius:7px;background:#3a7d44;color:#f6f3e9;padding:6px 12px;cursor:pointer}',
    '.hint{font-family:ui-monospace,monospace;font-size:10px;color:#8f8b7e;padding:4px 14px 10px}',
    '.empty{color:#8f8b7e;font-size:12px}',
    '.err{color:#b03a2e;font-size:12px;padding:10px 12px}'
  ].join('\\n');
  var style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);

  var wrap = document.createElement('div'); wrap.className='wrap'; root.appendChild(wrap);
  var hd = document.createElement('div'); hd.className='hd'; wrap.appendChild(hd);
  var title = document.createElement('b'); title.textContent='Comments'; hd.appendChild(title);
  var min = document.createElement('button'); min.className='btn'; min.textContent='⤡ minimize'; min.onclick=function(){ try{ window.location.href = app + '/#/r/' + vid; }catch(e){} }; hd.appendChild(min);
  var list = document.createElement('div'); list.className='list'; wrap.appendChild(list);
  var pend = document.createElement('div'); pend.className='pend'; pend.style.display='none'; wrap.appendChild(pend);
  var errEl = document.createElement('div'); errEl.className='err'; errEl.style.display='none'; wrap.appendChild(errEl);
  var cmp = document.createElement('div'); cmp.className='cmp'; wrap.appendChild(cmp);
  var input = document.createElement('input'); input.placeholder='Comment…'; cmp.appendChild(input);
  var send = document.createElement('button'); send.className='send'; send.textContent='Send'; cmp.appendChild(send);
  var hint = document.createElement('div'); hint.className='hint'; hint.textContent='Select text in the doc to anchor a comment.'; wrap.appendChild(hint);

  // --- bridge iframe (app origin, cookie-bearing) --------------------------
  var bridge = document.createElement('iframe');
  bridge.style.cssText='position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
  bridge.src = app + '/api/v1/comment-bridge?view=' + encodeURIComponent(location.origin);
  (document.body || document.documentElement).appendChild(bridge);
  var pending = new Map();
  var ready = false; var queue = [];
  function flush(){ while(ready && queue.length){ bridge.contentWindow.postMessage(queue.shift(), app); } }
  function rpc(cmd, args){ return new Promise(function(resolve,reject){ var id=Math.random().toString(36).slice(2); pending.set(id,{resolve:resolve,reject:reject}); var msg={confer:true,id:id,cmd:cmd,args:args}; if(ready) bridge.contentWindow.postMessage(msg, app); else queue.push(msg); }); }
  window.addEventListener('message', function(e){
    var m = e.data; if(!m || !m.confer) return;
    if(m.ready === true){ ready = true; flush(); load(); return; }
    if(m.id && pending.has(m.id)){ var p=pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error||'rpc error')); }
  });

  // --- render ---------------------------------------------------------------
  var anchor = null;
  function setAnchor(a){ anchor = a; if(a){ pend.style.display='block'; pend.textContent='“'+(a.quote.length>70?a.quote.slice(0,70)+'…':a.quote)+'”'; } else { pend.style.display='none'; } }
  function initials(n){ n=(n||'?').trim().split(/\\s+/); return n.length<2 ? n[0].slice(0,2).toUpperCase() : (n[0][0]+n[n.length-1][0]).toUpperCase(); }
  function ago(ts){ if(!ts) return '—'; var s=(Date.now()-ts)/1000; if(s<60)return Math.max(1,Math.floor(s))+'s ago'; var m=s/60; if(m<60)return Math.floor(m)+'m ago'; var h=m/60; if(h<24)return Math.floor(h)+'h ago'; return new Date(ts).toLocaleDateString(); }

  function render(comments){
    list.innerHTML='';
    if(!comments || comments.length===0){ var e=document.createElement('div'); e.className='empty'; e.textContent='No comments yet. Select text in the doc to anchor one.'; list.appendChild(e); return; }
    comments.forEach(function(c){
      var res = c.resolved_at != null;
      var row=document.createElement('div'); row.className='c'+(res?' res':'');
      var ch=document.createElement('div'); ch.className='ch';
      var av=document.createElement('span'); av.className='av'; av.textContent=initials(c.author_name || c.author_user_id); ch.appendChild(av);
      var who=document.createElement('span'); who.className='who'; who.textContent=c.author_name || (c.author_user_id||'').slice(0,8); ch.appendChild(who);
      var when=document.createElement('span'); when.className='when'; when.textContent=ago(c.created_at); ch.appendChild(when);
      if(c.is_carried_over){ var t=document.createElement('span'); t.className='tag'; t.textContent='carried'; ch.appendChild(t); }
      row.appendChild(ch);
      if(c.anchor_quote){ var q=document.createElement('div'); q.className='q'; q.textContent='“'+c.anchor_quote+'”'; row.appendChild(q); }
      var b=document.createElement('div'); b.className='body'; b.textContent=c.body; row.appendChild(b);
      if(canResolve){ var rb=document.createElement('button'); rb.className='resbtn'+(res?' done':''); rb.textContent=res?'✓ Resolved — reopen':'Resolve thread'; rb.onclick=function(){ rpc('resolve',{id:c.id}).then(load).catch(showErr); }; row.appendChild(rb); }
      list.appendChild(row);
    });
  }
  function showErr(e){ errEl.style.display='block'; errEl.textContent = (e&&e.message)||String(e); }
  function load(){ rpc('list',{space:space,slug:slug}).then(function(r){ render(r && r.data ? r.data.comments : []); }).catch(showErr); }

  // resolve permission: derived from /starred? no — fetch is_owner via a tiny rpc? keep simple: allow resolve always; server enforces.
  var canResolve = true;

  // selection → anchor
  window.addEventListener('message', function(e){ if(e.data && e.data.type==='confer:selection'){ setAnchor(e.data.quote ? {quote:e.data.quote,prefix:e.data.prefix,suffix:e.data.suffix} : null); } });

  function submit(){
    var body=input.value.trim(); if(!body) return;
    send.disabled=true;
    rpc('create',{space:space,slug:slug,body:{body:body,version_id:vid,anchor:anchor}}).then(function(){ input.value=''; setAnchor(null); load(); }).catch(showErr).finally(function(){ send.disabled=false; });
  }
  send.onclick=submit;
  input.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); });
})();
</script>
`;