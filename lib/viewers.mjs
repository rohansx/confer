// Viewer registry for a public share session.
//
// We track who is connected by a per-browser cookie id, NOT by IP — Tailscale
// Funnel hides the real public IP of anonymous internet visitors by design (it
// stamps the node's own tailnet IP instead). So observability here is built on
// what we CAN see reliably: distinct devices that joined, who is watching right
// now, each viewer's device/browser (from the User-Agent, which Funnel does
// forward), whether a request is you (local) or a remote visitor, plus a
// best-effort public IP the visitor's own browser self-reports.

export function deviceFromUA(ua = '') {
  const u = ua || '';
  const os =
    /iPhone/i.test(u) ? 'iPhone' :
    /iPad/i.test(u) ? 'iPad' :
    /Android/i.test(u) ? 'Android' :
    /Macintosh|Mac OS X/i.test(u) ? 'Mac' :
    /Windows/i.test(u) ? 'Windows' :
    /CrOS/i.test(u) ? 'ChromeOS' :
    /Linux/i.test(u) ? 'Linux' : 'Device';
  const browser =
    /Edg\//i.test(u) ? 'Edge' :
    /OPR\/|Opera/i.test(u) ? 'Opera' :
    /Chrome\//i.test(u) ? 'Chrome' :
    /Firefox\//i.test(u) ? 'Firefox' :
    /Version\/.*Safari/i.test(u) ? 'Safari' :
    /curl\//i.test(u) ? 'curl' :
    /Claude-User/i.test(u) ? 'Claude' : '';
  return browser ? `${os} · ${browser}` : os;
}

export function createViewers({ now = () => Date.now() } = {}) {
  const byId = new Map(); // vid -> viewer record
  let joined = 0;

  // Record activity for a viewer. Creating a new record counts as a "join".
  // Every field is optional so callers can enrich a viewer over several calls
  // (first the request hints, later the self-reported IP) without clobbering.
  function touch(id, { ua, origin, ip, selfIp } = {}) {
    if (!id) return null;
    let v = byId.get(id);
    if (!v) { v = { id, firstSeen: now(), hits: 0, live: 0 }; byId.set(id, v); joined++; }
    v.lastSeen = now();
    v.hits++;
    if (ua != null) { v.ua = ua; v.device = deviceFromUA(ua); }
    if (origin) v.origin = origin;   // 'local' | 'remote'
    if (ip) v.ip = ip;               // forwarded IP (node's tailnet IP for funnel)
    if (selfIp) v.selfIp = selfIp;   // browser self-reported public IP (the real one)
    return v;
  }

  // Open/close of a live presence connection (the share SSE channel). A viewer
  // may have several tabs open, so this is a counter, not a boolean.
  function live(id, delta) {
    const v = byId.get(id);
    if (v) { v.live = Math.max(0, (v.live || 0) + delta); v.lastSeen = now(); }
  }

  const roster = () => [...byId.values()].sort((a, b) => a.firstSeen - b.firstSeen);

  function counts() {
    const watching = roster().filter((v) => v.live > 0);
    return {
      joined,
      watching: watching.length,
      remotes: watching.filter((v) => v.origin === 'remote').length,
    };
  }

  return { touch, live, roster, counts };
}
