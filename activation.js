/* ============================================================================
   Charpe Suite — activation lock                                     Oct 2026
   ----------------------------------------------------------------------------
   Every computer, phone or tablet must be activated once with a 16-character
   key issued from charpe-keygen.html (kept only by Adv. Sanket Charpe).

   · The device shows a MACHINE CODE such as  CS-7F3A-91C2.
   · The key is worked out from that code, so a key issued for one device
     does not open another.
   · Once accepted the device stays activated. If the browser data is cleared,
     the same machine code usually comes back and the same key works again.

   This is a lock against casual copying, not encryption: the page runs in a
   browser and its code can be read by a programmer.
   Loaded at the top of index.html, cases.html, billing.html.
   ========================================================================== */
(function () {
  'use strict';
  /* keep this exactly the same as in charpe-keygen.html */
  var PEPPER = 'RSC|SRC|Nagpur|chambers|2010-08-02|suite-key-v1';
  var KEY_ACT = 'cs_act', KEY_MID = 'cs_mid';

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function fnv(s) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519); }
    return ('00000000' + (h1 >>> 0).toString(16)).slice(-8) + ('00000000' + (h2 >>> 0).toString(16)).slice(-8);
  }
  function sha(s) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex).catch(function () { return fnv(s) + fnv(s + '#'); });
    }
    return Promise.resolve(fnv(s) + fnv(s + '#'));
  }

  /* Machine code: built from things that stay the same on one computer
     (graphics chip, processor count, memory, platform, time zone), so that
     clearing the browser normally gives the same code back. */
  function fingerprint() {
    var gl = '';
    try {
      var c = document.createElement('canvas'), g = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (g) { var d = g.getExtension('WEBGL_debug_renderer_info'); gl = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); }
    } catch (e) {}
    var n = navigator;
    return [n.platform || '', n.hardwareConcurrency || '', n.deviceMemory || '', gl,
      (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', (n.userAgentData && n.userAgentData.platform) || ''].join('|');
  }
  function machineCode() {
    var have = ls(KEY_MID);
    if (have && /^CS-[0-9A-F]{4}-[0-9A-F]{4}$/.test(have)) return Promise.resolve(have);
    return sha('mid|' + fingerprint()).then(function (h) {
      var m = 'CS-' + h.slice(0, 4).toUpperCase() + '-' + h.slice(4, 8).toUpperCase();
      ls(KEY_MID, m); return m;
    });
  }
  function keyFor(mid) {
    return sha(PEPPER + '|' + String(mid).toUpperCase()).then(function (h) {
      var k = h.slice(0, 16).toUpperCase();
      return k.slice(0, 4) + '-' + k.slice(4, 8) + '-' + k.slice(8, 12) + '-' + k.slice(12, 16);
    });
  }
  function clean(k) { var s = String(k || '').toUpperCase().replace(/[^0-9A-F]/g, ''); return s.length === 16 ? s.replace(/(.{4})(?!$)/g, '$1-') : ''; }

  /* Pages inside the app shell are already covered by the shell's own gate. */
  var inFrame = false;
  try { inFrame = window.parent && window.parent !== window && !!window.parent.CharpeActivation; } catch (e) {}

  var ready = machineCode().then(function (mid) {
    return keyFor(mid).then(function (good) { return { mid: mid, good: good, ok: clean(ls(KEY_ACT)) === good }; });
  });

  window.CharpeActivation = {
    ready: ready.then(function (r) { return r.ok; }),
    machineCode: function () { return ready.then(function (r) { return r.mid; }); }
  };

  if (inFrame) return;

  /* Hide the page straight away so nothing shows before the check finishes. */
  var hide = document.createElement('style');
  hide.id = 'cs-act-hide';
  hide.textContent = 'body>*:not(#cs-act){visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(hide);

  ready.then(function (r) {
    if (r.ok) { hide.remove(); return; }
    function show() {
      var o = document.createElement('div');
      o.id = 'cs-act';
      o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1a2744;display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.5 "Segoe UI",Roboto,Arial,sans-serif;visibility:visible';
      o.innerHTML =
        '<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:26px 26px 22px;color:#1a2744;box-shadow:0 14px 40px rgba(0,0,0,.35)">' +
        '<div style="font-size:12px;letter-spacing:.6px;color:#b8932a;font-weight:700;text-transform:uppercase">Charpe Suite</div>' +
        '<h2 style="margin:4px 0 6px;font-size:20px">Activate this device</h2>' +
        '<p style="margin:0 0 14px;color:#5b6474;font-size:13px">This copy is not yet activated. Read the machine code below to Adv. Sanket Charpe and type the key he gives you.</p>' +
        '<div style="font-size:11px;font-weight:700;color:#5b6474;text-transform:uppercase;letter-spacing:.5px">Machine code</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin:4px 0 14px"><code id="cs-act-mid" style="font:600 22px/1.2 Consolas,monospace;letter-spacing:2px;background:#f3f1ea;border:1px solid #e0d6b8;border-radius:6px;padding:8px 12px">' + r.mid + '</code>' +
        '<button id="cs-act-copy" type="button" style="border:1px solid #c9ced6;background:#fff;border-radius:6px;padding:8px 10px;cursor:pointer">Copy</button></div>' +
        '<label for="cs-act-key" style="font-size:11px;font-weight:700;color:#5b6474;text-transform:uppercase;letter-spacing:.5px">Activation key</label>' +
        '<input id="cs-act-key" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19" ' +
        'style="width:100%;box-sizing:border-box;margin:4px 0 6px;padding:11px 12px;font:600 18px Consolas,monospace;letter-spacing:2px;border:1px solid #c9ced6;border-radius:6px;text-transform:uppercase">' +
        '<div id="cs-act-msg" style="min-height:18px;font-size:12.5px;color:#b3261e"></div>' +
        '<button id="cs-act-go" type="button" style="width:100%;margin-top:6px;padding:11px;border:0;border-radius:6px;background:#b8932a;color:#1a2744;font-weight:700;font-size:14px;cursor:pointer">Activate</button>' +
        '</div>';
      document.body.appendChild(o);
      var inp = document.getElementById('cs-act-key');
      inp.addEventListener('input', function () {
        var s = inp.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 16);
        inp.value = s.replace(/(.{4})(?=.)/g, '$1-');
      });
      function go() {
        if (clean(inp.value) === r.good) {
          ls(KEY_ACT, r.good);
          o.remove(); hide.remove();
          try { location.reload(); } catch (e) {}
        } else {
          document.getElementById('cs-act-msg').textContent = 'That key does not match this machine code.';
          inp.select();
        }
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      document.getElementById('cs-act-go').onclick = go;
      document.getElementById('cs-act-copy').onclick = function () {
        try { navigator.clipboard.writeText(r.mid); this.textContent = 'Copied'; } catch (e) {}
      };
      setTimeout(function () { inp.focus(); }, 50);
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
})();
