/* ============================================================================
   Charpe Suite — in-tool shim
   ----------------------------------------------------------------------------
   Loaded at the end of both cases.html and billing.html. It leaves the tools'
   own code completely untouched and instead adapts the few places where they
   reach for something a phone does not have:

     · the desktop "pick a folder on disk" API   → your Drive folder
     · saving a PDF to that folder               → uploaded to Drive
     · a plain download of a bill                → Android's share sheet
     · every write to storage                    → nudges the background sync

   Nothing here changes how an invoice is calculated or how a case is stored.
   ========================================================================== */
(function () {
  'use strict';

  /* The shell hands us a bridge by setting CharpeHost on this frame's own
     window — and it does that on the frame's load event, which is after our
     DOMContentLoaded. So never cache the result; look it up each time. */
  function H() {
    try {
      if (window.CharpeHost) return window.CharpeHost;
      if (window.parent && window.parent !== window && window.parent.CharpeHost) {
        return window.parent.CharpeHost;
      }
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------------ toast */

  function toast(msg, kind) {
    var h = H();
    if (h && h.toast) { h.toast(msg, kind); return; }
    console.log('[charpe]', msg);
  }

  /* ----------------------------------------------------- storage → autosync */

  (function hookStorage() {
    var raw = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      raw(k, v);
      var h = H();
      if (h && h.nudge) { try { h.nudge(); } catch (e) {} }
    };
  })();

  /* ------------------------------------------------ a Drive folder that
     looks enough like a File System Access directory handle for the billing
     tool to write into it exactly as it writes to a folder on the laptop. */

  function sync() {
    try { var h = H(); return (h && h.sync) ? h.sync : (window.CharpeSync || null); } catch (e) { return null; }
  }

  function driveReady() {
    var s = sync();
    return !!(s && s.configured());
  }

  function driveFolderName() {
    var s = sync();
    var m = s ? s.meta() : {};
    return (m && m.folder) || 'Google Drive';
  }

  function makeDir(path) {
    return {
      kind: 'directory',
      name: path.split('/').pop() || driveFolderName(),
      __path: path,
      queryPermission: function () { return Promise.resolve('granted'); },
      requestPermission: function () { return Promise.resolve('granted'); },
      getDirectoryHandle: function (name) {
        return Promise.resolve(makeDir(path ? path + '/' + name : name));
      },
      getFileHandle: function (name, opts) {
        if (opts && opts.create === false) {
          // Reading a file back out of Drive is not supported; the tool falls
          // back to re-rendering the PDF, which produces the same document.
          return Promise.reject(new DOMException('Not found', 'NotFoundError'));
        }
        return Promise.resolve(makeFile(path, name));
      },
      removeEntry: function () { return Promise.resolve(); },
      values: function () { return { [Symbol.asyncIterator]: function () { return { next: function () { return Promise.resolve({ done: true }); } }; } }; }
    };
  }

  function makeFile(dirPath, name) {
    return {
      kind: 'file',
      name: name,
      getFile: function () { return Promise.reject(new DOMException('Not found', 'NotFoundError')); },
      createWritable: function () {
        var chunks = [];
        return Promise.resolve({
          write: function (data) { chunks.push(data); return Promise.resolve(); },
          truncate: function () { return Promise.resolve(); },
          close: function () {
            var blob = new Blob(chunks);
            return blob.arrayBuffer().then(function (buf) {
              var s = sync();
              if (!s) throw new Error('Sync is not available.');
              return s.putFile(
                (dirPath ? dirPath + '/' : '') + name,
                blob.type || guessMime(name),
                new Uint8Array(buf)
              );
            });
          }
        });
      }
    };
  }

  function guessMime(name) {
    var n = String(name).toLowerCase();
    if (n.endsWith('.pdf'))  return 'application/pdf';
    if (n.endsWith('.json')) return 'application/json';
    if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (n.endsWith('.zip'))  return 'application/zip';
    if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return 'application/octet-stream';
  }

  /* ------------------------------------------------- patch the billing tool */

  function patchBilling() {
    var F = window.CB;
    if (!F) return false;

    var nativeFs = (typeof window.showDirectoryPicker === 'function');

    // The tool asks this before offering the folder buttons at all.
    try {
      Object.defineProperty(F, 'fsSupported', {
        configurable: true,
        get: function () { return nativeFs || driveReady(); }
      });
    } catch (e) { F.fsSupported = nativeFs || driveReady(); }

    if (!nativeFs) {
      F.pickFolder = function () {
        if (!driveReady()) {
          toast('Set up Drive sync first — it is under the Sync tab', 'err');
          var h = H();
          if (h && h.go) h.go('sync');
          return Promise.reject(new DOMException('No folder', 'AbortError'));
        }
        return Promise.resolve(makeDir(''));
      };
      F.getFolder = function () {
        return Promise.resolve(driveReady() ? makeDir('') : null);
      };
      F.readFile = function () { return Promise.resolve(null); };
      F.idbGet = function (k) {
        if (k === 'root')     return Promise.resolve(driveReady() ? makeDir('') : null);
        if (k === 'rootName') return Promise.resolve(driveReady() ? driveFolderName() : null);
        return Promise.resolve(null);
      };
      F.idbSet = function () { return Promise.resolve(); };
    }

    /* A bill you have just made is nearly always going somewhere — WhatsApp,
       email, the department. So rather than dropping it silently into a
       downloads folder, hand it to whatever the platform offers:

         1. the packaged Android app's own save-and-share, if we are inside it;
         2. the browser's share sheet, on a phone that has one;
         3. an ordinary download, everywhere else.
    */
    var rawDownload = F.download;
    F.download = function (name, data, mime) {
      var blob = (data instanceof Blob) ? data : new Blob([data], { type: mime || guessMime(name) });

      // 1. inside the packaged app
      if (window.AndroidBridge && typeof window.AndroidBridge.saveFile === 'function') {
        blob.arrayBuffer().then(function (buf) {
          var u8 = new Uint8Array(buf), s = '', CH = 0x8000;
          for (var i = 0; i < u8.length; i += CH) {
            s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
          }
          window.AndroidBridge.saveFile(name, blob.type || guessMime(name), btoa(s));
        }).catch(function () { rawDownload(name, blob, mime); });
        return;
      }

      // 2. the browser's share sheet
      var canShare = false;
      try {
        canShare = !!(navigator.canShare && navigator.share &&
          navigator.canShare({ files: [new File([blob], name, { type: blob.type })] }));
      } catch (e) { canShare = false; }

      if (canShare && /\.(pdf|xlsx|docx)$/i.test(name)) {
        navigator.share({
          files: [new File([blob], name, { type: blob.type })],
          title: name
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;   // you closed the sheet
          rawDownload(name, blob, mime);
        });
        return;
      }

      // 3. plain download
      rawDownload(name, blob, mime);
    };

    return true;
  }

  /* A WebView ignores window.print(). The packaged app wires it to Android's
     own print service instead, which is what reaches a real printer or makes
     a PDF. Cause lists, day boards and bills all print through this. */
  function patchPrint() {
    if (!window.AndroidBridge || typeof window.AndroidBridge.print !== 'function') return;
    window.print = function () {
      try { window.AndroidBridge.print(document.title || 'Charpe Suite'); }
      catch (e) { toast('Could not open the printer', 'err'); }
    };
  }

  /* The bill preview is a true A4 sheet — 210mm, about 794px. On a phone that
     means seeing a third of it. The tool already has zoom buttons, so on a
     narrow screen just step them down once until the sheet fits the width.
     You can zoom back in whenever you want a closer look. */
  var fitted = false;
  function fitSheet() {
    if (fitted) return;
    if (window.innerWidth > 820) return;
    var out = document.getElementById('zoom-out');
    var val = document.getElementById('zoom-val');
    var sheet = document.getElementById('sheet');
    if (!out || !val || !sheet) return;

    fitted = true;
    var room = document.documentElement.clientWidth - 24;
    for (var i = 0; i < 10; i++) {
      sheet = document.getElementById('sheet');           // re-rendered each click
      if (!sheet || sheet.getBoundingClientRect().width <= room) break;
      var before = val.textContent;
      out.click();
      if (val.textContent === before) break;              // already at the floor
    }
  }

  /* ---------------------------------------------------- mobile polish layer */

  /* Both tools were laid out for a laptop screen. Their top bars are a fixed
     52–54px tall with the section tabs sitting inside on one line; on a phone
     those tabs wrap onto three rows and spill straight through the bar below.
     Rather than editing either tool, correct the layout from here: let the bar
     grow, and turn the tabs into one strip that scrolls sideways under it. */

  var MOBILE_CSS = [
    '@media (max-width:820px){',

    /* --- keep the page inside the screen ------------------------------- */
    '  html,body{max-width:100vw;overflow-x:hidden}',
    '  body{padding-bottom:18px}',

    /* --- fields and targets sized for a finger ------------------------- */
    /* 16px is the threshold below which both Android and iOS zoom the page
       when a field takes focus. */
    '  input,select,textarea{font-size:16px !important}',
    '  button,.btn,.tab,a.btn{min-height:42px}',

    /* --- wide content scrolls in its own box, not the page ------------- */
    '  table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}',

    /* --- Case Manager top bar ------------------------------------------ */
    '  header{height:auto !important;min-height:0 !important;padding:6px 10px !important;',
    '         flex-wrap:wrap !important;row-gap:6px !important}',
    '  header .firm{font-size:12px;line-height:1.25;flex:1 1 auto;min-width:0}',
    '  header .firm small{display:none}',
    '  header .hright{flex:0 0 auto;margin-left:auto}',
    '  #navbar{order:3;flex:1 0 100%;display:flex !important;flex-wrap:nowrap !important;',
    '          overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;',
    '          gap:6px;padding-bottom:2px;scrollbar-width:none}',
    '  #navbar::-webkit-scrollbar{display:none}',
    '  #navbar button{flex:0 0 auto;white-space:nowrap}',

    /* --- Billing top bar ----------------------------------------------- */
    '  .topbar{height:auto !important;padding:6px 10px !important;gap:8px !important;',
    '          flex-wrap:wrap !important;row-gap:6px !important}',
    '  .topbar .brand{font-size:13px;flex:1 1 auto;min-width:0}',
    '  .topbar .brand small{display:none}',
    '  .topbar .brand-mark{width:22px;height:22px}',
    '  .tabs{order:3;flex:1 0 100%;margin-left:0 !important;flex-wrap:nowrap !important;',
    '        overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;',
    '        gap:4px;padding-bottom:2px;scrollbar-width:none}',
    '  .tabs::-webkit-scrollbar{display:none}',
    '  .tab{flex:0 0 auto;white-space:nowrap}',

    /* --- Billing: stop the A4 preview stretching the form --------------
       The build screen is a two-column grid, and the right column holds a
       print-accurate sheet a full 210mm wide. Collapsed to one column on a
       phone, that sheet still sets the column's minimum width, so the form
       fields beside it were being pushed off the side of the screen. Let the
       column shrink, and leave the sheet to scroll inside its own box (which
       the tool already provides) at whatever zoom you choose. */
    '  .split{grid-template-columns:minmax(0,1fr) !important}',
    '  .split > *{min-width:0}',
    '  .sheet-scroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}',

    /* --- breathing room at the edges ----------------------------------- */
    '  #wrap,.wrap,.shell,.page,main{padding-left:12px !important;padding-right:12px !important}',
    '}',

    /* Printing must come out exactly as it does on the laptop — a bill is a
       bill. None of the above applies on paper. */
    '@media print{',
    '  body{padding-bottom:0}',
    '  header,.topbar,#navbar,.tabs{display:none !important}',
    '}'
  ].join('\n');

  function injectCss() {
    var st = document.createElement('style');
    st.setAttribute('data-charpe-shim', '1');
    st.textContent = MOBILE_CSS;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------- the lock screens

     Each tool carries its own sign-in. Inside one app that means being asked
     twice on every launch, which is nobody's idea of an improvement. So:

       · while a lock screen is up, the shell's header and bottom bar get out
         of the way, so the sign-in fills the screen as it should;
       · if you have turned on automatic sign-in under More, the stored
         credentials are filled in and submitted for you.

     The tools' own sign-in code is not modified — this drives the same form a
     finger would.
  */

  function lockEl() {
    return document.getElementById('lscr')     // case manager
        || document.getElementById('lock');    // billing
  }

  function isLocked() {
    var el = lockEl();
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    // Both lock screens are position:fixed, so offsetParent is null even when
    // they are plainly on the screen — measure the box instead.
    return el.getClientRects().length > 0;
  }

  var lastLock = null;
  function reportLock() {
    var h = H();
    // The shell may not have reached us yet. Say nothing and stay un-reported
    // so the very next attempt still counts as a change worth sending.
    if (!h || !h.lockState) return;
    var now = isLocked();
    if (now === lastLock) return;
    lastLock = now;
    try { h.lockState(now); } catch (e) {}
  }

  function tick() { reportLock(); autoSignIn(); }

  function watchLock() {
    tick();
    var el = lockEl();
    if (!el) return;
    try {
      new MutationObserver(reportLock)
        .observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) {}
    setInterval(tick, 900);   // belt and braces
  }

  /* Stop after a few goes. If the saved details are wrong we must not sit there
     re-submitting the form every second — the sign-in screen is then left alone
     for you to type into. */
  var tries = 0;

  function autoSignIn() {
    var h = H();
    if (!h || !h.creds) return;
    if (!isLocked()) { tries = 0; return; }
    if (tries >= 3) return;

    var c = h.creds();
    if (!c || !c.auto) return;

    var isCases = !!document.getElementById('lscr');
    var u = isCases ? c.casesUser : c.billUser;
    var p = isCases ? c.casesPass : c.billPass;
    if (!u || !p) return;

    var uf = document.getElementById(isCases ? 'lu' : 'lg-user');
    var pf = document.getElementById(isCases ? 'lp' : 'lg-pass');
    if (!uf || !pf) return;

    tries++;
    uf.value = u; pf.value = p;
    uf.dispatchEvent(new Event('input', { bubbles: true }));
    pf.dispatchEvent(new Event('input', { bubbles: true }));

    if (isCases && typeof window.doLogin === 'function') {
      window.doLogin();
    } else {
      var form = document.getElementById('lg-form');
      var go = document.getElementById('lg-go');
      if (go) go.click();
      else if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    setTimeout(reportLock, 400);
  }

  /* --------------------------------------------------------- case → invoice */

  /* Billing exposes this so the shell can hand it a case to bill. */
  window.CharpeAcceptCase = function (c) {
    if (!c) return;
    try {
      var A = window.CBapp;
      if (!A) return;
      var title = [
        (c.caseType || '') + ' ' + (c.filingNumber || ''),
        (c.petitioners || []).join(', ') + ' v/s ' + (c.respondents || []).join(', ')
      ].join(' — ').replace(/\s+/g, ' ').trim();
      var ref = document.querySelector('#f-ref, [name=reference], #inv-ref');
      if (ref) {
        ref.value = title;
        ref.dispatchEvent(new Event('input', { bubbles: true }));
        ref.dispatchEvent(new Event('change', { bubbles: true }));
        toast('Case reference filled in');
      }
    } catch (e) {}
  };

  /* ------------------------------------------------------------------ boot */

  var booted = false;
  function boot() {
    if (booted) { tick(); return; }
    booted = true;

    injectCss();
    patchPrint();
    var isBilling = !!window.CB;
    if (isBilling) patchBilling();

    watchLock();
    setTimeout(autoSignIn, 120);
    if (isBilling) { setTimeout(fitSheet, 700); setTimeout(fitSheet, 2000); }

    /* If the shell handed us a case before this frame finished loading. */
    try {
      var stash = sessionStorage.getItem('__charpe_bill_case');
      if (stash && isBilling) {
        sessionStorage.removeItem('__charpe_bill_case');
        window.CharpeAcceptCase(JSON.parse(stash));
      }
    } catch (e) {}

    if (!H()) {
      // Opened on its own — straight from the laptop, say. Everything still
      // works; there is simply no shell around it.
      console.log('[charpe] running outside the shell');
    }
  }

  window.CharpeShimReady = boot;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  }
})();
