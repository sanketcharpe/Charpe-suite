/* ============================================================================
   Charpe Suite — app shell
   ----------------------------------------------------------------------------
   Owns the bottom navigation, keeps both tools alive in same-origin iframes so
   switching tabs never loses what you were typing, and drives the sync screen.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var S = CharpeSync;
  var $ = function (id) { return document.getElementById(id); };

  var frames = { cases: $('fCases'), billing: $('fBilling') };
  var panes  = { sync: $('pSync'),   more:    $('pMore') };
  var TITLES = { cases: 'Case Manager', billing: 'Billing', sync: 'Sync', more: 'More' };
  var SRC    = { cases: 'cases.html', billing: 'billing.html' };

  var loaded  = { cases: false, billing: false };
  var current = null;

  /* ------------------------------------------------------------------ toast */

  var toastTimer;
  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'on' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, kind === 'err' ? 5200 : 2600);
  }
  window.charpeToast = toast;   // the shim inside each tool calls this

  /* ------------------------------------------------------------ navigation */

  function show(which) {
    if (current === which) {
      // Tapping the active tab again scrolls that tool back to the top.
      if (frames[which] && frames[which].contentWindow) {
        try { frames[which].contentWindow.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
      }
      return;
    }
    current = which;

    Object.keys(frames).forEach(function (k) { frames[k].classList.toggle('on', k === which); });
    Object.keys(panes).forEach(function (k)  { panes[k].classList.toggle('on', k === which); });

    document.querySelectorAll('nav button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.go === which);
    });
    $('hdrTitle').firstChild.nodeValue = TITLES[which];
    $('hdrSub').textContent = '';

    if (SRC[which] && !loaded[which]) {
      loaded[which] = true;
      frames[which].src = SRC[which];
    }
    if (which === 'sync') refreshSyncPane();
    if (which === 'more') refreshMorePane();
    applyChrome();

    try { history.replaceState(null, '', '#' + which); } catch (e) {}
  }

  document.querySelectorAll('nav button').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.go); });
  });

  /* The hardware back button should step between tabs, not close the app. */
  window.addEventListener('popstate', function () {
    var want = (location.hash || '').replace('#', '');
    if (want && want !== current && (frames[want] || panes[want])) show(want);
    else if (current !== 'cases') show('cases');
  });

  /* ---------------------------------------------------------- frame wiring */

  function bootFrames() {
    frames.cases.addEventListener('load', function () {
      $('boot').classList.add('gone');
      setTimeout(function () { $('boot').style.display = 'none'; }, 300);
      wire(frames.cases);
      // Warm the billing tool in the background so its first tap is instant.
      setTimeout(function () {
        if (!loaded.billing) { loaded.billing = true; frames.billing.src = SRC.billing; }
      }, 1200);
    });
    frames.billing.addEventListener('load', function () { wire(frames.billing); });
  }

  /* Same-origin, so we can hand each tool a small bridge object. */
  function wire(frame) {
    var w;
    try { w = frame.contentWindow; } catch (e) { return; }
    if (!w) return;
    w.CharpeHost = {
      toast: toast,
      sync: S,
      nudge: function () { S.nudge(); },
      go: show,
      /* Billing asks for this to prefill a bill from a case. */
      cases: readCases,
      /* Cases asks for this to show what has been billed. */
      invoices: function () { return readBilling().invoices || []; },
      /* A tool telling us its sign-in screen is up (or has gone away). */
      lockState: function (locked) { setLocked(frame, locked); },
      creds: readCreds,
      /* Jump to Billing with a case's details carried across. */
      billCase: function (c) {
        try { sessionStorage.setItem('__charpe_bill_case', JSON.stringify(c)); } catch (e) {}
        show('billing');
        try {
          var bw = frames.billing.contentWindow;
          if (bw && bw.CharpeAcceptCase) bw.CharpeAcceptCase(c);
        } catch (e) {}
      }
    };
    if (w.CharpeShimReady) { try { w.CharpeShimReady(); } catch (e) {} }
  }

  /* --------------------------------------------------------- lock handling */

  /* When a tool is showing its sign-in screen, the app's own header and bottom
     bar would sit on top of it looking like furniture round a locked door. Get
     them out of the way until the tool is open. */
  var lockedFrames = {};
  function setLocked(frame, locked) {
    var which = (frame === frames.cases) ? 'cases' : 'billing';
    lockedFrames[which] = !!locked;
    applyChrome();
  }
  function applyChrome() {
    var hide = !!lockedFrames[current];
    document.body.classList.toggle('locked', hide);
  }

  var CRED_KEY = '__charpe_creds';
  function readCreds() {
    try { return JSON.parse(localStorage.getItem(CRED_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function writeCreds(next) {
    localStorage.setItem(CRED_KEY, JSON.stringify(Object.assign(readCreds(), next)));
  }
  /* Credentials are a convenience, not a secret store — keep them out of the
     Drive snapshot so they never leave this device. */
  if (S.SKIP.indexOf(CRED_KEY) < 0) S.SKIP.push(CRED_KEY);

  /* ------------------------------------------------------- reading the data */

  function readCases() {
    try { return JSON.parse(localStorage.getItem('cv6_c')) || []; }
    catch (e) { return []; }
  }
  function readBilling() {
    // Prefer what the billing tool is actually holding — it only writes to
    // storage on save, so before the first save the stored copy is empty while
    // the tool is already showing the standing clients and rate card.
    try {
      var w = frames.billing.contentWindow;
      if (w && w.CBapp && w.CBapp.db) return w.CBapp.db;
    } catch (e) {}
    try { return JSON.parse(localStorage.getItem('charpe-billing-v1')) || {}; }
    catch (e) { return {}; }
  }

  function counts() {
    var b = readBilling();
    return {
      cases:    readCases().length,
      invoices: (b.invoices || []).length,
      clients:  (b.clients  || []).length
    };
  }

  /* ------------------------------------------------------------- sync pane */

  var logLines = [];
  function logit(msg, kind) {
    var t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logLines.unshift((kind === 'err' ? '✕ ' : kind === 'ok' ? '✓ ' : '· ') + t + '  ' + msg);
    logLines = logLines.slice(0, 40);
    var el = $('syncLog');
    if (el) el.textContent = logLines.join('\n');
  }

  function ago(ts) {
    if (!ts) return 'never';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function setDot(kind) {
    var d = $('syncDot');
    if (d) d.className = 'dot ' + kind;
  }

  function refreshSyncPane() {
    var c = S.cfg(), m = S.meta(), n = counts();
    $('sUrl').value  = c.url || '';
    $('sTok').value  = c.token || '';
    $('sAuto').value = c.auto ? '1' : '0';
    $('cntCases').textContent = n.cases;
    $('cntInv').textContent   = n.invoices;
    $('cntCli').textContent   = n.clients;
    $('syncWhen').textContent = ago(m.lastSync);

    var st = $('syncState');
    if (!S.configured())      { st.className = 'pill idle'; st.textContent = 'Not set up';  setDot('idle'); }
    else if (m.lastSync)      { st.className = 'pill ok';   st.textContent = 'Connected';   setDot('on');   }
    else                      { st.className = 'pill idle'; st.textContent = 'Untested';    setDot('idle'); }
  }

  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) { btn.dataset.was = btn.textContent; btn.textContent = label || 'Working…'; }
    else if (btn.dataset.was) { btn.textContent = btn.dataset.was; }
  }

  $('bSave').addEventListener('click', function () {
    var url = $('sUrl').value.trim();
    var tok = $('sTok').value.trim();
    if (url && !/^https:\/\/script\.google\.com\/.*\/exec$/.test(url)) {
      toast('That URL looks wrong — it should end in /exec', 'err');
      return;
    }
    S.setCfg({ url: url, token: tok, auto: $('sAuto').value === '1' });
    refreshSyncPane();
    toast('Saved', 'ok');
    logit('Connection settings saved.');
  });

  $('bTest').addEventListener('click', function () {
    var btn = this;
    S.setCfg({ url: $('sUrl').value.trim(), token: $('sTok').value.trim() });
    busy(btn, true, 'Testing…');
    S.ping()
      .then(function (r) {
        toast('Connected to “' + (r.folder || 'your folder') + '”', 'ok');
        logit('Reached the folder “' + (r.folder || '?') + '”.', 'ok');
        refreshSyncPane();
      })
      .catch(function (e) { toast(e.message, 'err'); logit(e.message, 'err'); setDot('off'); })
      .then(function () { busy(btn, false); });
  });

  $('bPush').addEventListener('click', function () {
    var btn = this;
    busy(btn, true, 'Sending…');
    S.push()
      .then(function (r) {
        toast('Sent up — ' + r.keys + ' records', 'ok');
        logit('Pushed ' + r.keys + ' records to Drive.', 'ok');
        setDot('on'); refreshSyncPane();
      })
      .catch(function (e) { toast(e.message, 'err'); logit(e.message, 'err'); setDot('off'); })
      .then(function () { busy(btn, false); });
  });

  $('bPull').addEventListener('click', function () {
    var btn = this;
    busy(btn, true, 'Fetching…');
    S.pull()
      .then(function (p) {
        var when = p.savedAt ? new Date(p.savedAt).toLocaleString('en-IN') : 'an unknown time';
        var from = p.device || 'another device';
        var ok = confirm(
          'The copy in Drive was saved from ' + from + ' on ' + when + '.\n\n' +
          'Pulling replaces everything currently on this phone with that copy.\n\n' +
          'Continue?'
        );
        if (!ok) { logit('Pull cancelled.'); return; }
        var n = S.applyPull(p, false);
        logit('Pulled ' + n + ' records from ' + from + '.', 'ok');
        toast('Pulled ' + n + ' records — reloading', 'ok');
        setTimeout(function () { location.reload(); }, 900);
      })
      .catch(function (e) { toast(e.message, 'err'); logit(e.message, 'err'); })
      .then(function () { busy(btn, false); });
  });

  $('bExport').addEventListener('click', function () {
    var snap = S.snapshot();
    var blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    var name = 'charpe-suite-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    logit('Exported ' + snap.keys + ' records to ' + name + '.', 'ok');
    toast('Backup saved to your downloads', 'ok');
  });

  $('bImport').addEventListener('click', function () { $('fileIn').click(); });

  $('fileIn').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var p = JSON.parse(rd.result);
        var when = p.savedAt ? new Date(p.savedAt).toLocaleString('en-IN') : 'an unknown time';
        if (!confirm('This backup was saved on ' + when + '.\n\nReplace everything on this phone with it?')) return;
        var n = S.restore(p, { merge: false });
        logit('Imported ' + n + ' records from ' + f.name + '.', 'ok');
        toast('Imported — reloading', 'ok');
        setTimeout(function () { location.reload(); }, 900);
      } catch (e) {
        toast('That file could not be read as a backup.', 'err');
        logit('Import failed: ' + e.message, 'err');
      }
    };
    rd.readAsText(f);
    ev.target.value = '';
  });

  $('btnSync').addEventListener('click', function () {
    if (!S.configured()) { show('sync'); toast('Add your connection details first'); return; }
    setDot('idle');
    S.push()
      .then(function (r) { toast('Synced — ' + r.keys + ' records', 'ok'); setDot('on'); logit('Synced from the header button.', 'ok'); })
      .catch(function (e) { toast(e.message, 'err'); setDot('off'); logit(e.message, 'err'); });
  });

  S.on(function (kind, detail) {
    if (kind === 'auto-ok')   { setDot('on');  logit('Background sync completed.', 'ok'); }
    if (kind === 'auto-fail') { setDot('off'); logit('Background sync failed: ' + detail, 'err'); }
  });

  /* ------------------------------------------------------------- more pane */

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function refreshMorePane() {
    var c = readCreds();
    $('cU').value = c.casesUser || '';
    $('cP').value = c.casesPass || '';
    $('bU').value = c.billUser  || '';
    $('bP').value = c.billPass  || '';
    $('cAuto').value = c.auto ? '1' : '0';

    $('vVer').textContent = VERSION;
    $('vSize').textContent = fmtBytes(S.usedBytes());
    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
    var inst = $('vInst');
    inst.className = 'pill ' + (standalone ? 'ok' : 'idle');
    inst.textContent = standalone ? 'yes' : 'no';
    var off = $('vOff');
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      off.className = 'pill ok'; off.textContent = 'ready';
    } else {
      off.className = 'pill idle'; off.textContent = 'not yet';
    }
  }

  $('bCreds').addEventListener('click', function () {
    var auto = $('cAuto').value === '1';
    writeCreds({
      casesUser: $('cU').value.trim(), casesPass: $('cP').value,
      billUser:  $('bU').value.trim(), billPass:  $('bP').value,
      auto: auto
    });
    toast(auto ? 'Saved — you will be signed in automatically from the next launch' : 'Saved', 'ok');
  });

  $('bWipe').addEventListener('click', function () {
    if (!confirm('This erases every case, invoice, client and setting stored on this device.\n\nAre you sure?')) return;
    if (!confirm('Last check — this cannot be undone from the phone.\n\nIf your data is in Drive you can pull it back afterwards.')) return;
    var keep = { cfg: localStorage.getItem('__charpe_sync_cfg') };
    localStorage.clear();
    if (keep.cfg) localStorage.setItem('__charpe_sync_cfg', keep.cfg);
    toast('Erased — reloading');
    setTimeout(function () { location.reload(); }, 700);
  });

  $('bUpdate').addEventListener('click', function () {
    if (!navigator.serviceWorker) { toast('Not supported in this browser', 'err'); return; }
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { toast('Nothing installed yet', 'err'); return; }
      toast('Checking…');
      reg.update().then(function () { toast('You are on the latest version', 'ok'); });
    });
  });

  /* ------------------------------------------------------ install to phone */

  var installEvent = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e;
    $('bInstall').style.display = 'inline-flex';
  });
  $('bInstall').addEventListener('click', function () {
    if (!installEvent) { toast('Use your browser menu → Install app'); return; }
    installEvent.prompt();
    installEvent.userChoice.then(function () {
      installEvent = null;
      $('bInstall').style.display = 'none';
      refreshMorePane();
    });
  });

  /* ------------------------------------------------------- service worker */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {/* http:// dev, fine */});
    });
  }

  /* Push what is on the phone before it goes to sleep, if auto-sync is on. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && S.cfg().auto && S.configured()) S.nudge();
  });

  /* -------------------------------------------------------------- kick off */

  bootFrames();
  refreshSyncPane();
  var start = (location.hash || '').replace('#', '');
  show((start && (frames[start] || panes[start])) ? start : 'cases');
  // Always bring the case tool up, even when the app opened on another tab —
  // it clears the loading screen and has everything ready for the first tap.
  if (!loaded.cases) { loaded.cases = true; frames.cases.src = SRC.cases; }
  setInterval(function () { if (current === 'sync') refreshSyncPane(); }, 20000);
})();
