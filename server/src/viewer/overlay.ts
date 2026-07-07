/**
 * Confer viewer overlay — injected at serve time into the doc HTML.
 * Captures text selections in the iframe and posts them to the parent
 * dashboard via postMessage, which the dashboard uses to pre-fill the
 * comment composer with a quote + prefix/suffix.
 *
 * The CSP on the view origin (`script-src 'unsafe-inline'`) allows this
 * inline script. The script is read-only with respect to the doc: it never
 * modifies the DOM, it only observes.
 */
export const VIEWER_OVERLAY_SCRIPT = `
<script>
(function() {
  // Defer: the body might still be parsing.
  function post(payload) {
    try { parent.postMessage(Object.assign({type:'confer:selection'}, payload), '*'); } catch (e) {}
  }
  function capture() {
    try {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { post({quote: ''}); return; }
      var text = sel.toString();
      if (!text) { post({quote: ''}); return; }
      // Anchor the quote in the doc's text content. Range.toString() returns
      // the visible selected text; we capture a small prefix/suffix window
      // around it by walking the textContent of the document.
      var doc = document.body ? document.body.innerText : '';
      var idx = doc.indexOf(text);
      var prefix = '', suffix = '';
      if (idx >= 0) {
        prefix = doc.substring(Math.max(0, idx - 32), idx);
        suffix = doc.substring(idx + text.length, Math.min(doc.length, idx + text.length + 32));
      }
      post({quote: text, prefix: prefix, suffix: suffix, start: idx, end: idx + text.length});
    } catch (e) { /* ignore */ }
  }
  document.addEventListener('selectionchange', capture);
  document.addEventListener('mouseup', capture);
  document.addEventListener('touchend', capture);
})();
</script>
`;
