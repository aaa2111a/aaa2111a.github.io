/*
 * TYB — XSS-safe DOM builder (GO fold #12 / prior-art antibot2000 txt/mk).
 * ===========================================================================
 * ALL on-chain / gateway-derived strings (tokenURI JSON name/description/
 * attributes, addresses, ids) are rendered THROUGH here — never via innerHTML.
 * The TYBRenderer gwBase is owner-set today, but "owner-trusted" != "never
 * mis-set / DNS-hijacked / migrated", and the front is what fetches+renders that
 * JSON. Structurally making a `javascript:`/`data:` or an `on*`-handler hard to
 * inject is the whole point. Exposed as frozen `window.TYB_RENDER`.
 */
(function () {
  'use strict';

  // A URL-bearing attribute value is SAFE when it has NO scheme (a relative path / hash / query —
  // e.g. 'docs.html', './x', '#a', '?q=1') OR its scheme is http/https/mailto. Everything else drops:
  // a dangerous scheme (javascript:/data:/vbscript:/…), a control char, OR a protocol-relative //host
  // (which navigates off-origin). This does not wrongly drop a bare relative like 'docs.html' (the
  // app-bar Docs link), and a %3A-encoded colon is not a scheme to the URL parser (stays relative, inert).
  function hasControlChar(u) {
    for (var i = 0; i < u.length; i++) { var c = u.charCodeAt(i); if (c < 32 || c === 127) return true; }
    return false;
  }
  function safeUrl(v) {
    var u = String(v);
    if (hasControlChar(u)) return false;               // no control chars (built via charCodeAt, no literals)
    if (/^\s*[\/\\][\/\\]/.test(u)) return false;      // block protocol-relative //host (+ \\ /\ \/ + leading space; WHATWG treats \ ≡ / in special schemes) — no live caller passes one
    var m = /^\s*([a-z][a-z0-9+.\-]*):/i.exec(u);
    if (!m) return true;                               // no scheme → relative → safe
    var s = m[1].toLowerCase();
    return s === 'http' || s === 'https' || s === 'mailto';
  }

  function txt(s) { return document.createTextNode(s == null ? '' : String(s)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        var lk = k.toLowerCase();
        if (lk.indexOf('on') === 0) return;                 // drop every event handler attr
        if (lk === 'srcdoc') return;                        // never allow an inline document (script sink)
        // every attribute that can carry a URL / navigation target is scheme-checked, not just href/src
        if (lk === 'href' || lk === 'src' || lk === 'xlink:href' ||
            lk === 'formaction' || lk === 'action' || lk === 'poster' || lk === 'background' ||
            lk === 'cite' || lk === 'data' || lk === 'ping') {
          if (!safeUrl(v)) return;                          // drop unsafe URL schemes (javascript:/data:/…)
        }
        if (lk === 'class') { node.className = String(v); return; }
        if (lk === 'text') { node.appendChild(txt(v)); return; }
        if (lk === 'dataset' && v && typeof v === 'object') {
          Object.keys(v).forEach(function (dk) { node.dataset[dk] = String(v[dk]); });
          return;
        }
        node.setAttribute(k, String(v));
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' || typeof c === 'bigint'
          ? txt(c) : c);
      });
    }
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // safe replace: clear + append (never innerHTML)
  function mount(node, children) {
    clear(node);
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c != null) node.appendChild(typeof c === 'object' ? c : txt(c));
    });
    return node;
  }

  window.TYB_RENDER = Object.freeze({
    txt: txt, el: el, clear: clear, mount: mount, safeUrl: safeUrl
  });
})();
