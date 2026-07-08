// The app-origin bridge iframe loaded by the view-origin overlay (maximize
// mode). It receives postMessage RPCs from the doc page and performs the
// comment API calls same-origin (so the session cookie applies), posting
// results back. The doc page can only postMessage to it — it can never read
// the cookie or the iframe's DOM. `view` query param locks it to the view
// origin.
export const COMMENT_BRIDGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
(function () {
  var view = new URLSearchParams(location.search).get("view");
  var parentOrigin = view || "*";
  function send(msg) { parent.postMessage(Object.assign({ confer: true }, msg), parentOrigin); }
  window.addEventListener("message", async function (e) {
    if (view && e.origin !== view) return;            // only the view origin
    var m = e.data;
    if (!m || !m.confer || m.cmd == null || m.id == null) return;
    try {
      var res;
      if (m.cmd === "list") {
        res = await fetch("/api/v1/spaces/" + encodeURIComponent(m.args.space) + "/docs/" + encodeURIComponent(m.args.slug) + "/comments?include_resolved=true", { credentials: "include" }).then(function (r) { return r.json(); });
      } else if (m.cmd === "create") {
        res = await fetch("/api/v1/spaces/" + encodeURIComponent(m.args.space) + "/docs/" + encodeURIComponent(m.args.slug) + "/comments", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(m.args.body) }).then(function (r) { return r.json(); });
      } else if (m.cmd === "resolve") {
        res = await fetch("/api/v1/comments/" + encodeURIComponent(m.args.id) + "/resolve", { method: "POST", credentials: "include" }).then(function (r) { return r.json(); });
      } else { send({ id: m.id, ok: false, error: "unknown cmd" }); return; }
      send({ id: m.id, ok: res && res.success !== false, result: res });
    } catch (err) { send({ id: m.id, ok: false, error: String(err) }); }
  });
  send({ ready: true });
})();
</script>
</body></html>`;