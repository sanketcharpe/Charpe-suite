/* ==================================================================
   CHARPE SUITE — OFFICIAL eCOURTS FETCH                    Oct 2026
   ------------------------------------------------------------------
   • "⚖ eCourts" button in the header opens a batch screen: every case
     due for a check shows its own CAPTCHA. Type them, then press
     Fetch on one row or "Fetch all" for the lot.
   • Next date rules (never overwrite good data):
       - court date later than today, your date empty or past → taken
       - court date same as yours                              → fine
       - court date later than today but different from your
         future date                                          → flagged, you choose
       - court date today or earlier / blank                  → "court not
         updated yet", your date kept, case re-offered next time
   • Every order PDF is saved in Drive (eCourts Orders/<case>/), kept in
     this browser for instant opening, and — if you pick a folder —
     copied to the PC as a real file. Opening an order never needs a
     CAPTCHA: browser copy → PC folder → Drive.
   Settings → "Official eCourts" holds the backend address.
   ================================================================== */
(function () {
'use strict';

var ECO = { rows: [], lanes: {}, active: 0, maxLanes: 3, dir: null, db: null, savePending: null, busyAll: false };
window.ECO = ECO;

/* ---------------- config (kept in Settings, so it syncs to every device) ---------------- */
function cfg() { return (window.S && S.eco) || {}; }
function setCfg(c) { S.eco = c; saveAll(); }
function cleanCnr(x) { return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function ecoOk(c) { var n = cleanCnr(c && c.cnr); return n.length === 16 && !/^HC/.test(n); }
window.ecoOk = ecoOk;

function post(body) {
  var c = cfg();
  if (!c.url || !c.tok) return Promise.reject(new Error('Set up the eCourts backend first: Settings → Official eCourts.'));
  if (!navigator.onLine) return Promise.reject(new Error('No internet connection right now.'));
  body.token = c.tok;
  return fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
    .then(function (r) { return r.text(); })
    .then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) { throw new Error('The eCourts backend did not answer properly. Check its address in Settings.'); }
      if (!j.ok) throw new Error(j.error || 'The eCourts backend reported a problem');
      return j;
    });
}

