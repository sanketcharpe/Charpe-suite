/* ==================================================================
   CHARPE SUITE — SYNC CENTRE & SEARCH COURTS                 Oct 2026
   ------------------------------------------------------------------
   Two new pages in the case tool.

   SYNC CENTRE (all CAPTCHA fetching in one place)
     • Cases behind  — open cases whose next date has passed, cases with
       no next date, cases with orders still to download or hearings
       without their order sheet. Tick, show the CAPTCHAs, fetch.
     • One-time full sync — every case with a CNR, 20 at a time, with a
       running count; stop and resume whenever you like.
     • eCourtsIndia API — manual buttons only. Nothing runs by itself.

   SEARCH COURTS
     Find a case that is not in the tool yet — by advocate name, party
     name or case number — and add it with one click.
     District courts (eCourts) and Bombay High Court (all benches) are
     searched through your eCourts backend with one CAPTCHA.
     Supreme Court, CAT and MAT: the official search page opens, and the
     case is added by hand (orders can then be added as PDFs).
   ================================================================== */
(function () {
'use strict';
var A = function () { return (window.ECO && ECO.api) || {}; };
function cnr(c) { return String(c && c.cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hasCnr(c) { return cnr(c).length === 16; }

/* ---------------- pages and menu ---------------- */
function addPages() {
  if (document.getElementById('psync')) return;
  var wrap = document.getElementById('wrap'); if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend',
    '<div id="psync" class="page"><div class="card"><div class="ch"><span class="g">&#9878; Sync Centre &mdash; fetch from the official court sites</span></div>' +
    '<div class="cb"><div class="tabs">' +
      '<button class="tbt on" onclick="stab(this,\'scBehind\');scBehind()">Cases behind</button>' +
      '<button class="tbt" onclick="stab(this,\'scFull\');scFull()">One-time full sync</button>' +
      '<button class="tbt" onclick="stab(this,\'scApi\');scApi()">eCourtsIndia API (manual)</button></div>' +
    '<div id="scBehind" class="tp on"></div><div id="scFull" class="tp"></div><div id="scApi" class="tp"></div></div></div></div>' +
    '<div id="psearch" class="page"><div class="card"><div class="ch"><span class="g">&#128269; Search Courts &mdash; find a case that is not in the tool yet</span></div>' +
    '<div class="cb" id="srBody"></div></div></div>');
  var nav = document.getElementById('nav');
  if (nav) {
    nav.querySelector('[data-page="unupd"]').insertAdjacentHTML('afterend',
      '<button data-page="sync" onclick="go(\'sync\')">Sync Centre<span class="navbdg" id="nbSc"></span></button>' +
      '<button data-page="search" onclick="go(\'search\')">Search Courts</button>');
  }
}
var _go = window.go;
window.go = go = function (name) {
  _go.apply(this, arguments);
  if (name === 'sync') scBehind();
  if (name === 'search') srPaint();
};
var _ub = window.updBadges;
window.updBadges = updBadges = function () {
  _ub.apply(this, arguments);
  var b = document.getElementById('nbSc'); if (!b) return;
  var n = behind().length; b.textContent = n; b.style.display = n ? 'inline' : 'none';
};

/* ---------------- which cases are behind ---------------- */
function why(c) {
  var t = td(), r = [], e = c.eco || {};
  if (!c.nd) r.push('no next date');
  else if (c.nd < t) r.push('next date ' + fd(c.nd) + ' has passed');
  if (e.pending) r.push('court had not updated last time');
  var lastHear = c.nd && c.nd < t ? c.nd : (c.pd || '');
  if (e.at && lastHear && String(e.at).slice(0, 10) < lastHear) r.push('last fetched ' + fd(String(e.at).slice(0, 10)) + ', before the hearing of ' + fd(lastHear));
  if (!e.at && hasCnr(c)) r.push('never fetched');
  var ord = e.ord || {}, miss = Object.keys(ord).filter(function (k) { return !ord[k].fid && !ord[k].none; }).length;
  if (miss) r.push(miss + ' order' + (miss === 1 ? '' : 's') + ' still to download');
  var noBiz = (e.hh || []).filter(function (h) { return (h.bd || h.d) <= t && h.a && h.biz === undefined; }).length;
  if (noBiz) r.push(noBiz + ' order sheet' + (noBiz === 1 ? '' : 's') + ' still to download');
  return r;
}
function behind() { return LC().filter(function (c) { return isOpen(c) && why(c).length; }); }

var PICK = {};
window.scBehind = function () {
  var el = document.getElementById('scBehind'); if (!el) return;
  var all = behind(), withC = all.filter(hasCnr), without = all.filter(function (c) { return !hasCnr(c); });
  if (!Object.keys(PICK).length) withC.forEach(function (c) { PICK[c.id] = 1; });
  var q = ((document.getElementById('scq') || {}).value || '').toLowerCase();
  var vis = withC.filter(function (c) { return !q || (ctit(c) + ' ' + c.court + ' ' + c.cn + ' ' + cnr(c)).toLowerCase().indexOf(q) >= 0; });
  var n = withC.filter(function (c) { return PICK[c.id]; }).length;
  el.innerHTML = '<p style="font-size:11px;color:#555;margin-bottom:8px">Open cases that are not up to date: next date passed or missing, the court not updated last time, ' +
    'or orders / order sheets still to download. Tick the ones to fetch and press <b>Show CAPTCHAs</b> &mdash; up to 30 at a time.</p>' +
    '<div class="srow"><input class="sinp" id="scq" placeholder="Search within these cases…" value="' + he(q) + '" oninput="scBehind()">' +
    '<button class="btn bg" onclick="scLoad()">&#9878; Show CAPTCHAs for ' + Math.min(n, 30) + ' ticked</button>' +
    '<button class="btn bo" onclick="scTick(1)">Tick all</button><button class="btn bo" onclick="scTick(0)">Untick all</button></div>' +
    (vis.length ? vis.map(function (c) {
      var g = gMeta(c);
      return '<label style="display:flex;gap:8px;padding:6px 4px;border-bottom:1px solid #eee;font-size:11.5px;cursor:pointer"><input type="checkbox" ' + (PICK[c.id] ? 'checked' : '') + ' onchange="scPick(\'' + c.id + '\',this.checked)">' +
        '<span style="flex:1"><b style="color:' + g.c + '">' + he(ctit(c)) + '</b><br><span style="color:#666">' + he(c.court || '') + (c.cn ? ' &middot; ' + he(c.cn) : '') + ' &middot; ' + cnr(c) + '</span></span>' +
        '<span style="color:#a35b00;text-align:right;max-width:46%">' + he(why(c).join('; ')) + '</span></label>';
    }).join('') : '<div style="color:#1e8449;font-size:12px;padding:10px 4px">&#10003; Every case with a CNR is up to date.</div>') +
    (without.length ? '<div class="grpttl" style="margin-top:16px">' + without.length + ' case' + (without.length === 1 ? '' : 's') + ' behind with no CNR &mdash; add the CNR in Edit, or use Search Courts</div>' +
      without.slice(0, 200).map(function (c) {
        return '<div style="display:flex;gap:8px;padding:5px 4px;border-bottom:1px dotted #eee;font-size:11px"><span style="flex:1"><b>' + he(ctit(c)) + '</b> <span style="color:#666">' + he(c.court || '') + (c.cn ? ' &middot; ' + he(c.cn) : '') + '</span></span>' +
          '<button class="btn bn" style="font-size:9.5px;padding:2px 7px" onclick="editC(\'' + c.id + '\')">Add CNR</button></div>';
      }).join('') : '');
  var f = document.getElementById('scq'); if (f && q) { f.focus(); f.setSelectionRange(q.length, q.length); }
};
window.scPick = function (id, on) { if (on) PICK[id] = 1; else delete PICK[id]; scBehind(); };
window.scTick = function (on) { PICK = {}; if (on) behind().filter(hasCnr).forEach(function (c) { PICK[c.id] = 1; }); else PICK = { _: 0 }; scBehind(); };
window.scLoad = function () {
  var ids = behind().filter(function (c) { return hasCnr(c) && PICK[c.id]; }).map(function (c) { return c.id; });
  if (!ids.length) { toast('Tick at least one case.', 'err'); return; }
  if (ids.length > 30) toast('Showing the first 30. Come back for the rest.');
  ecoOpenBatch(ids.slice(0, 30));
};

/* ---------------- one-time full sync ---------------- */
window.scFull = function () {
  var el = document.getElementById('scFull'); if (!el) return;
  var all = LC().filter(hasCnr), done = all.filter(function (c) { return c.eco && c.eco.at; }), left = all.filter(function (c) { return !(c.eco && c.eco.at); });
  var noC = LC().filter(function (c) { return !hasCnr(c); }).length;
  var pc = all.length ? Math.round(done.length * 100 / all.length) : 0;
  el.innerHTML = '<p style="font-size:11px;color:#555;margin-bottom:10px">Brings every case up to date once: status, next date, every order and every order sheet. ' +
    'It goes 20 cases at a time so the CAPTCHA pictures do not expire; stop whenever you like and continue later from where you left off. Orders keep downloading in the background after each batch.</p>' +
    '<div style="background:#eee;border-radius:6px;height:16px;overflow:hidden;margin-bottom:6px"><div style="height:100%;width:' + pc + '%;background:#1e8449"></div></div>' +
    '<div style="font-size:12px;margin-bottom:10px"><b>' + done.length + ' of ' + all.length + '</b> cases with a CNR fetched at least once (' + pc + '%).' +
    (noC ? ' ' + noC + ' case' + (noC === 1 ? ' has' : 's have') + ' no CNR and cannot be fetched until one is added.' : '') + '</div>' +
    (left.length ? '<button class="btn bg" onclick="scNext(false)">&#9878; Next ' + Math.min(20, left.length) + ' cases not yet fetched</button> ' : '<div style="color:#1e8449;font-size:12px;margin-bottom:8px">&#10003; Every case with a CNR has been fetched once.</div>') +
    '<button class="btn bo" onclick="scNext(true)" title="Fetch again, oldest fetch first">Refresh the 20 oldest fetches</button>';
};
window.scNext = function (again) {
  var all = LC().filter(hasCnr), list;
  if (again) list = all.slice().sort(function (a, b) { return String((a.eco || {}).at || '').localeCompare(String((b.eco || {}).at || '')); });
  else list = all.filter(function (c) { return !(c.eco && c.eco.at); }).sort(function (a, b) { return isOpen(b) - isOpen(a); });
  if (!list.length) { toast('Nothing left to fetch.'); return; }
  ecoOpenBatch(list.slice(0, 20).map(function (c) { return c.id; }));
};

/* ---------------- eCourtsIndia API: manual only ---------------- */
var API = { run: false, stop: false };
window.scApi = function () {
  var el = document.getElementById('scApi'); if (!el) return;
  var cfg = cs2Cfg(), n = LC().filter(function (c) { return isOpen(c) && c.cnr; }).length;
  el.innerHTML = '<p style="font-size:11px;color:#555;margin-bottom:8px">The paid eCourtsIndia service, kept separate from the CAPTCHA fetch. ' +
    '<b>Nothing here runs by itself</b> &mdash; only when you press a button. A next date earlier than today never replaces a date you entered.</p>' +
    (cfg.url ? '' : '<div class="wbar" style="margin-bottom:8px"><span style="font-size:11px">Drive sync is not set up on this computer, so the API cannot be reached. Settings &rarr; Online sync.</span></div>') +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
    '<button class="btn bg" onclick="scApiRun(\'dates\')">&#8635; Update next dates &mdash; all ' + n + ' open cases</button>' +
    '<button class="btn bn" onclick="scApiRun(\'orders\')">&#8595; Fetch orders &mdash; all ' + n + ' open cases</button>' +
    '<button class="btn br" onclick="API.stop=true" ' + (API.run ? '' : 'disabled') + '>Stop</button></div>' +
    '<div style="font-size:11px;color:#555;margin-bottom:6px">For one case: open it and press <b>eCourtsIndia API: next date</b> or <b>eCourtsIndia API: orders</b>.</div>' +
    '<div id="scApiLog" class="nbox" style="display:' + (API.log ? 'block' : 'none') + ';max-height:220px;overflow:auto;white-space:pre-wrap;font:11px/1.5 Consolas,monospace">' + he(API.log || '') + '</div>' +
    '<details style="margin-top:10px;font-size:11px"><summary style="cursor:pointer;font-weight:600">Switch off the automatic run on Google\'s side (one time)</summary>' +
    '<ol style="margin:8px 0 0 18px;line-height:1.7">' +
    '<li>Open <b>script.google.com</b> and click the project that runs your Drive sync.</li>' +
    '<li>In the left bar click the <b>alarm-clock icon (Triggers)</b>.</li>' +
    '<li>For every row of type <b>Time-driven</b>, click the <b>three dots &rarr; Delete trigger</b>.</li>' +
    '<li>Nothing else changes: sync keeps working, and the API runs only from these buttons.</li></ol></details>';
};
window.API = API;
window.scApiRun = function (what) {
  if (API.run) return;
  var cfg = cs2Cfg(); if (!cfg.url) { toast('Set up Drive sync first.', 'err'); return; }
  var list = LC().filter(function (c) { return isOpen(c) && c.cnr; });
  if (!confirm('Ask eCourtsIndia about ' + list.length + ' open cases now?\n\nThis uses your eCourtsIndia subscription.')) return;
  API.run = true; API.stop = false; API.log = ''; scApi();
  var i = 0, ok = 0, bad = 0;
  function logl(t) { API.log = t + '\n' + API.log; var e = document.getElementById('scApiLog'); if (e) { e.style.display = 'block'; e.textContent = API.log; } }
  function next() {
    if (API.stop || i >= list.length) {
      API.run = false; logl('Finished: ' + ok + ' checked, ' + bad + ' failed' + (API.stop ? ' (stopped)' : '') + '.');
      cs2Cycle().then(function () { refresh(); scApi(); }); return;
    }
    var c = list[i++];
    cs2Post(cs2Cfg(), { action: 'fetchCase', cnr: c.cnr, what: what })
      .then(function (r) { ok++; logl(i + '/' + list.length + '  ' + ctit(c).slice(0, 50) + ' — ' + (r.msg || 'checked')); })
      .catch(function (e) { bad++; logl(i + '/' + list.length + '  ' + ctit(c).slice(0, 50) + ' — failed: ' + (e.message || e)); })
      .then(function () { setTimeout(next, 400); });
  }
  logl('Starting ' + (what === 'orders' ? 'orders' : 'next dates') + ' for ' + list.length + ' cases…');
  cs2Cycle().then(next);
};
/* the per-case buttons: two clear ones in place of the old "Fetch from court" */
window.scApiOne = function (id, what) {
  var c = find(id); if (!c || !c.cnr) return;
  var cfg = cs2Cfg(); if (!cfg.url) { toast('Set up Drive sync first.', 'err'); return; }
  toast('Asking eCourtsIndia about ' + ctit(c) + '…');
  cs2Cycle().then(function () { return cs2Post(cs2Cfg(), { action: 'fetchCase', cnr: c.cnr, what: what }); })
    .then(function (r) { toast(r.msg || 'Checked.'); return cs2Cycle(); })
    .catch(function (e) { toast('Could not check: ' + (e.message || e), 'err'); });
};
var _bld = window.bldRow;
window.bldRow = bldRow = function (c) {
  var h = _bld.apply(this, arguments);
  var old = '<button class="btn bn" onclick="event.stopPropagation();cs2FetchCase(\'' + c.id + '\')" title="Check this case on eCourtsIndia now">&#8635; Fetch from court</button>';
  if (h.indexOf(old) >= 0) h = h.replace(old,
    '<button class="btn bn" onclick="event.stopPropagation();scApiOne(\'' + c.id + '\',\'dates\')" title="Paid eCourtsIndia service — runs only when pressed">eCourtsIndia API: next date</button>' +
    '<button class="btn bn" onclick="event.stopPropagation();scApiOne(\'' + c.id + '\',\'orders\')" title="Paid eCourtsIndia service — runs only when pressed">eCourtsIndia API: orders</button>');
  return h;
};

/* ==================================================================
   SEARCH COURTS
   ================================================================== */
var COURTS = [
  { k: 'dc',  t: 'District & Sessions Court Nagpur and subordinate courts (incl. Labour, Industrial, MACT, Railway Court)', via: 'dc' },
  { k: 'hcn', t: 'Bombay High Court — Nagpur Bench', via: 'hc', bench: 'nagpur' },
  { k: 'hca', t: 'Bombay High Court — Aurangabad Bench', via: 'hc', bench: 'aurangabad' },
  { k: 'hcm', t: 'Bombay High Court — Principal Seat, Mumbai', via: 'hc', bench: 'principal' },
  { k: 'sc',  t: 'Supreme Court of India', via: 'web', url: 'https://www.sci.gov.in/case-status-case-no/', court: 'Supreme Court of India' },
  { k: 'cat', t: 'Central Administrative Tribunal, Mumbai Bench', via: 'web', url: 'https://cgat.gov.in/', court: 'Central Administrative Tribunal, Mumbai Bench (Nagpur circuit)' },
  { k: 'mat', t: 'Maharashtra Administrative Tribunal, Nagpur Bench', via: 'web', url: 'https://mat.maharashtra.gov.in/', court: 'Maharashtra Administrative Tribunal, Nagpur Bench' }
];
/* quick picks for the district court establishment list (matched against eCourts' own list) */
var EST = [
  ['', 'Any court in the district'], ['labour', 'Labour Court Nagpur'], ['industrial', 'Industrial Court Nagpur'],
  ['senior', 'Civil Judge Senior Division Nagpur'], ['junior', 'Civil Judge Junior Division Nagpur'],
  ['district|sessions', 'District and Sessions Court Nagpur'], ['motor|mact|accident', 'Motor Accident Claims Tribunal Nagpur'],
  ['railway', 'Railway Court Nagpur'], ['family', 'Family Court Nagpur'], ['co-op|cooperative', 'Co-operative Court Nagpur'], ['*', 'Other — choose from the full eCourts list']
];
var SR = { court: 'dc', mode: 'adv', sid: '', img: '', lists: null, rows: [], busy: false, dist: '', est: '' };
function opt(v, t, sel) { return '<option value="' + he(v) + '"' + (sel ? ' selected' : '') + '>' + he(t) + '</option>'; }

window.srPaint = function () {
  var el = document.getElementById('srBody'); if (!el) return;
  var C0 = COURTS.filter(function (x) { return x.k === SR.court; })[0];
  var h = '<div class="fgr">' +
    '<div class="fg f2"><label>Court</label><select id="srCourt" onchange="SR.court=this.value;SR.sid=\'\';SR.rows=[];srPaint()">' + COURTS.map(function (x) { return opt(x.k, x.t, x.k === SR.court); }).join('') + '</select></div>';
  if (C0.via === 'web') {
    h += '</div><div class="nbox" style="font-size:11.5px;line-height:1.6">The ' + he(C0.t) + ' site cannot be searched from inside the tool yet. ' +
      '<b>1.</b> <a href="' + C0.url + '" target="_blank" rel="noopener">Open the official search page</a> and find the case. ' +
      '<b>2.</b> Press <b>Add this case by hand</b> and fill in what the site shows. <b>3.</b> On the case, use <b>Orders &rarr; + Add an order PDF by hand</b> for the orders you download from the site; they then work like any other order (consolidated PDF, printing, Excerpt Desk).</div>' +
      '<button class="btn bg" onclick="srManual(\'' + C0.k + '\')">+ Add this case by hand</button>';
    el.innerHTML = h; return;
  }
  h += '<div class="fg"><label>Search by</label><select id="srMode" onchange="SR.mode=this.value;srPaint()">' +
    opt('adv', 'Advocate name', SR.mode === 'adv') + opt('party', 'Party name', SR.mode === 'party') + opt('cno', 'Case number', SR.mode === 'cno') + '</select></div>';
  if (C0.via === 'dc') {
    h += '<div class="fg"><label>Court / establishment</label><select id="srEst" onchange="SR.est=this.value;srPaint()">' + EST.map(function (x) { return opt(x[0], x[1], x[0] === SR.est); }).join('') + '</select></div>';
    if (SR.lists && (SR.est === '*' || SR.mode === 'cno')) {
      h += '<div class="fg f2"><label>Exact establishment on eCourts</label><select id="srEst2" onchange="srTypes()">' + estOptions() + '</select></div>';
    }
  }
  if (SR.mode === 'adv') h += '<div class="fg"><label>Advocate name</label><input id="srQ" value="' + he(SR.q || 'Charpe') + '"></div>';
  if (SR.mode === 'party') h += '<div class="fg"><label>Party name</label><input id="srQ" value="' + he(SR.q || '') + '"></div><div class="fg"><label>Year (optional)</label><input id="srY" value="' + he(SR.y || '') + '"></div>';
  if (SR.mode === 'cno') {
    h += '<div class="fg"><label>Case type</label><select id="srT">' + (SR.types && SR.types.length ? SR.types.map(function (x) { return opt(x.v, x.t, x.v === SR.t); }).join('') : '<option value="">(press Get CAPTCHA to load the list)</option>') + '</select></div>' +
      '<div class="fg"><label>Case number</label><input id="srN" value="' + he(SR.n || '') + '"></div><div class="fg"><label>Year</label><input id="srY" value="' + he(SR.y || '') + '"></div>';
  }
  if (SR.mode !== 'cno') h += '<div class="fg"><label>Status</label><select id="srS">' + opt('Pending', 'Pending', SR.st !== 'Disposed' && SR.st !== 'Both') + opt('Disposed', 'Disposed', SR.st === 'Disposed') + opt('Both', 'Both', SR.st === 'Both') + '</select></div>';
  h += '</div>';
  h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px">' +
    (SR.img ? '<img src="' + SR.img + '" style="height:50px;border:1px solid #ccc;border-radius:4px;cursor:pointer" title="Click for a new picture" onclick="srStart()">' +
      '<input id="srCap" class="sinp" style="max-width:150px;font:15px monospace;letter-spacing:1px" placeholder="CAPTCHA" autocomplete="off" onkeydown="if(event.key===\'Enter\')srGo()">' +
      '<button class="btn bg" onclick="srGo()">&#128269; Search</button>' : '') +
    '<button class="btn ' + (SR.img ? 'bo' : 'bg') + '" onclick="srStart()">' + (SR.img ? 'New CAPTCHA' : 'Get CAPTCHA') + '</button>' +
    '<span id="srMsg" style="font-size:11px;color:#555"></span></div><div id="srRes"></div>';
  el.innerHTML = h;
  srRows();
  var cap = document.getElementById('srCap'); if (cap) cap.focus();
};
function estOptions() {
  var L = (SR.lists && SR.lists.est) || [], re = SR.est && SR.est !== '*' ? new RegExp(SR.est, 'i') : null;
  var list = re ? L.filter(function (x) { return re.test(x.t); }) : L;
  if (!list.length) list = L;
  return list.map(function (x) { return opt(x.v, x.t, x.v === SR.estv); }).join('');
}
function readForm() {
  var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
  SR.q = g('srQ') || SR.q; SR.y = g('srY'); SR.n = g('srN'); SR.t = g('srT') || SR.t; SR.st = g('srS') || SR.st;
  var e2 = document.getElementById('srEst2'); if (e2) SR.estv = e2.value;
}
function msg(t, col) { var m = document.getElementById('srMsg'); if (m) { m.style.color = col || '#555'; m.innerHTML = t; } }
window.srStart = function () {
  readForm();
  var C0 = COURTS.filter(function (x) { return x.k === SR.court; })[0];
  msg('Opening ' + (C0.via === 'hc' ? 'the High Court site' : 'eCourts') + '…');
  A().post({ action: 'sopen', via: C0.via, bench: C0.bench || '', state: 'Maharashtra', district: 'Nagpur' }).then(function (r) {
    SR.sid = r.sid; SR.img = r.img; SR.lists = r.lists || SR.lists; SR.types = r.types || SR.types;
    srPaint(); if (r.note) msg(he(r.note), '#a35b00');
  }).catch(function (e) { msg(he(e.message), '#c0392b'); });
};
window.srGo = function () {
  readForm();
  var cap = (document.getElementById('srCap') || {}).value || '';
  if (!cap.trim()) { msg('Type the CAPTCHA first.', '#c0392b'); return; }
  var C0 = COURTS.filter(function (x) { return x.k === SR.court; })[0];
  var b = { action: 'ssearch', sid: SR.sid, via: C0.via, bench: C0.bench || '', mode: SR.mode, captcha: cap.trim(),
    q: SR.q || '', year: SR.y || '', no: SR.n || '', type: SR.t || '', status: SR.st || 'Pending', est: SR.estv || '', estRe: SR.est || '' };
  if (SR.mode === 'cno' && (!b.no || !b.year)) { msg('Give the case number and year.', '#c0392b'); return; }
  if (SR.mode !== 'cno' && b.q.length < 3) { msg('Type at least 3 letters.', '#c0392b'); return; }
  msg('Searching…'); SR.busy = true;
  A().post(b).then(function (r) {
    SR.busy = false;
    if (r.bad || r.expired) { SR.img = r.img || ''; SR.sid = r.sid || SR.sid; if (!r.img) return srStart(); srPaint(); msg(r.expired ? 'The picture expired — type the new one.' : 'Wrong CAPTCHA — type the new picture.', '#c0392b'); return; }
    SR.rows = r.rows || []; SR.img = r.img || ''; if (r.sid) SR.sid = r.sid;
    srPaint(); msg(SR.rows.length ? SR.rows.length + ' found' + (r.more ? ' (showing the first ' + SR.rows.length + ')' : '') + '.' : (r.msg ? he(r.msg) : 'Nothing found.') +
      ' <a href="#" onclick="srManual(\'' + SR.court + '\');return false">Add the case by hand</a> &mdash; you can then use &ldquo;Find on High Court&rdquo; on it later.', SR.rows.length ? '#1e8449' : '#a35b00');
  }).catch(function (e) { SR.busy = false; msg(he(e.message), '#c0392b'); });
};
window.srTypes = function () {
  readForm(); if (!SR.sid || SR.mode !== 'cno') return;
  msg('Loading case types…');
  A().post({ action: 'stypes', sid: SR.sid, est: SR.estv || '' }).then(function (r) {
    if (r.expired) { msg('The session expired — press New CAPTCHA.', '#c0392b'); return; }
    SR.types = r.types || []; srPaint(); msg(SR.types.length + ' case types loaded.');
  }).catch(function (e) { msg(he(e.message), '#c0392b'); });
};
function known(cn) { return LC().filter(function (c) { return cnr(c) === cn; })[0]; }
function srRows() {
  var el = document.getElementById('srRes'); if (!el) return;
  if (!SR.rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11.5px"><thead><tr style="background:#f0ecdf"><th style="padding:6px;text-align:left">Case</th><th style="padding:6px;text-align:left">Parties</th><th style="padding:6px;text-align:left">Court</th><th style="padding:6px"></th></tr></thead><tbody>' +
    SR.rows.map(function (r, i) {
      var have = r.cnr && known(r.cnr), twin = !have && sameNo(r);
      return '<tr style="border-bottom:1px solid #eee"><td style="padding:6px"><b>' + he(r.no || '') + '</b><br><span class="mini">' + he(r.cnr || '') + '</span></td>' +
        '<td style="padding:6px">' + he(r.pet || '') + (r.res ? ' <i>vs.</i> ' + he(r.res) : '') + (r.adv ? '<div class="mini">Adv. ' + he(r.adv) + '</div>' : '') + '</td>' +
        '<td style="padding:6px">' + he(r.court || '') + '</td><td style="padding:6px;white-space:nowrap">' +
        (have ? '<button class="btn bo" onclick="jumpCase(\'' + have.id + '\')">Already in the tool &mdash; open</button>'
              : twin ? '<button class="btn bg" onclick="srLink(' + i + ',\'' + twin.id + '\')">This is my case &ldquo;' + he(ctit(twin).slice(0, 40)) + '&rdquo; &mdash; link it</button> <button class="btn bo" onclick="srAdd(' + i + ',false)">+ Add as new</button>'
              : '<button class="btn bg" onclick="srAdd(' + i + ',false)">+ Add</button> <button class="btn bn" onclick="srAdd(' + i + ',true)">+ Add and fetch everything</button>') + '</td></tr>';
    }).join('') + '</tbody></table>';
}
/* a case already in the tool with the same number and year but no CNR yet */
function numYear(t) { var m = String(t || '').replace(/(\d)\s+(?=\d)/g, '$1').match(/(\d{1,6})\s*(?:\/|of)\s*(\d{4})/i); return m ? (+m[1]) + '/' + m[2] : ''; }
function sameNo(r) {
  var k = numYear(r.no); if (!k) return null;
  return LC().filter(function (c) { return !cnr(c) && numYear(c.cn) === k; })[0] || null;
}
window.srLink = function (i, id) {
  if (!guard('edit')) return;
  var r = SR.rows[i], c = find(id); if (!r || !c) return;
  c.cnr = r.cnr; touch(c); saveAll(); logAct('CNR ' + r.cnr + ' linked from Search Courts: ' + ctit(c)); refresh(); srRows();
  toast('CNR saved on ' + ctit(c) + '. Fetching it needs one more CAPTCHA.');
  ecoOpenBatch([c.id]);
};
window.srAdd = function (i, fetchNow) {
  if (!guard('edit')) return;
  var r = SR.rows[i]; if (!r) return;
  var C0 = COURTS.filter(function (x) { return x.k === SR.court; })[0];
  var nc = normCase({});
  Object.assign(nc, { court: r.court || (C0.via === 'hc' ? C0.t.replace(' — ', ', ') : 'Nagpur'), cn: r.no || '', cnr: r.cnr || '', pl: r.pet || '', de: r.res || '',
    st: r.disposed ? 'disposed' : 'active', added: td(), addedBy: cu ? cu.name : '' });
  touch(nc); C.push(nc); saveAll(); logAct('Added from Search Courts: ' + ctit(nc)); refresh(); srRows();
  toast('Added ' + ctit(nc) + '.');
  if (fetchNow && hasCnr(nc)) ecoOpenBatch([nc.id]);
};
window.srManual = function (k) {
  var C0 = COURTS.filter(function (x) { return x.k === k; })[0];
  openAdd(''); document.getElementById('fc').value = C0.court || C0.t.replace(' — ', ', ');
};

/* ---------------- start ---------------- */
window.SR = SR;
addPages();
})();
