/* ==================================================================
   CHARPE SUITE — OFFICE ADDITIONS (case tool)               Oct 2026
   ------------------------------------------------------------------
   • First start on a new device: no built-in username or password.
     Either connect the device to the office data in Google Drive
     (the existing accounts come down with it) or create the
     administrator for a brand-new office.
   • After every sign-in the tool opens on today's board.
   • "Update status" under any day's board: one screen with a CAPTCHA
     for every case listed that day; Fetch one or Fetch all.
   ================================================================== */
(function () {
'use strict';

/* ---------------- first start: no accounts on this device ---------------- */
function noUsers() { return !U || !U.length; }

function setupScreen() {
  var box = document.querySelector('#lscr .lbox'); if (!box) return;
  if (!noUsers()) { if (box.dataset.setup) location.reload(); return; }
  if (box.dataset.setup) return;
  box.dataset.setup = '1';
  box.style.width = '380px';
  box.innerHTML =
    '<h2 id="lfirm">' + he((S.firm && S.firm.n) || 'Adv. R.S. Charpe | Adv. S.R. Charpe') + '</h2>' +
    '<p>Legal Case Management System</p><h3>Set up this computer</h3>' +
    '<div style="text-align:left;font-size:11.5px;color:#444;line-height:1.55;margin-bottom:10px">' +
      'There are no user accounts on this computer yet.</div>' +
    '<div style="text-align:left;border:1px solid #d4c9a8;border-radius:6px;padding:10px;margin-bottom:10px">' +
      '<b style="font-size:12px">1. Connect to the office data</b>' +
      '<div style="font-size:10.5px;color:#666;margin:3px 0 7px">For a second office computer or the clerk\'s laptop. Your cases and the existing user accounts are brought down from Google Drive; then sign in with your usual account.</div>' +
      '<div class="fg"><label>Drive sync address (ends in /exec)</label><input id="suUrl" placeholder="https://script.google.com/macros/s/.../exec"></div>' +
      '<div class="fg"><label>Sync password</label><input id="suTok" type="password"></div>' +
      '<div class="fg"><label>Name of this computer</label><input id="suDev" placeholder="e.g. Clerk PC"></div>' +
      '<button class="btn bg" style="width:100%;padding:8px" onclick="ofcConnect()">Connect and bring the data down</button>' +
      '<div id="suMsg" style="font-size:11px;margin-top:6px;color:#444"></div>' +
    '</div>' +
    '<div style="text-align:left;border:1px solid #d4c9a8;border-radius:6px;padding:10px">' +
      '<b style="font-size:12px">2. Start a brand-new office</b>' +
      '<div style="font-size:10.5px;color:#666;margin:3px 0 7px">Only if this is the first computer. You become the administrator.</div>' +
      '<div class="fg"><label>Your name</label><input id="suName" value="Sanket Charpe"></div>' +
      '<div class="fg"><label>Username</label><input id="suUser" autocomplete="off"></div>' +
      '<div class="fg"><label>Password</label><input id="suPass" type="password" autocomplete="new-password"></div>' +
      '<div class="fg"><label>Password again</label><input id="suPass2" type="password" autocomplete="new-password"></div>' +
      '<button class="btn bn" style="width:100%;padding:8px" onclick="ofcCreateAdmin()">Create administrator</button>' +
    '</div>';
}
window.ofcConnect = function () {
  var u = (document.getElementById('suUrl').value || '').trim(), t = document.getElementById('suTok').value,
      d = (document.getElementById('suDev').value || '').trim() || 'This computer', m = document.getElementById('suMsg');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) { m.style.color = '#c0392b'; m.textContent = 'The address should start with https://script.google.com/macros/s/ and end with /exec'; return; }
  var c = cs2Cfg(); c.url = u; c.token = t; c.device = d; c.since = ''; cs2SetCfg(c);
  try { localStorage.removeItem('cs2_shadow'); } catch (e) {}
  m.style.color = '#444'; m.textContent = 'Bringing the data down from Drive…';
  cs2Cycle().then(function () {
    if (noUsers()) { m.style.color = '#c0392b'; m.textContent = (cs2Cfg().lastErr || 'No user accounts came down. Check the address and password.'); return; }
    m.style.color = '#1e8449'; m.textContent = 'Done. Opening the sign-in screen…';
    setTimeout(function () { location.reload(); }, 800);
  });
};
window.ofcCreateAdmin = function () {
  var n = (document.getElementById('suName').value || '').trim(), u = (document.getElementById('suUser').value || '').trim(),
      p = document.getElementById('suPass').value, p2 = document.getElementById('suPass2').value;
  if (!u || !p) { toast('Choose a username and a password.', 'err'); return; }
  if (p.length < 6) { toast('Use at least 6 characters for the password.', 'err'); return; }
  if (p !== p2) { toast('The two passwords do not match.', 'err'); return; }
  if (!noUsers()) { location.reload(); return; }
  hashPw(u, p).then(function (h) {
    U = [{ id: 'admin', name: n || u, username: u, ph: h, role: 'admin' }];
    saveU();
    toast('Administrator created. Sign in now.');
    setTimeout(function () { location.reload(); }, 700);
  });
};

/* ---------------- sign-in always lands on today's board ---------------- */
var _init = window.initApp;
window.initApp = initApp = function () {
  _init.apply(this, arguments);
  try { go('dash'); } catch (e) {}
};

/* ---------------- Update status under each board ---------------- */
function cnrOf(c) { return String(c && c.cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function fetchable(c) { return typeof ecoOk === 'function' ? ecoOk(c) : cnrOf(c).length === 16; }
function tribunal(c) { return !!(window.trKind && trKind(c)); }

window.ofcUpdateStatus = function (iso) {
  if (!cu) return;
  var rows = boardOn(iso).filter(function (x) { return x.cur && isOpen(x.c); });
  if (!rows.length) { toast('No open matters are listed on ' + fd(iso) + '.', 'err'); return; }
  var ok = rows.filter(function (x) { return fetchable(x.c); }).map(function (x) { return x.c.id; });
  var tri = rows.filter(function (x) { return tribunal(x.c); }).map(function (x) { return x.c; });
  var no = rows.filter(function (x) { return !fetchable(x.c) && !tribunal(x.c); }).map(function (x) { return x.c; });
  /* Supreme Court, CAT and MAT need no CAPTCHA — they are fetched straight away in the background */
  if (tri.length && typeof trUpdate === 'function') trUpdate(tri);
  if (!ok.length && tri.length) return;
  if (!ok.length) {
    toast('None of the ' + rows.length + ' matters on this board has a CNR number yet. Add the CNR in Edit, or find the case in Search Courts.', 'err');
    return;
  }
  ECO.skipped = no;
  ecoOpenBatch(ok);
};
function statusBar(iso) {
  var rows = boardOn(iso).filter(function (x) { return x.cur && isOpen(x.c); });
  if (!rows.length) return '';
  var n = rows.filter(function (x) { return fetchable(x.c); }).length, t = rows.filter(function (x) { return tribunal(x.c); }).length;
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px;padding:9px 11px;background:#f4f8ff;border:1px solid #b9cdee;border-radius:6px">' +
    '<button class="btn bn" style="font-size:12px;padding:7px 16px" onclick="ofcUpdateStatus(\'' + iso + '\')">&#8635; Update status</button>' +
    '<span style="font-size:11px;color:#333">One CAPTCHA per case, then <b>Fetch all</b>. ' + n + ' of ' + rows.length + ' matter' + (rows.length === 1 ? '' : 's') +
    ' on this board ' + (n === 1 ? 'has' : 'have') + ' a CNR' + (t ? '; ' + t + ' Supreme Court / CAT / MAT matter' + (t === 1 ? ' is' : 's are') + ' fetched without a CAPTCHA' : '') +
    (n + t < rows.length ? ' &mdash; the rest need a CNR added (Edit) first' : '') + '.</span></div>';
}
var _rd = window.renderDash;
window.renderDash = renderDash = function () {
  _rd.apply(this, arguments);
  var el = document.getElementById('todlist');
  if (el) el.insertAdjacentHTML('beforeend', statusBar(td()));
  var hero = document.querySelector('#pdash .hero');
  if (hero && !document.getElementById('ofcSync')) {
    hero.insertAdjacentHTML('beforeend', '<div id="ofcSync" style="display:flex;gap:5px;flex-wrap:wrap">' +
      '<button class="btn bg" onclick="go(\'sync\')" title="CAPTCHA fetch for every case that is behind">&#9878; Sync Centre</button>' +
      '<button class="btn bo" style="background:transparent;color:#fff;border-color:#e8c96a" onclick="go(\'search\')">&#128269; Search Courts</button></div>');
  }
};
var _bdp = window.buildDayPanel;
window.buildDayPanel = buildDayPanel = function (iso, containerId, pfx) {
  _bdp.apply(this, arguments);
  var el = document.querySelector('#' + containerId + ' .daylist-body');
  if (el) el.insertAdjacentHTML('beforeend', statusBar(iso));
};

/* ---------------- start ---------------- */
function start() {
  setupScreen();
  /* the Drive pull may bring accounts down after the page opened */
  setInterval(function () { if (!cu) setupScreen(); }, 3000);
  if (cu) try { renderDash(); } catch (e) {}
}
if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