/* ---------------- browser storage for PDFs ---------------- */
function db() {
  if (ECO.db) return ECO.db;
  ECO.db = new Promise(function (res, rej) {
    var r = indexedDB.open('charpe_eco', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('pdf'); r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
  return ECO.db;
}
function idb(store, mode, fn) {
  return db().then(function (d) {
    return new Promise(function (res, rej) {
      var tx = d.transaction(store, mode), q = fn(tx.objectStore(store));
      tx.oncomplete = function () { res(q && q.result); };
      tx.onerror = function () { rej(tx.error); };
    });
  });
}
function pdfGet(fid) { return idb('pdf', 'readonly', function (s) { return s.get(fid); }).catch(function () { return null; }); }
function pdfPut(fid, blob) { return idb('pdf', 'readwrite', function (s) { return s.put(blob, fid); }).catch(function () {}); }
function b64Blob(b64) {
  var bin = atob(b64 || ''), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'application/pdf' });
}

/* ---------------- the PC folder ---------------- */
var hasFolderApi = typeof window.showDirectoryPicker === 'function';
function dirHandle() {
  if (ECO.dir) return Promise.resolve(ECO.dir);
  return idb('kv', 'readonly', function (s) { return s.get('dir'); }).then(function (h) { ECO.dir = h || null; return ECO.dir; }).catch(function () { return null; });
}
/* ask=true only inside a click: browsers allow the permission prompt only then */
function dirReady(ask) {
  return dirHandle().then(function (h) {
    if (!h || !h.queryPermission) return null;
    return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return h;
      if (!ask) return null;
      return h.requestPermission({ mode: 'readwrite' }).then(function (p2) { return p2 === 'granted' ? h : null; });
    });
  }).catch(function () { return null; });
}
function pickFolder() {
  if (!hasFolderApi) { toast('Saving to a PC folder works in Chrome or Edge on a computer.', 'err'); return; }
  window.showDirectoryPicker({ id: 'charpe-orders', mode: 'readwrite' }).then(function (h) {
    ECO.dir = h;
    return idb('kv', 'readwrite', function (s) { return s.put(h, 'dir'); });
  }).then(function () { toast('Orders will also be saved in this folder.'); renderECS(); })
    .catch(function (e) { if (e && e.name !== 'AbortError') toast('Could not use that folder: ' + e.message, 'err'); });
}
function fsClean(s) { return String(s || '').replace(/[\\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function localWrite(h, folder, name, blob) {
  return h.getDirectoryHandle(fsClean(folder), { create: true })
    .then(function (d) { return d.getFileHandle(fsClean(name), { create: true }); })
    .then(function (f) { return f.createWritable(); })
    .then(function (w) { return w.write(blob).then(function () { return w.close(); }); })
    .then(function () { return true; }).catch(function () { return false; });
}
function localRead(h, folder, name) {
  return h.getDirectoryHandle(fsClean(folder)).then(function (d) { return d.getFileHandle(fsClean(name)); })
    .then(function (f) { return f.getFile(); }).catch(function () { return null; });
}

/* ---------------- which cases to offer ---------------- */
function dueCases() {
  var days = +(cfg().days || 0), lim = shift(td(), days);
  return LC().filter(function (c) {
    if (!isOpen(c) || !ecoOk(c)) return false;
    if (c.eco && c.eco.pending) return true;
    return !c.nd || c.nd <= lim;
  }).sort(function (a, b) { return (b.nd || '').localeCompare(a.nd || '') || ctit(a).localeCompare(ctit(b)); });
}
function label(c) { return ctit(c).slice(0, 70); }

/* ==================================================================
   THE BATCH SCREEN
   ================================================================== */
function css() {
  if (document.getElementById('ecocss')) return;
  var st = document.createElement('style'); st.id = 'ecocss';
  st.textContent =
    '#ecob{position:fixed;inset:0;background:rgba(10,18,32,.55);z-index:9990;display:flex;align-items:flex-start;justify-content:center;padding:18px 10px;overflow:auto}' +
    '#ecob .ep{background:#fff;border-radius:9px;width:min(1000px,100%);box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;max-height:calc(100vh - 36px)}' +
    '#ecob .eh{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1b2a4a;color:#fff;border-radius:9px 9px 0 0}' +
    '#ecob .eh b{flex:1;font-size:13px}' +
    '#ecob .eb{padding:10px 14px;overflow:auto;flex:1}' +
    '#ecob .ef{padding:10px 14px;border-top:1px solid #e3e6ea;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '#ecob .note{font-size:11px;color:#555;line-height:1.55;margin-bottom:8px}' +
    '#ecob .pk{display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #f0f1f3;font-size:12px;cursor:pointer}' +
    '#ecob .pk small{color:#777}' +
    '#ecob .er{display:grid;grid-template-columns:1fr 190px 120px 74px;gap:8px;align-items:center;padding:8px 6px;border-bottom:1px solid #eef0f2}' +
    '#ecob .er.done{background:#eef8f0}#ecob .er.bad{background:#fdf1f0}#ecob .er.busy{background:#f3f6fb}' +
    '#ecob .er .t{font-size:12px;font-weight:600;line-height:1.35}#ecob .er .s{font-size:10.5px;color:#666;margin-top:2px}' +
    '#ecob .er .st{grid-column:1/-1;font-size:11px;line-height:1.45;margin-top:-2px}' +
    '#ecob .er img{height:52px;max-width:190px;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fafafa}' +
    '#ecob .er input{width:100%;padding:8px;font-size:15px;letter-spacing:1px;border:1px solid #c9ced6;border-radius:5px;font-family:monospace}' +
    '#ecob .er input:focus{outline:0;border-color:#1668e3;box-shadow:0 0 0 2px rgba(22,104,227,.15)}' +
    '@media(max-width:640px){#ecob .er{grid-template-columns:1fr 1fr}#ecob .er .t,#ecob .er .tt{grid-column:1/-1}#ecob .er img{height:46px}}' +
    '.ecoord{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:3px 0;border-bottom:1px dotted #eee}';
  document.head.appendChild(st);
}
function shell(title, body, foot) {
  css();
  var o = document.getElementById('ecob'); if (o) o.remove();
  o = document.createElement('div'); o.id = 'ecob';
  o.innerHTML = '<div class="ep"><div class="eh"><b>' + title + '</b>' +
    '<button class="btn bo" style="font-size:11px" onclick="ecoClose()">&#10005; Close</button></div>' +
    '<div class="eb" id="ecobody">' + body + '</div><div class="ef" id="ecofoot">' + (foot || '') + '</div></div>';
  document.body.appendChild(o);
}
window.ecoClose = function () {
  var o = document.getElementById('ecob'); if (o) o.remove();
  if (ECO.active) toast('Orders are still downloading in the background.');
  refresh();
};

/* step 1 — choose the cases */
window.ecoOpenBatch = function (ids) {
  if (!cu) return;
  var c = cfg();
  if (!c.url || !c.tok) {
    if (can('set')) { go('sett'); setTimeout(function () { var b = document.getElementById('tbEcs'); if (b) b.click(); }, 50); }
    toast('First set up the eCourts backend: Settings → Official eCourts.', 'err'); return;
  }
  if (ids && ids.length) return loadCaptchas(ids);
  var due = dueCases(), all = LC().filter(function (x) { return ecoOk(x) && isOpen(x); });
  ECO.pick = {}; due.forEach(function (x) { ECO.pick[x.id] = 1; });
  shell('&#9878; eCourts &mdash; fetch from the official site',
    '<div class="note">Ticked below: open cases whose next date is <b>' + (+(c.days || 0) ? 'within ' + c.days + ' day(s) or earlier' : 'today or earlier') +
    '</b>, cases with no next date, and cases where the court had not updated last time. ' +
    'High Court matters are not on this site and are left out. Add any other case with the search box.</div>' +
    '<input class="sinp" id="ecoq" placeholder="Search to add another case…" oninput="ecoPickList()" style="width:100%;margin-bottom:6px">' +
    '<div id="ecopl"></div>',
    '<button class="btn bg" onclick="ecoLoad()">Show CAPTCHAs for the ticked cases</button>' +
    '<button class="btn bo" onclick="ecoAll(1)">Tick all</button><button class="btn bo" onclick="ecoAll(0)">Untick all</button>' +
    '<span id="ecocount" style="font-size:11px;color:#555;margin-left:auto"></span>');
  ECO.allCases = all; ECO.dueIds = due.map(function (x) { return x.id; });
  ecoPickList();
};
window.ecoPickList = function () {
  var q = ((document.getElementById('ecoq') || {}).value || '').toLowerCase().trim();
  var list = q ? ECO.allCases.filter(function (c) { return (ctit(c) + ' ' + (c.cn || '') + ' ' + (c.court || '') + ' ' + c.cnr).toLowerCase().indexOf(q) >= 0; }).slice(0, 60)
               : ECO.allCases.filter(function (c) { return ECO.pick[c.id]; });
  var el = document.getElementById('ecopl'); if (!el) return;
  el.innerHTML = list.length ? list.map(function (c) {
    return '<label class="pk"><input type="checkbox" ' + (ECO.pick[c.id] ? 'checked' : '') + ' onchange="ecoTick(\'' + c.id + '\',this.checked)">' +
      '<span style="flex:1"><b>' + he(label(c)) + '</b><br><small>' + he(c.court || '') + (c.cn ? ' &middot; ' + he(c.cn) : '') + ' &middot; ' + he(cleanCnr(c.cnr)) + '</small></span>' +
      '<small>' + (c.nd ? 'Next ' + fd(c.nd) : 'no date') + (c.eco && c.eco.pending ? '<br><span style="color:#a35b00">court not updated</span>' : '') + '</small></label>';
  }).join('') : '<div class="note" style="padding:14px 4px">' + (q ? 'No case with a district-court CNR matches.' : 'Nothing is due. Search above to add a case.') + '</div>';
  var n = Object.keys(ECO.pick).filter(function (k) { return ECO.pick[k]; }).length;
  var ce = document.getElementById('ecocount'); if (ce) ce.textContent = n + ' case' + (n === 1 ? '' : 's') + ' ticked';
};
window.ecoTick = function (id, on) { if (on) ECO.pick[id] = 1; else delete ECO.pick[id]; ecoPickList(); };
window.ecoAll = function (on) {
  ECO.pick = {};
  if (on) ECO.allCases.forEach(function (c) { if (ECO.dueIds.indexOf(c.id) >= 0 || (document.getElementById('ecoq') || {}).value) ECO.pick[c.id] = 1; });
  ecoPickList();
};
window.ecoLoad = function () {
  var ids = Object.keys(ECO.pick).filter(function (k) { return ECO.pick[k]; });
  if (!ids.length) { toast('Tick at least one case.', 'err'); return; }
  if (ids.length > 30) { toast('Showing the first 30. Run again for the rest.'); ids = ids.slice(0, 30); }
  loadCaptchas(ids);
};

/* step 2 — one CAPTCHA per case */
function loadCaptchas(ids) {
  dirReady(true);   /* we are inside a click: ask for the PC folder now, if one is set */
  ECO.rows = ids.map(function (id) { var c = find(id); return { cid: id, cnr: cleanCnr(c && c.cnr), st: 'load', msg: 'Opening eCourts…' }; });
  shell('&#9878; eCourts &mdash; type each CAPTCHA',
    '<div class="note">Type the characters you see for each case, pressing <b>Enter</b> to jump to the next one. ' +
    'Then press <b>Fetch all</b>, or <b>Fetch</b> on any single row. Click a picture for a new one if it is hard to read. ' +
    'Each picture stays valid for about 20 minutes.</div><div id="ecorows"></div>',
    '<button class="btn bg" id="ecoAllBtn" onclick="ecoFetchAll()">&#8635; Fetch all</button>' +
    '<button class="btn bo" onclick="ecoOpenBatch()">&#8249; Change cases</button>' +
    '<span id="ecoprog" style="font-size:11px;color:#555;margin-left:auto"></span>');
  paintRows();
  post({ action: 'start', cnrs: ECO.rows.map(function (r) { return r.cnr; }) }).then(function (res) {
    (res.rows || []).forEach(function (x, i) {
      var r = ECO.rows[i]; if (!r) return;
      r.sid = x.sid; r.img = x.img;
      if (x.err) { r.st = 'bad'; r.msg = x.err; } else { r.st = 'ready'; r.msg = ''; }
    });
    paintRows();
    var f = document.querySelector('#ecorows input'); if (f) f.focus();
  }).catch(function (e) {
    ECO.rows.forEach(function (r) { r.st = 'bad'; r.msg = e.message; });
    paintRows();
  });
}
function rowHTML(r, i) {
  var c = find(r.cid) || {};
  var cls = r.st === 'done' ? 'done' : (r.st === 'bad' || r.st === 'retype') ? 'bad' : (r.st === 'busy' || r.st === 'load') ? 'busy' : '';
  var img = r.img ? '<img src="' + r.img + '" title="Click for a new picture" onclick="ecoNewImg(' + i + ')">' :
    '<span style="font-size:11px;color:#888">' + (r.st === 'load' ? 'loading…' : '') + '</span>';
  var inp = r.st === 'done' ? '<span style="font-size:20px;color:#127a4b">&#10003;</span>' :
    '<input id="ecoin' + i + '" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8" ' +
    'value="' + he(r.cap || '') + '" oninput="ECO.rows[' + i + '].cap=this.value" onkeydown="ecoKey(event,' + i + ')"' +
    (r.st === 'busy' || r.st === 'load' ? ' disabled' : '') + '>';
  var btn = r.st === 'done' ? '<button class="btn bo" onclick="ecoAgain(' + i + ')" style="font-size:10px">Again</button>' :
    '<button class="btn bg" onclick="ecoFetchOne(' + i + ')"' + (r.st === 'busy' || r.st === 'load' ? ' disabled' : '') + '>Fetch</button>';
  var col = r.st === 'done' ? '#127a4b' : (r.st === 'bad' || r.st === 'retype') ? '#b3261e' : '#555';
  return '<div class="er ' + cls + '" id="ecor' + i + '">' +
    '<div class="tt"><div class="t">' + he(label(c)) + '</div><div class="s">' + he(c.court || '') + (c.cn ? ' &middot; ' + he(c.cn) : '') +
    ' &middot; ' + he(r.cnr) + ' &middot; your next date ' + fd(c.nd) + '</div></div>' +
    '<div>' + img + '</div><div>' + inp + '</div><div>' + btn + '</div>' +
    (r.msg ? '<div class="st" style="color:' + col + '">' + r.msg + '</div>' : '') + '</div>';
}
function paintRows() {
  var el = document.getElementById('ecorows'); if (!el) return;
  el.innerHTML = ECO.rows.map(rowHTML).join('');
  progress();
}
function paintRow(i) {
  var el = document.getElementById('ecor' + i); if (!el) return;
  var focused = document.activeElement && document.activeElement.id === 'ecoin' + i;
  var tmp = document.createElement('div'); tmp.innerHTML = rowHTML(ECO.rows[i], i);
  el.replaceWith(tmp.firstChild);
  if (focused) { var f = document.getElementById('ecoin' + i); if (f) f.focus(); }
  progress();
}
function progress() {
  var el = document.getElementById('ecoprog'); if (!el) return;
  var d = ECO.rows.filter(function (r) { return r.st === 'done'; }).length;
  var q = 0; Object.keys(ECO.lanes).forEach(function (k) { q += ECO.lanes[k].items.length; });
  el.innerHTML = d + ' of ' + ECO.rows.length + ' fetched' + (q || ECO.active ? ' &middot; downloading orders (' + q + ' left)' : '');
}
window.ecoKey = function (e, i) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { ecoFetchAll(); return; }
  for (var k = i + 1; k < ECO.rows.length; k++) {
    var f = document.getElementById('ecoin' + k);
    if (f && !f.disabled) { f.focus(); return; }
  }
  var b = document.getElementById('ecoAllBtn'); if (b) b.focus();
};
window.ecoNewImg = function (i) {
  var r = ECO.rows[i]; if (!r || r.st === 'busy') return;
  r.st = 'load'; r.msg = 'New picture…'; paintRow(i);
  post({ action: 'captcha', sid: r.sid, cnr: r.cnr }).then(function (x) {
    r.sid = x.sid; r.img = x.img; r.cap = ''; r.st = x.err ? 'bad' : 'ready'; r.msg = x.err || ''; paintRow(i);
    var f = document.getElementById('ecoin' + i); if (f) f.focus();
  }).catch(function (e) { r.st = 'bad'; r.msg = he(e.message); paintRow(i); });
};
window.ecoAgain = function (i) { var r = ECO.rows[i]; r.st = 'ready'; r.cap = ''; r.msg = ''; ecoNewImg(i); };

window.ecoFetchOne = function (i) {
  var r = ECO.rows[i];
  if (!r || r.st === 'busy' || r.st === 'done' || r.st === 'load') return Promise.resolve();
  if (!(r.cap || '').trim()) { toast('Type the CAPTCHA for this case first.', 'err'); var f = document.getElementById('ecoin' + i); if (f) f.focus(); return Promise.resolve(); }
  dirReady(true);
  r.st = 'busy'; r.msg = 'Searching eCourts…'; paintRow(i);
  return post({ action: 'search', sid: r.sid, cnr: r.cnr, captcha: r.cap.trim() }).then(function (res) {
    if (res.expired) { r.cap = ''; r.msg = 'That picture expired — type the new one.'; r.st = 'retype'; return ecoNewImg(i); }
    if (res.bad) { r.img = res.img; r.cap = ''; r.st = 'retype'; r.msg = 'Wrong CAPTCHA — type the new picture.'; paintRow(i); var f2 = document.getElementById('ecoin' + i); if (f2) f2.focus(); return; }
    if (res.notFound) { r.st = 'bad'; r.msg = 'eCourts has no case for this CNR: ' + he(res.msg || ''); paintRow(i); return; }
    var out = apply(r.cid, res.data);
    r.st = 'done'; r.msg = out.html;
    paintRow(i);
    queueCase(r.cid, r.sid, i);
  }).catch(function (e) { r.st = 'bad'; r.msg = 'Could not fetch: ' + he(e.message); paintRow(i); });
};
window.ecoFetchAll = function () {
  if (ECO.busyAll) return;
  var idx = [];
  ECO.rows.forEach(function (r, i) { if ((r.cap || '').trim() && (r.st === 'ready' || r.st === 'retype' || r.st === 'bad') && r.sid) idx.push(i); });
  if (!idx.length) { toast('Type at least one CAPTCHA first.', 'err'); return; }
  ECO.busyAll = true;
  var b = document.getElementById('ecoAllBtn'); if (b) b.disabled = true;
  var p = Promise.resolve();
  idx.forEach(function (i) { p = p.then(function () { return ecoFetchOne(i); }); });
  p.then(function () {
    ECO.busyAll = false; var b2 = document.getElementById('ecoAllBtn'); if (b2) b2.disabled = false;
    summary();
  });
};
function summary() {
  var d = ECO.rows.filter(function (r) { return r.st === 'done'; }).length,
      w = ECO.rows.filter(function (r) { return r.st === 'retype' || r.st === 'bad'; }).length;
  toast(d + ' case' + (d === 1 ? '' : 's') + ' fetched' + (w ? ' · ' + w + ' need attention (see the red rows)' : '') + '.', w ? 'err' : undefined);
}

/* ==================================================================
   APPLYING WHAT THE COURT SHOWS
   ================================================================== */
function apply(cid, d) {
  var c = find(cid); if (!c) return { html: 'Case no longer exists here.' };
  var e = c.eco = c.eco || {}, t = td(), msg = [], good = '#127a4b', warn = '#a35b00', bad = '#b3261e';
  e.at = now();
  ['status', 'stage', 'judge', 'first', 'reg', 'ctype', 'filing', 'pet', 'res', 'decision', 'disposal'].forEach(function (k) { e[k] = d[k] || ''; });
  e.next = d.next || '';

  /* hearing history: merge, keep business text already fetched */
  var hh = {}; (e.hh || []).forEach(function (h) { hh[(h.d || '') + '|' + (h.bd || '')] = h; });
  (d.hist || []).forEach(function (h) {
    var k = (h.d || '') + '|' + (h.bd || ''), o = hh[k];
    if (o) { o.p = h.p || o.p; o.j = h.j || o.j; if (h.a) o.a = h.a; }
    else hh[k] = { d: h.d, bd: h.bd, p: h.p, j: h.j, a: h.a };
  });
  e.hh = Object.keys(hh).map(function (k) { return hh[k]; })
    .sort(function (a, b) { return String(a.bd || a.d) < String(b.bd || b.d) ? -1 : 1; });

  /* orders */
  e.ord = e.ord || {};
  var nnew = 0;
  (d.orders || []).forEach(function (o) {
    var x = e.ord[o.key];
    if (!x) { e.ord[o.key] = { no: o.no, d: o.d, t: o.title, a: o.a }; nnew++; }
    else { x.a = o.a; x.d = x.d || o.d; x.no = x.no || o.no; }
  });
  var total = Object.keys(e.ord).length;

  /* next date — the safety rules */
  var nd = d.next;
  if (d.disposed && isOpen(c)) {
    e.dispFlag = true; e.pending = false; delete e.conflict;
    msg.push('<span style="color:' + warn + '">&#9888; Court shows the case as disposed' + (d.decision ? ' on ' + fd(d.decision) : '') +
      (d.disposal ? ' (' + he(d.disposal) + ')' : '') + '. Not changed here &mdash; confirm it on the case.</span>');
  } else if (nd && nd > t) {
    delete e.dispFlag; e.pending = false;
    if (c.nd === nd) { delete e.conflict; msg.push('<span style="color:' + good + '">&#10003; Next date ' + fd(nd) + ' already correct.</span>'); }
    else if (!c.nd || c.nd <= t) {
      c.hist = c.hist || [];
      c.hist.push({ dt: c.nd || t, pd: c.pd, ps: c.ps, nd: c.nd, ns: c.ns, note: 'Next date taken from eCourts: ' + fd(nd), by: 'eCourts' });
      if (c.nd) { c.pd = c.nd; c.ps = c.ns || c.ps; }
      c.nd = nd; c.ns = d.purpose || d.stage || c.ns;
      delete e.conflict;
      msg.push('<span style="color:' + good + '">&#10003; Next date set to <b>' + fd(nd) + '</b>' + (c.ns ? ' &mdash; ' + he(c.ns) : '') + '.</span>');
      if (typeof logAct === 'function') logAct('eCourts: next date ' + fd(nd) + ' for ' + ctit(c));
    } else if (e.keptFor !== nd) {
      e.conflict = nd;
      msg.push('<span style="color:' + bad + '">&#9888; Court shows ' + fd(nd) + ' but you have ' + fd(c.nd) + '. Choose on the case.</span>');
    } else msg.push('Court shows ' + fd(nd) + '; you chose to keep ' + fd(c.nd) + '.');
  } else {
    delete e.dispFlag; delete e.conflict; e.pending = true;
    msg.push('<span style="color:' + warn + '">&#9203; Court has not updated the next date yet' + (nd ? ' (still shows ' + fd(nd) + ')' : '') +
      '. Your date is kept; this case will be offered again next time.</span>');
  }
  var pend = Object.keys(e.ord).filter(function (k) { return !e.ord[k].fid; }).length;
  msg.push(total ? (nnew ? '<b>' + nnew + ' new order' + (nnew === 1 ? '' : 's') + '</b> of ' + total : total + ' order' + (total === 1 ? '' : 's') + ', none new') +
    (pend ? ' &middot; downloading ' + pend + '…' : '') : 'No orders uploaded on eCourts yet.');
  touch(c); saveAll();
  return { html: msg.join(' ') };
}

/* ==================================================================
   BACKGROUND DOWNLOADS — orders first (oldest to newest), then the
   "business on date" text. Up to three cases at a time; each case
   uses its own eCourts session, one request after another.
   ================================================================== */
function queueCase(cid, sid, row) {
  var c = find(cid); if (!c || !c.eco) return;
  var e = c.eco, items = [];
  Object.keys(e.ord || {}).map(function (k) { return [k, e.ord[k]]; })
    .filter(function (x) { return !x[1].fid && x[1].a && !x[1].none; })
    .sort(function (a, b) { return String(a[1].d || '') < String(b[1].d || '') ? -1 : 1; })
    .forEach(function (x) { items.push({ kind: 'order', key: x[0] }); });
  (e.hh || []).filter(function (h) { return h.a && h.biz === undefined; }).slice(-25)
    .forEach(function (h) { items.push({ kind: 'biz', d: h.d, bd: h.bd }); });
  if (!items.length) return;
  ECO.lanes[sid] = { cid: cid, sid: sid, row: row, items: items, done: 0, total: items.length, running: false };
  pump();
}
function pump() {
  Object.keys(ECO.lanes).forEach(function (sid) {
    var L = ECO.lanes[sid];
    if (L.running || ECO.active >= ECO.maxLanes) return;
    L.running = true; ECO.active++;
    runLane(L).then(function () { ECO.active--; delete ECO.lanes[sid]; laneDone(L); pump(); });
  });
  progress();
}
function runLane(L) {
  function next() {
    var it = L.items.shift();
    if (!it) return Promise.resolve();
    return step(L, it).then(function (stop) {
      L.done++; laneMsg(L);
      if (stop) { L.items = []; return; }
      return next();
    });
  }
  return next();
}
function step(L, it) {
  var c = find(L.cid); if (!c || !c.eco) return Promise.resolve(true);
  if (it.kind === 'order') {
    var o = c.eco.ord[it.key]; if (!o || o.fid) return Promise.resolve(false);
    return post({ action: 'order', sid: L.sid, cnr: cleanCnr(c.cnr), label: label(c), a: o.a, d: o.d, no: o.no, title: o.t, want: true })
      .then(function (r) {
        if (r.expired) return true;
        var c2 = find(L.cid), o2 = c2 && c2.eco && c2.eco.ord[it.key]; if (!o2) return false;
        if (r.missing) { o2.none = r.msg || 'not available'; touch(c2); later(); return false; }
        o2.fid = r.fid; o2.nm = r.name; o2.fo = r.folder; delete o2.none;
        touch(c2); later();
        if (r.b64) {
          var blob = b64Blob(r.b64);
          return pdfPut(r.fid, blob).then(function () {
            return dirReady(false).then(function (h) { if (h) return localWrite(h, r.folder, r.name, blob).then(function (ok) { if (ok) { o2.pc = 1; } }); });
          }).then(function () { return false; });
        }
        return false;
      }).catch(function () { return false; });
  }
  var h = (c.eco.hh || []).filter(function (x) { return x.d === it.d && x.bd === it.bd; })[0];
  if (!h || !h.a) return Promise.resolve(false);
  return post({ action: 'biz', sid: L.sid, a: h.a }).then(function (r) {
    if (r.expired) return true;
    var c2 = find(L.cid), h2 = c2 && (c2.eco.hh || []).filter(function (x) { return x.d === it.d && x.bd === it.bd; })[0];
    if (h2) { h2.biz = r.text || ''; touch(c2); later(); }
    return false;
  }).catch(function () { return false; });
}
function laneMsg(L) {
  var r = ECO.rows[L.row];
  if (r && r.cid === L.cid && r.st === 'done') {
    var el = document.querySelector('#ecor' + L.row + ' .st');
    if (el) {
      var x = el.querySelector('.ecodl'); if (!x) { x = document.createElement('span'); x.className = 'ecodl'; el.appendChild(x); }
      x.innerHTML = ' &middot; downloads ' + L.done + '/' + L.total;
    }
  }
  progress();
}
function laneDone(L) {
  var c = find(L.cid), r = ECO.rows[L.row];
  if (c && c.eco && r && r.cid === L.cid) {
    var ord = c.eco.ord || {}, keys = Object.keys(ord),
        got = keys.filter(function (k) { return ord[k].fid; }).length,
        miss = keys.filter(function (k) { return !ord[k].fid; }).length;
    var el = document.querySelector('#ecor' + L.row + ' .ecodl');
    if (el) el.innerHTML = ' &middot; <span style="color:#127a4b">' + got + ' order' + (got === 1 ? '' : 's') + ' saved in Drive' + (ECO.dir ? ' and on this PC' : '') + '</span>' +
      (miss ? ' &middot; <span style="color:#a35b00">' + miss + ' could not be downloaded now (will retry next time)</span>' : '');
  }
  saveNow();
  progress();
}
function later() { clearTimeout(ECO.savePending); ECO.savePending = setTimeout(saveNow, 2500); }
function saveNow() { clearTimeout(ECO.savePending); try { saveAll(); } catch (e) {} if (!document.getElementById('ecob')) { try { refresh(); } catch (e) {} } }

/* ==================================================================
   ON EACH CASE ROW
   ================================================================== */
window.ecoHTML = function (c) {
  var e = c.eco; if (!e || !e.at) return '';
  var id = c.id, h;
  if (e.conflict) h = '<span style="color:#c0392b;font-weight:600">&#9888; Court shows ' + fd(e.conflict) + ', saved ' + fd(c.nd) + '.</span> ' +
    '<a href="#" onclick="event.stopPropagation();ecoUseCourt(\'' + id + '\');return false">Use court date</a> &middot; ' +
    '<a href="#" onclick="event.stopPropagation();ecoKeep(\'' + id + '\');return false">Keep mine</a>';
  else if (e.dispFlag) h = '<span style="color:#d35400;font-weight:600">court shows disposed' + (e.decision ? ' on ' + fd(e.decision) : '') + '</span> ' +
    (can('edit') ? '<a href="#" onclick="event.stopPropagation();ecoDispose(\'' + id + '\');return false">Mark disposed</a>' : '');
  else if (e.pending) h = '<span style="color:#8a6d3b">&#9203; court not updated yet' + (e.next ? ' (still shows ' + fd(e.next) + ')' : '') + ' &mdash; your date kept</span>';
  else h = '<span style="color:#2e7d32">&#10003; matches the court record</span>';
  if (e.stage) h += ' &middot; stage: ' + he(e.stage);

  var ord = e.ord || {}, keys = Object.keys(ord).sort(function (a, b) { return String(ord[b].d || '') < String(ord[a].d || '') ? -1 : 1; }), ox = '';
  if (keys.length) {
    h += ' &middot; <a href="#" onclick="event.stopPropagation();togEl(\'eoo_' + id + '\');return false"><b>Orders (' + keys.length + ')</b></a>';
    ox = '<div id="eoo_' + id + '" style="display:none;margin-top:5px;border-top:1px solid #eee;padding-top:5px;max-height:280px;overflow:auto">' +
      keys.map(function (k) {
        var o = ord[k];
        var btn = o.fid ? '<button class="btn bg" style="font-size:9px;padding:2px 8px" onclick="event.stopPropagation();ecoOpenOrder(\'' + id + '\',\'' + k + '\')">Open</button>' :
          '<span style="font-size:9.5px;color:#a35b00">' + (o.none ? 'not available on eCourts' : 'will download at the next CAPTCHA') + '</span>';
        return '<div class="ecoord"><b>' + (o.d ? fd(o.d) : '(no date)') + '</b> ' + he(o.t || 'Order') + (o.no ? ' <span style="color:#888">No. ' + he(o.no) + '</span>' : '') + ' ' + btn + '</div>';
      }).join('') + '</div>';
  } else h += ' &middot; <span style="color:#888">no orders on eCourts yet</span>';

  var hh = e.hh || [], hx = '';
  if (hh.length) {
    h += ' &middot; <a href="#" onclick="event.stopPropagation();togEl(\'eoh_' + id + '\');return false">Court history (' + hh.length + ')</a>';
    hx = '<div id="eoh_' + id + '" style="display:none;margin-top:5px;border-top:1px solid #eee;padding-top:5px;max-height:280px;overflow:auto">' +
      hh.slice().reverse().map(function (x) {
        return '<div class="hiitem"><b>' + fd(x.bd || x.d) + '</b>' + (x.p ? ' &mdash; ' + he(x.p) : '') + (x.d && x.d !== x.bd ? ' &rarr; next ' + fd(x.d) : '') +
          (x.biz ? '<div style="color:#333;margin-top:2px">' + he(x.biz) + '</div>' : '') + (x.j ? '<div class="nby">' + he(x.j) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }
  return '<div style="font-size:10px;margin-top:3px;font-weight:400">Official eCourts ' + (typeof cs2Fmt === 'function' ? cs2Fmt(e.at) : '') + ': ' + h + ox + hx + '</div>';
};
window.ecoUseCourt = function (id) {
  var c = find(id); if (!c || !c.eco || !c.eco.conflict) return; if (!guard('edit')) return;
  var nd = c.eco.conflict;
  c.hist = c.hist || [];
  c.hist.push({ dt: td(), pd: c.pd, ps: c.ps, nd: c.nd, ns: c.ns, note: 'Next date changed from ' + fd(c.nd) + ' to the eCourts date ' + fd(nd), by: cu ? cu.name : '' });
  c.nd = nd; delete c.eco.conflict; delete c.eco.keptFor; touch(c); saveAll(); refresh();
  toast('Next date set to ' + fd(nd) + '.');
};
window.ecoKeep = function (id) {
  var c = find(id); if (!c || !c.eco) return; if (!guard('edit')) return;
  c.eco.keptFor = c.eco.conflict; delete c.eco.conflict; touch(c); saveAll(); refresh();
  toast('Kept your date. The same court date will not be flagged again.');
};
window.ecoDispose = function (id) {
  var c = find(id); if (!c || !c.eco) return; if (!guard('edit')) return;
  if (!confirm('Mark "' + ctit(c) + '" as disposed?')) return;
  c.hist = c.hist || [];
  c.hist.push({ dt: td(), pd: c.pd, ps: c.ps, nd: c.nd, ns: c.ns, note: 'Marked disposed as shown on eCourts' + (c.eco.decision ? ' (decided ' + fd(c.eco.decision) + ')' : ''), by: cu ? cu.name : '' });
  c.st = 'disposed'; delete c.eco.dispFlag; touch(c); saveAll(); refresh();
  toast('Marked disposed.');
};

/* open an order: this browser → PC folder → Drive. Never a CAPTCHA. */
window.ecoOpenOrder = function (id, key) {
  var c = find(id), o = c && c.eco && c.eco.ord && c.eco.ord[key]; if (!o || !o.fid) return;
  var title = he(ctit(c)) + ' &mdash; ' + (o.d ? fd(o.d) : '') + ' ' + he(o.t || 'Order');
  cs2Viewer(title, '<div style="padding:30px;text-align:center;color:#666">Opening the order&hellip;</div>');
  pdfGet(o.fid).then(function (blob) {
    if (blob) return { blob: blob, from: 'this computer' };
    return dirReady(true).then(function (h) {
      return h && o.fo && o.nm ? localRead(h, o.fo, o.nm) : null;
    }).then(function (file) {
      if (file) { pdfPut(o.fid, file); return { blob: file, from: 'your PC folder' }; }
      return post({ action: 'pdf', fid: o.fid }).then(function (r) {
        var b = b64Blob(r.b64); o.fo = o.fo || r.folder; o.nm = o.nm || r.name;
        pdfPut(o.fid, b);
        dirReady(false).then(function (h) { if (h) localWrite(h, r.folder, r.name, b); });
        return { blob: b, from: 'Google Drive' };
      });
    });
  }).then(function (x) {
    var u = URL.createObjectURL(x.blob), body = document.getElementById('cs2vbody');
    if (!body) { URL.revokeObjectURL(u); return; }
    body.innerHTML = '<iframe data-url="' + u + '" src="' + u + '" style="width:100%;height:100%;border:0"></iframe>';
    var acts = document.getElementById('cs2vacts');
    if (acts) acts.innerHTML = '<span style="font-size:10px;opacity:.75;margin-right:6px">opened from ' + x.from + '</span>' +
      '<a class="btn bg" style="font-size:11px" href="' + u + '" download="' + he(o.nm || ((o.d || 'order') + '.pdf')) + '">&#8595; Download</a>';
  }).catch(function (e) {
    var b = document.getElementById('cs2vbody'); if (b) b.innerHTML = '<div style="padding:30px;color:#c0392b">' + he(e.message || e) + '</div>';
  });
};

/* ==================================================================
   SETTINGS → OFFICIAL eCOURTS
   ================================================================== */
window.renderECS = function () {
  var el = document.getElementById('tecs'); if (!el) return;
  var c = cfg();
  dirHandle().then(function (h) {
    el.innerHTML = '<b style="font-size:12px">Official eCourts (services.ecourts.gov.in)</b>' +
      '<div style="font-size:11px;color:#666;margin:6px 0;line-height:1.55">Fetches next dates, stage, hearing history and every uploaded order straight from the official site. ' +
      'You type one CAPTCHA per case; nothing is fetched automatically. These settings are shared with your other computers and the phone through Drive sync.</div>' +
      '<div class="fg"><label>eCourts backend web address (ends in /exec)</label><input id="ecsurl" value="' + he(c.url || '') + '" placeholder="https://script.google.com/macros/s/.../exec"></div>' +
      '<div class="fgr"><div class="fg"><label>Password (the SECRET in that script)</label><input id="ecstok" type="password" value="' + he(c.tok || '') + '"></div>' +
      '<div class="fg"><label>Offer cases whose next date is</label><select id="ecsdays">' +
      [[0, 'today or earlier'], [1, 'up to tomorrow'], [2, 'within 2 days'], [3, 'within 3 days'], [7, 'within a week']].map(function (o) {
        return '<option value="' + o[0] + '"' + (+(c.days || 0) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
      '<button class="btn bg" onclick="ecoSaveCfg()">Save</button><button class="btn bn" onclick="ecoTest()">Test connection</button></div>' +
      '<div id="ecsst" style="margin-top:8px;font-size:11px;color:#444"></div>' +
      '<hr style="border:0;border-top:1px solid #eee;margin:12px 0">' +
      '<b style="font-size:12px">Copies on this computer</b>' +
      '<div style="font-size:11px;color:#666;margin:6px 0;line-height:1.55">Every order is kept in Drive and in this browser. Pick a folder to also keep real PDF files on this PC ' +
      '(one sub-folder per case). If the browser data is ever cleared, orders come back from this folder or from Drive — no CAPTCHA.</div>' +
      '<div style="font-size:11px;margin-bottom:6px">PC folder: <b>' + (h ? he(h.name) : 'not chosen') + '</b></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      (hasFolderApi ? '<button class="btn bn" onclick="ecoPickFolder()">' + (h ? 'Change folder' : 'Choose folder') + '</button>' : '<span style="font-size:11px;color:#888">(Folder copies need Chrome or Edge on a computer.)</span>') +
      (h ? '<button class="btn bo" onclick="ecoCopyAll()">Copy all saved orders to this PC</button>' : '') +
      '</div><div id="ecscp" style="margin-top:6px;font-size:11px;color:#444"></div>';
  });
};
window.ecoPickFolder = pickFolder;
window.ecoSaveCfg = function () {
  var u = val('ecsurl'), t = document.getElementById('ecstok').value, d = +document.getElementById('ecsdays').value;
  if (u && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) { toast('That address should start with https://script.google.com/macros/s/ and end with /exec', 'err'); return; }
  setCfg({ url: u, tok: t, days: d });
  toast('Saved.'); renderECS();
};
window.ecoTest = function () {
  var st = document.getElementById('ecsst'); if (st) st.innerHTML = 'Testing…';
  post({ action: 'ping' }).then(function (r) {
    if (st) st.innerHTML = '<span style="color:#127a4b">&#10003; Backend answers. Drive folder: <b>' + he(r.folder) + '</b>.</span> ' +
      (r.reachable ? '<span style="color:#127a4b">&#10003; eCourts site reachable.</span>' : '<span style="color:#b3261e">&#9888; eCourts site did not open from Google (HTTP ' + r.site + ').</span>');
  }).catch(function (e) { if (st) st.innerHTML = '<span style="color:#b3261e">' + he(e.message) + '</span>'; });
};
window.ecoCopyAll = function () {
  var out = document.getElementById('ecscp');
  dirReady(true).then(function (h) {
    if (!h) { toast('Allow access to the folder to copy the orders.', 'err'); return; }
    var list = [];
    LC().forEach(function (c) { var o = c.eco && c.eco.ord; if (o) Object.keys(o).forEach(function (k) { if (o[k].fid) list.push([c.id, k]); }); });
    var n = 0, copied = 0, p = Promise.resolve();
    list.forEach(function (x) {
      p = p.then(function () {
        var c = find(x[0]), o = c.eco.ord[x[1]]; n++;
        if (out) out.innerHTML = 'Checking ' + n + ' of ' + list.length + '…';
        var have = o.fo && o.nm ? localRead(h, o.fo, o.nm) : Promise.resolve(null);
        return have.then(function (f) {
          if (f) return;
          return pdfGet(o.fid).then(function (b) {
            if (b && o.fo && o.nm) return { blob: b, folder: o.fo, name: o.nm };
            return post({ action: 'pdf', fid: o.fid }).then(function (r) { var bb = b64Blob(r.b64); pdfPut(o.fid, bb); o.fo = r.folder; o.nm = r.name; return { blob: bb, folder: r.folder, name: r.name }; });
          }).then(function (z) { return localWrite(h, z.folder, z.name, z.blob).then(function (ok) { if (ok) copied++; }); });
        }).catch(function () {});
      });
    });
    p.then(function () { if (out) out.innerHTML = '<span style="color:#127a4b">Done. ' + copied + ' order' + (copied === 1 ? '' : 's') + ' copied; ' + (list.length - copied) + ' were already there.</span>'; saveAll(); });
  });
};

/* ---------------- hook into the existing tool ---------------- */
function install() {
  /* everything is wired in cases.html; this only guards an older copy of the page */
  if (typeof normCase === 'function' && String(normCase).indexOf('eco') < 0) {
    var nc = normCase;
    window.normCase = function (c) { var o = nc(c); if (c && c.eco) o.eco = c.eco; return o; };
  }
}
install();
})();
