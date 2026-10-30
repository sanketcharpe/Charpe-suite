/* ==================================================================
   CHARPE SUITE — SUPREME COURT, CAT AND MAT NAGPUR          Oct 2026
   ------------------------------------------------------------------
   None of these three needs a CAPTCHA. Everything goes through your
   eCourts backend (Apps Script), like the district and High Court fetch.

   SUPREME COURT  by diary number (from the CNR SCIN…, or "Diary No.
                  38471/2025" in the case number, or asked once).
                  Status, last and tentative next listing, listing
                  history, every order (ROP) and judgment PDF.
   CAT            Mumbai Bench incl. Nagpur circuit, by case type,
                  number and year from the case number (O.A. 297/2026).
                  Case details, proceedings, daily and final orders.
   MAT NAGPUR     The Tribunal publishes only its judgments, in one
                  list. "Check MAT Nagpur" reads that list once, finds
                  every judgment in your MAT cases by O.A. number and
                  year (grouped O.A.s included), and flags any judgment
                  that names you as advocate but is not in the tool.

   Where:  a button on each such case · Update Status on the board
           (fetched straight away, no CAPTCHA) · Sync Centre → new tab
           "Supreme Court · CAT · MAT" · Search Courts.
   The next-date safety rules of the eCourts fetch apply unchanged.
   ================================================================== */
(function () {
'use strict';
function api() { return (window.ECO && ECO.api) || {}; }
var TR = { busy: {}, log: [], mat: null, matAt: '', review: [], mine: [] };

/* ---------------- the PC helper (Supreme Court and MAT) ----------------
   The Supreme Court's firewall turns away Google's servers and the MAT site
   cannot be reached from them, so these go through "Charpe Helper" on this PC
   (127.0.0.1:8770), which fetches from the office's own internet connection.
   Everything else — CAT, eCourts, Drive — stays with the Google backend.        */
var HELPER = 'http://127.0.0.1:8770/', VIA_HELPER = { sci: 1, scopen: 1, scsearch: 1, mat: 1, matdays: 1, matpdf: 1, pdf: 1 };
TR.helper = null;                 /* null = not checked yet, true/false after a check */
function helperPost(body) {
  var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, body.action === 'ping' ? (body.ms || 4000) : 180000) : 0;
  return fetch(HELPER, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(t); return r.json(); })
    .then(function (j) { if (!j.ok) throw new Error(j.error || 'The PC helper reported a problem'); return j; });
}
function helperCheck() {
  var ping = function (ms) { return helperPost({ action: 'ping', ms: ms }).then(function (j) { TR.helper = true; TR.helperV = j.helper; try { localStorage.setItem('cs_helper_pc', '1'); } catch (e) {} return true; }); };
  /* ask twice before deciding the helper is not there (a busy PC can be slow once) */
  return ping(4000).catch(function () { return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return ping(7000); }); })
    .catch(function () { TR.helper = false; return false; });
}
function helperPC() { try { return localStorage.getItem('cs_helper_pc') === '1'; } catch (e) { return false; } }
var NOHELP_T = 'Charpe Helper on this PC is not answering, so nothing was sent anywhere. Open 127.0.0.1:8770 in Chrome to check it is running (or restart the PC), then try again.';
window.trHelperCheck = function () { return helperCheck().then(function (ok) { toast(ok ? 'Charpe Helper is running on this PC.' : 'Charpe Helper is not running on this PC.', ok ? '' : 'err'); if (document.getElementById('scTri')) scTri(); }); };
var HELP_MSG = 'Start Charpe Helper on this PC (it fetches the Supreme Court and MAT sites from your own connection) — see Sync Centre → Supreme Court · CAT · MAT.';
function tpost(body) {
  if (!VIA_HELPER[body.action]) return api().post(body);
  var ready = TR.helper === null ? helperCheck() : Promise.resolve(TR.helper);
  return ready.then(function (ok) {
    if (ok) return helperPost(body).catch(function (e) {
      if (/Failed to fetch|NetworkError|aborted/i.test(e.message || '')) { TR.helper = false; throw new Error('Charpe Helper stopped answering. ' + HELP_MSG); }
      throw e;
    });
    if (helperPC()) throw new Error(NOHELP_T);
    return api().post(body).catch(function (e) { throw new Error((e.message || e) + ' — ' + HELP_MSG); });
  });
}
/* order PDFs from the Supreme Court / MAT: fetched by the helper, then kept in Drive through the backend */
window.trOrderPost = function (c, o, b) {
  /* High Court orders: fetched with the helper session that opened the case — from Search Courts (H:) or from
     the eCourts CAPTCHA screen (P:). Before 30 Oct 2026 the P: ones were sent the wrong way and all failed. */
  var hcLane = o && o.a && o.a[0] === 'HC' && /^[HP]:/.test(String(b.sid || ''));
  if (!o || !o.a || (!hcLane && ((o.a[0] !== 'SCI' && o.a[0] !== 'MAT') || TR.helper !== true))) return null;
  return helperPost(hcLane ? { action: 'hcpdf', sid: String(b.sid).slice(2), url: o.a[1] } : { action: 'pdf', url: o.a[1] }).then(function (r) {
    if (r.missing || !r.b64) return { ok: true, missing: true, msg: r.msg || 'not available' };
    return api().post({ action: 'upload', cnr: b.cnr, label: b.label, name: ((b.d || 'undated') + ' ' + (b.title || 'Order') + (b.no ? ' No ' + b.no : '')).slice(0, 120), b64: r.b64 })
      .then(function (x) { x.b64 = r.b64; return x; });
  }).catch(function (e) {
    var down = /Failed to fetch|NetworkError|aborted/i.test((e && e.message) || '');
    if (down) TR.helper = false;
    return { ok: true, missing: true, msg: down ? 'Charpe Helper not answering' : ((e && e.message) || 'could not be fetched') };
  });
};
window.TR = TR;
var COURT = { sc: 'Supreme Court of India', cat: 'Central Administrative Tribunal, Mumbai Bench (Nagpur circuit)', mat: 'Maharashtra Administrative Tribunal, Nagpur Bench' };
var NAME = { sc: 'Supreme Court', cat: 'CAT', mat: 'MAT Nagpur' };

/* ---------------- which court ---------------- */
function kind(c) {
  var t = ' ' + String(c && c.court || '') + ' ';
  if (/supreme\s*court|\bS\.?C\.?I\b/i.test(t)) return 'sc';
  if (/central\s+administrative|\bC\.\s*A\.\s*T\b|\bCAT\b/i.test(t)) return 'cat';
  if (/maharashtra\s+administrative|\bM\.\s*A\.\s*T\b|\bMAT\b/i.test(t)) return 'mat';
  return '';
}
window.trKind = kind;
function clean(s) { return String(s == null ? '' : s).replace(/[ ​-‍﻿]/g, ' ').replace(/\s+/g, ' ').trim(); }
function yr(y) { y = parseInt(y, 10); return y < 100 ? y + 2000 : y; }
function hash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return 'x' + h.toString(16); }

/* ---------------- case numbers ----------------
   "O.A. Nos. 707, 708 & 709/2026", "O.As.1042,1043 and 1046 of 2023",
   "Rev. A. 04 of 2023 in O.A. 126 of 2017", "Original Application No. 477/2023"
   -> [{type:'OA', no:707, year:2026, key:'OA 707/2026'}, …]               */
function caseRefs(text) {
  var t = ' ' + clean(text).toUpperCase().replace(/\bORIGINAL\s+APPLICATIONS?\b/g, 'OA').replace(/\bCIVIL\s+APPLICATIONS?\b/g, 'CA')
    .replace(/\bMISC(?:ELLANEOUS)?\.?\s+APPLICATIONS?\b/g, 'MA').replace(/\bCONTEMPT\s+PETITIONS?\b/g, 'CP')
    .replace(/\bREVIEW\s+APPLICATIONS?\b/g, 'RA').replace(/\bTRANSFER\s+APPLICATIONS?\b/g, 'TA').replace(/\bNOS?\b\.?/g, ' ') + ' ';
  if (!/[A-Z]/.test(t.replace(/\b(OF|AND|WITH|IN)\b/g, ''))) t = ' OA ' + t;
  var mk = /(?:^|[^A-Z])(O\s*\.?\s*A\s*\.?\s*S?|C\s*\.?\s*A|M\s*\.?\s*A|REV(?:IEW)?\s*\.?\s*(?:A(?:PPL(?:ICATION|N)?)?)?|R\s*\.?\s*A|T\s*\.?\s*A|P\s*\.?\s*T|CR\s*\.?\s*C\s*\.?\s*P|C\s*\.?\s*P)(?=[^A-Z]|$)/g;
  var marks = [], m, out = [], seen = {};
  while ((m = mk.exec(t))) marks.push({ type: m[1], at: m.index + m[0].length });
  marks.forEach(function (mark, i) {
    var type = mark.type.replace(/[\s.]/g, '');
    type = /^REV|^RA/.test(type) ? 'RA' : /^CRCP/.test(type) ? 'CCP' : type.replace(/^OAS$/, 'OA');
    var seg = t.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at - marks[i + 1].type.length - 1 : t.length);
    var toks = [], tr = /(\d{1,5})(?:\s*(?:\/|OF|-)\s*(\d{4}|\d{2})(?!\d)|[.\s](\d{4})(?!\d))?/g, q;
    while ((q = tr.exec(seg))) toks.push({ n: +q[1], y: (q[2] || q[3]) ? yr(q[2] || q[3]) : null });
    toks.forEach(function (k, j) {
      if (k.y) return;
      for (var x = j + 1; x < toks.length; x++) if (toks[x].y) { k.y = toks[x].y; return; }
      for (x = j - 1; x >= 0; x--) if (toks[x].y) { k.y = toks[x].y; return; }
    });
    toks.forEach(function (k) {
      if (!k.n || !k.y || k.y < 1985 || k.y > 2100) return;
      var key = type + ' ' + k.n + '/' + k.y;
      if (!seen[key]) { seen[key] = 1; out.push({ type: type, no: k.n, year: k.y, key: key }); }
    });
  });
  return out;
}
window.trCaseRefs = caseRefs;
function isoOf(s) {
  s = clean(s); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/(\d{1,2})\s*[.\/-]+\s*(\d{1,2})\s*[.\/-]+\s*(\d{2,4})/);
  return m ? yr(m[3]) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

/* Supreme Court diary number: CNR SCIN01 + 6 digits + year, "Diary No. 38471/2025" in the case number, or asked once */
function scDiary(c, ask) {
  var n = String(c.cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), m = n.match(/^SCIN\d{2}(\d{6})(\d{4})$/);
  if (m) return (+m[1]) + '/' + m[2];
  m = String(c.cn || '').match(/d(?:iary|\.)\s*(?:no\.?)?\s*[:\-]?\s*(\d{1,7})\s*(?:\/|of|-)\s*(\d{4})/i);
  if (m) return (+m[1]) + '/' + m[2];
  if (c.eco && c.eco.diary) return c.eco.diary;
  if (!ask) return '';
  var v = window.prompt('Supreme Court diary number for\n' + ctit(c) + '\n\nType it as 38471/2025 (it is on every Supreme Court listing).', '');
  m = String(v || '').match(/(\d{1,7})\s*(?:\/|of|-)\s*(\d{4})/i);
  if (!m) return '';
  c.cnr = 'SCIN01' + ('000000' + (+m[1])).slice(-6) + m[2];   /* the Supreme Court CNR carries the diary number */
  touch(c); saveAll();
  return (+m[1]) + '/' + m[2];
}
/* Supreme Court case number → the site's case-type code. Plain "SLP" is taken as civil (you can change it in the CAPTCHA box). */
var SCT = [['1', 'SLP (Civil)', /S\.?\s*L\.?\s*P\.?\s*\(?\s*C(?:IVIL)?\b/], ['2', 'SLP (Criminal)', /S\.?\s*L\.?\s*P\.?\s*\(?\s*CR(?:L|I|IMINAL)?\b/],
  ['3', 'Civil Appeal', /C(?:IVIL)?\.?\s*A(?:PPEAL|\.)/], ['4', 'Criminal Appeal', /CR(?:L|I|IMINAL)?\.?\s*A(?:PPEAL|\.)/],
  ['5', 'Writ Petition (Civil)', /W\.?\s*P\.?\s*\(?\s*C(?:IVIL)?\b/], ['6', 'Writ Petition (Criminal)', /W\.?\s*P\.?\s*\(?\s*CR/],
  ['7', 'Transfer Petition (Civil)', /T\.?\s*P\.?\s*\(?\s*C(?:IVIL)?\b/], ['8', 'Transfer Petition (Criminal)', /T\.?\s*P\.?\s*\(?\s*CR/],
  ['9', 'Review Petition (Civil)', /R(?:EVIEW)?\.?\s*P(?:ETITION|\.)?\s*\(?\s*C(?:IVIL)?\b/], ['10', 'Review Petition (Criminal)', /R(?:EVIEW)?\.?\s*P(?:ETITION|\.)?\s*\(?\s*CR/],
  ['19', 'Contempt Petition (Civil)', /CONT(?:EMPT)?\.?\s*P(?:ETITION|\.)?\s*\(?\s*C(?:IVIL)?\b/], ['20', 'Contempt Petition (Criminal)', /CONT(?:EMPT)?\.?\s*P(?:ETITION|\.)?\s*\(?\s*CR/],
  ['25', 'Curative Petition (Civil)', /CURATIVE.*C(?:IVIL)?\b/], ['39', 'Miscellaneous Application', /M(?:ISC(?:ELLANEOUS)?)?\.?\s*A(?:PPLICATION|\.)/],
  ['1', 'SLP (Civil)', /S\.?\s*L\.?\s*P\b|SPECIAL\s+LEAVE/]];
window.TR_SCT = SCT;
function scCaseNo(text) {
  var t = clean(text).toUpperCase().replace(/SPECIAL\s+LEAVE\s+PETITION/g, 'SLP').replace(/CRIMINAL/g, 'CRL').replace(/\bCRI\b/g, 'CRL');
  var n = t.match(/(\d{1,6})\s*(?:-\s*)?(?:\/|OF)\s*(\d{4})/); if (!n) return null;
  for (var i = 0; i < SCT.length; i++) if (SCT[i][2].test(t)) return { type: SCT[i][0], label: SCT[i][1], no: String(+n[1]), year: n[2] };
  return null;
}
window.trScCaseNo = scCaseNo;
function catRef(c) {
  var r = caseRefs(c.cn || '').filter(function (x) { return /^(OA|MA|CP|RA|TA|PT|CCP)$/.test(x.type); });
  return r[0] || null;
}

/* ---------------- fetch one Supreme Court / CAT case ---------------- */
function fetchOne(id, quiet) {
  var c = find(id); if (!c) return Promise.resolve({ ok: false, msg: 'Case not found' });
  var k = kind(c), body;
  if (k === 'sc') {
    var dn = scDiary(c, false);
    if (!dn && !quiet && scCaseNo(c.cn)) { scCaptcha(id); return Promise.resolve({ ok: true, msg: 'One CAPTCHA to find the diary number — see the box.' }); }
    if (!dn) dn = scDiary(c, !quiet);
    if (!dn) return Promise.resolve({ ok: false, msg: scCaseNo(c.cn) ? 'Needs one CAPTCHA the first time — press Fetch on the case.' : 'No diary number — add it as CNR (SCIN…) or "Diary No. 38471/2025", or the case number as SLP(C) 1234/2026.' });
    body = { action: 'sci', diary: dn, cnr: c.cnr };
  } else if (k === 'cat') {
    var r = catRef(c);
    if (!r) return Promise.resolve({ ok: false, msg: 'The case number should read like O.A. 297/2026 (or M.A., C.P., R.A., T.A.).' });
    body = { action: 'cat', type: r.type, no: r.no, year: r.year, party: c.pl || '' };
  } else return Promise.resolve({ ok: false, msg: 'Not a Supreme Court or CAT case' });
  if (TR.busy[id]) return Promise.resolve({ ok: false, msg: 'Already fetching' });
  TR.busy[id] = 1;
  return tpost(body).then(function (res) {
    delete TR.busy[id];
    if (res.notFound) return { ok: false, msg: res.msg || 'Not found on the court site' };
    var d = res.data, c2 = find(id); if (!c2) return { ok: false, msg: 'Case removed' };
    var out = api().apply(id, d);                       /* next-date safety rules, orders, history */
    var e = c2.eco; e.src = k === 'sc' ? 'sci' : 'cat';
    if (k === 'sc') { e.diary = d.diary; if (d.cnr && !c2.cnr) c2.cnr = d.cnr; if (d.lastListed) e.lastListed = d.lastListed; }
    if (k === 'cat') { e.diary = d.diary || e.diary; e.place = d.place || e.place; }
    if (d.note) e.note = d.note;
    touch(c2); saveAll();
    api().queueCase(id, 'T-' + id, -1);                 /* PDFs into Drive, this PC, this browser */
    return { ok: true, msg: (out.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), html: out.html };
  }).catch(function (e) { delete TR.busy[id]; return { ok: false, msg: e.message || String(e) }; });
}
/* ---------------- the one-time Supreme Court CAPTCHA (case number → diary number) ---------------- */
var SCQ = {};
function scBox(html) {
  var o = document.getElementById('trScBox');
  if (!o) { o = document.createElement('div'); o.id = 'trScBox'; o.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,40,.55);z-index:9000;display:flex;align-items:center;justify-content:center;padding:14px'; document.body.appendChild(o); }
  o.innerHTML = '<div style="background:#fff;border-radius:9px;max-width:520px;width:100%;padding:18px 18px 14px;font-size:12.5px;box-shadow:0 12px 40px rgba(0,0,0,.35)">' + html + '</div>';
}
window.trScClose = function () { var o = document.getElementById('trScBox'); if (o) o.remove(); SCQ = {}; };
function scCaptcha(id, pre) {
  var c = id ? find(id) : null, q = pre || scCaseNo(c && c.cn) || { type: '1', no: '', year: '' };
  SCQ = { id: id, type: q.type, no: q.no, year: q.year, sid: '', img: '' };
  scPaint('Opening the Supreme Court search…');
  tpost({ action: 'scopen' }).then(function (r) { SCQ.sid = r.sid; SCQ.img = r.img; scPaint(''); })
    .catch(function (e) { scPaint('<span style="color:#b3261e">' + he(e.message) + '</span>'); });
}
window.trScCaptcha = scCaptcha;
function scPaint(msg, rows) {
  var c = SCQ.id ? find(SCQ.id) : null;
  var o = function (v, t) { return '<option value="' + v + '"' + (v === SCQ.type ? ' selected' : '') + '>' + t + '</option>'; }, seen = {};
  scBox('<div style="font-weight:700;font-size:14px;margin-bottom:4px">Supreme Court &mdash; find the diary number</div>' +
    (c ? '<div class="mini" style="margin-bottom:8px">' + he(ctit(c)) + ' &middot; ' + he(c.cn || '') + '</div>' : '') +
    '<div class="mini" style="margin-bottom:8px">Only needed once: the diary number is kept, and later fetches need no CAPTCHA.</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><select id="scqT" class="sinp" style="max-width:220px">' + SCT.filter(function (x) { if (seen[x[0]]) return false; seen[x[0]] = 1; return true; }).map(function (x) { return o(x[0], x[1]); }).join('') + '</select>' +
    '<input id="scqN" class="sinp" style="max-width:110px" placeholder="Number" value="' + he(SCQ.no) + '"><input id="scqY" class="sinp" style="max-width:80px" placeholder="Year" value="' + he(SCQ.year) + '"></div>' +
    (SCQ.img ? '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><img src="' + SCQ.img + '" style="height:48px;border:1px solid #ccc;border-radius:4px">' +
      '<input id="scqC" class="sinp" style="max-width:120px;font:15px monospace" placeholder="Answer" autocomplete="off" onkeydown="if(event.key===\'Enter\')trScGo()">' +
      '<button class="btn bg" onclick="trScGo()">Search</button><a href="#" class="mini" onclick="trScNew();return false">new picture</a></div>' : '') +
    '<div id="scqM" class="mini" style="min-height:16px">' + (msg || '') + '</div>' +
    (rows && rows.length ? rows.map(function (r, i) { return '<div style="border-top:1px solid #eee;padding:5px 0"><b>Diary No. ' + he(r.diary) + '</b> <span class="mini">' + he(r.text) + '</span> <button class="btn bg" style="font-size:10px;padding:2px 8px" onclick="trScPick(' + i + ')">' + (c ? 'This one' : 'Look up') + '</button></div>'; }).join('') : '') +
    '<div style="text-align:right;margin-top:8px"><button class="btn bo" onclick="trScClose()">Close</button></div>');
  var inp = document.getElementById('scqC'); if (inp) inp.focus();
  SCQ.rows = rows || SCQ.rows;
}
window.trScNew = function () { scCaptcha(SCQ.id, { type: (document.getElementById('scqT') || {}).value, no: (document.getElementById('scqN') || {}).value, year: (document.getElementById('scqY') || {}).value }); };
window.trScGo = function () {
  SCQ.type = document.getElementById('scqT').value; SCQ.no = document.getElementById('scqN').value.replace(/\D/g, ''); SCQ.year = document.getElementById('scqY').value.replace(/\D/g, '');
  var cap = (document.getElementById('scqC') || {}).value || '';
  if (!SCQ.no || SCQ.year.length !== 4) { scPaint('<span style="color:#b3261e">Give the number and a four-digit year.</span>'); return; }
  if (!cap.trim()) { scPaint('<span style="color:#b3261e">Type the answer to the CAPTCHA question.</span>'); return; }
  scPaint('Searching…');
  tpost({ action: 'scsearch', sid: SCQ.sid, type: SCQ.type, no: SCQ.no, year: SCQ.year, captcha: cap }).then(function (r) {
    if (r.expired) return scCaptcha(SCQ.id, SCQ);
    if (r.img) SCQ.img = r.img;
    if (!r.rows) { scPaint('<span style="color:#b3261e">' + he(r.bad ? 'Wrong answer — try the new picture.' : (r.msg || 'Nothing found')) + '</span>'); return; }
    if (!r.rows.length) { scPaint('<span style="color:#a35b00">' + he(r.msg || 'No case with that number.') + '</span>'); return; }
    if (r.rows.length === 1) { SCQ.rows = r.rows; return trScPick(0); }
    scPaint('More than one case has that number — choose:', r.rows);
  }).catch(function (e) { scPaint('<span style="color:#b3261e">' + he(e.message) + '</span>'); });
};
window.trScPick = function (i) {
  var r = (SCQ.rows || [])[i]; if (!r) return;
  var m = r.diary.match(/(\d+)\/(\d{4})/), id = SCQ.id;
  if (id) {
    var c = find(id); if (!c) return trScClose();
    c.cnr = 'SCIN01' + ('000000' + m[1]).slice(-6) + m[2];      /* the Supreme Court CNR carries the diary number */
    touch(c); saveAll(); trScClose();
    toast('Diary No. ' + r.diary + ' saved — fetching the case…');
    fetchOne(id, true).then(function (x) { toast((x.ok ? '' : 'Could not fetch: ') + x.msg.slice(0, 220), x.ok ? '' : 'err'); try { refresh(); } catch (e) {} });
  } else {                                                       /* from Search Courts */
    trScClose(); TS.n = m[1]; TS.y = m[2]; TS.scBy = 'diary'; srPaint(); tsGo();
  }
};

window.trFetch = function (id) {
  var c = find(id); if (!c) return;
  toast('Fetching from the ' + NAME[kind(c)] + ' site…');
  fetchOne(id).then(function (r) {
    toast((r.ok ? '' : 'Could not fetch: ') + r.msg.slice(0, 220), r.ok ? '' : 'err');
    try { refresh(); } catch (e) {}
  });
};
/* several at once, one after another (gentle on the court sites) */
function fetchMany(ids, onEach) {
  var i = 0, ok = 0, bad = 0;
  function next() {
    if (i >= ids.length) { try { refresh(); } catch (e) {} return Promise.resolve({ ok: ok, bad: bad }); }
    var id = ids[i++];
    return fetchOne(id, true).then(function (r) {
      if (r.ok) ok++; else bad++;
      if (onEach) onEach(id, r, i, ids.length);
      return new Promise(function (res) { setTimeout(res, 700); });
    }).then(next);
  }
  return next();
}

/* ---------------- MAT NAGPUR ---------------- */
function matRows(old) {
  return tpost({ action: 'mat', old: !!old }).then(function (r) {
    TR.mat = (r.rows || []).map(function (x) {
      return { caseText: clean(x.c), applicant: clean(x.ap), district: clean(x.di), advocate: clean(x.adv), respondents: clean(x.rs),
        subject: clean(x.sj), date: isoOf(x.dt), decision: clean(x.dc), url: x.u || '', refs: caseRefs(x.c) };
    });
    TR.matAt = new Date().toISOString(); TR.matOld = !!old;
    return TR.mat;
  });
}
function words(s) { return clean(s).toUpperCase().replace(/[^A-Z ]/g, ' ').split(' ').filter(function (w) { return w.length > 3 && !/^(SHRI|SMT|THE|STATE|MAHARASHTRA|UNION|INDIA|ANOTHER|OTHERS|DEPARTMENT|SECRETARY)$/.test(w); }); }
function advNames() { var s = (window.S && S.tr && S.tr.adv) || 'Charpe'; return s.split(/[,;]/).map(function (x) { return x.toUpperCase().replace(/[^A-Z]/g, ''); }).filter(Boolean); }
/* match the list against MAT cases; attach judgments; returns a summary */
function matApply(entries, onlyIds) {
  var mine = LC().filter(function (c) { return kind(c) === 'mat' && (!onlyIds || onlyIds.indexOf(c.id) >= 0); });
  var index = {};
  mine.forEach(function (c) { caseRefs(c.cn || '').forEach(function (r) { (index[r.key] = index[r.key] || []).push(c); }); });
  var found = [], review = [], notIn = [], adv = advNames(), touched = {};
  entries.forEach(function (e) {
    var hit = false;
    e.refs.forEach(function (r) {
      (index[r.key] || []).forEach(function (c) {
        hit = true;
        var pw = words(ctit(c) + ' ' + (c.cl || '')), aw = words(e.applicant);
        var partyOk = !pw.length || !aw.length || aw.some(function (w) { return pw.indexOf(w) >= 0; });
        if (!partyOk && !(c.eco && c.eco.matOk && c.eco.matOk[hash(e.url || e.caseText)])) { review.push({ e: e, c: c, key: r.key }); return; }
        if (attach(c, e)) found.push({ e: e, c: c }); touched[c.id] = 1;
      });
    });
    if (!hit && !onlyIds && adv.length) {
      var a = e.advocate.toUpperCase().replace(/[^A-Z]/g, '');
      if (adv.some(function (n) { return a.indexOf(n) >= 0; })) notIn.push(e);
    }
  });
  mine.forEach(function (c) { var e = c.eco = c.eco || {}; e.src = e.src || 'mat'; e.matAt = TR.matAt; if (!touched[c.id] && !e.at) e.at = now(); touch(c); });
  Object.keys(touched).forEach(function (id) { api().queueCase(id, 'M-' + id, -1); });
  saveAll();
  TR.review = review; TR.mine = notIn;
  return { cases: mine.length, found: found, review: review, notIn: notIn };
}
function attach(c, e) {
  var x = c.eco = c.eco || {}, k = hash(e.url || e.caseText + e.date);
  x.ord = x.ord || {}; x.src = 'mat'; x.at = now();
  if (x.ord[k]) return false;
  x.ord[k] = { no: '', d: e.date, t: 'Judgment / Final Order', a: ['MAT', e.url] };
  if (!e.url) x.ord[k].none = 'no PDF link on the MAT site';
  if (isOpen(c)) { x.dispFlag = true; x.decision = e.date; x.disposal = e.decision; }
  if (typeof logAct === 'function') logAct('MAT Nagpur: judgment of ' + fd(e.date) + ' found for ' + ctit(c));
  touch(c);
  return true;
}
window.trMatCheck = function (ids, old) {
  toast('Reading the MAT Nagpur judgments list…');
  return matRows(old).then(function (rows) {
    var s = matApply(rows, ids && ids.length ? ids : null);
    var t = rows.length + ' judgments read. ' + (s.found.length ? s.found.length + ' new judgment' + (s.found.length === 1 ? '' : 's') + ' attached to your MAT cases' : 'No new judgment in your ' + s.cases + ' MAT case' + (s.cases === 1 ? '' : 's')) +
      (s.review.length ? ' · ' + s.review.length + ' to confirm' : '') + (s.notIn.length ? ' · ' + s.notIn.length + ' naming you not in the tool' : '') + '.';
    toast(t, s.found.length ? '' : undefined);
    try { refresh(); } catch (e) {}
    if (document.getElementById('scTri')) scTri();
    return s;
  }).catch(function (e) { toast('MAT Nagpur could not be read: ' + (e.message || e), 'err'); });
};
window.trMatOk = function (i) {
  var r = TR.review[i]; if (!r) return;
  var e = r.c.eco = r.c.eco || {}; e.matOk = e.matOk || {}; e.matOk[hash(r.e.url || r.e.caseText)] = 1;
  attach(r.c, r.e); saveAll(); api().queueCase(r.c.id, 'M-' + r.c.id, -1);
  TR.review.splice(i, 1); scTri(); toast('Attached to ' + ctit(r.c) + '.');
};
window.trMatNo = function (i) { TR.review.splice(i, 1); scTri(); };

/* ---------------- MAT NAGPUR DAILY ORDERS ----------------
   Download → Order → Nagpur <year> on the MAT site: one combined PDF per sitting day.
   For every date your tool shows a MAT case as listed (entered by you or the clerk), the
   day's PDF is read, the order headed with your O.A. number is cut out (with any page it
   runs onto) and saved as that case's daily order; its text becomes the order sheet for
   that date, so it also prints on the sticker sheet.                                      */
var LIBS = { pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  pdflib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' };
var libP = {};
function loadLib(k, test) {
  if (test()) return Promise.resolve();
  if (libP[k]) return libP[k];
  return (libP[k] = new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = LIBS[k];
    s.onload = function () { res(); }; s.onerror = function () { libP[k] = null; rej(new Error('A PDF reader could not load — check the internet connection.')); };
    document.head.appendChild(s);
  }));
}
function pdfLibs() {
  return Promise.all([loadLib('pdfjs', function () { return !!window.pdfjsLib; }), loadLib('pdflib', function () { return !!window.PDFLib; })])
    .then(function () { pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.worker; });
}
function b64Bytes(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesB64(u) { var s = '', k = 0x8000; for (var i = 0; i < u.length; i += k) s += String.fromCharCode.apply(null, u.subarray(i, i + k)); return btoa(s); }
/* every date the tool shows this case as listed, up to today */
function listedDates(c) {
  var t = td(), out = {};
  function add(d) { d = String(d || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= t) out[d] = 1; }
  add(c.pd); add(c.nd);
  (c.hist || []).forEach(function (h) { add(h.dt); add(h.pd); add(h.nd); });
  ((c.eco && c.eco.hh) || []).forEach(function (h) { add(h.bd); });
  return Object.keys(out).sort();
}
window.trListedDates = listedDates;
function matDays() {
  if (TR.days && Date.now() - TR.daysAt < 30 * 60000) return Promise.resolve(TR.days);
  return tpost({ action: 'matdays' }).then(function (r) { TR.days = {}; (r.days || []).forEach(function (x) { TR.days[x.d] = x.f; }); TR.daysAt = Date.now(); return TR.days; });
}
function pageTexts(bytes) {
  return pdfjsLib.getDocument({ data: bytes }).promise.then(function (doc) {
    var all = [], i = 1;
    function next() {
      if (i > doc.numPages) return all;
      return doc.getPage(i++).then(function (p) { return p.getTextContent(); }).then(function (tc) { all.push(tc.items.map(function (z) { return z.str; }).join(' ').replace(/\s+/g, ' ')); return next(); });
    }
    return next();
  });
}
/* the order(s) for one case in one day's split; falls back to the pages that open with its number */
function ordersFor(c, split, pages) {
  var keys = caseRefs(c.cn || '').map(function (r) { return r.key; });
  if (!keys.length) return [];
  var hit = split.filter(function (o) { return o.keys.some(function (k) { return keys.indexOf(k) >= 0; }); });
  if (hit.length) return hit;
  var refs = caseRefs(c.cn || ''), found = [];
  pages.forEach(function (t, p) {
    var head = t.slice(0, 300).replace(/(\d)\s+(?=\d)/g, '$1');
    if (refs.some(function (r) { return new RegExp('(?:^|[^\\d])' + r.no + '\\s*(?:\\/|of)\\s*(?:' + r.year + '|' + String(r.year).slice(2) + ')(?!\\d)', 'i').test(head); }))
      found.push({ head: '(found by number — please check)', keys: keys, pages: [p], text: t.trim(), guess: true });
  });
  return found;
}
function savePart(c, date, o, bytes) {
  return PDFLib.PDFDocument.load(bytes).then(function (src) {
    return PDFLib.PDFDocument.create().then(function (out) {
      return out.copyPages(src, o.pages).then(function (pp) { pp.forEach(function (p) { out.addPage(p); }); return out.save(); });
    });
  }).then(function (u8) {
    var blob = new Blob([u8], { type: 'application/pdf' }), name = date + ' Daily order ' + (c.cn || '').replace(/[\\\/:*?"<>|#%]+/g, ' ').slice(0, 40);
    return tpost({ action: 'upload', cnr: api().fkey(c), label: ctit(c).slice(0, 70), name: name, b64: bytesB64(u8) }).then(function (x) {
      api().pdfPut(x.fid, blob);
      api().dirReady(false).then(function (h) { if (h) api().localWrite(h, x.folder, x.name, blob); });
      return { fid: x.fid, nm: x.name, fo: x.folder };
    }).catch(function () { var id = 'local-' + hash(date + c.id); api().pdfPut(id, blob); return { fid: id, nm: name + '.pdf', fo: '', local: true }; });
  });
}
/* ids: cases to check (default all open MAT cases); again: also re-check dates already looked at */
window.trMatDaily = function (ids, again) {
  var list = LC().filter(function (c) { return kind(c) === 'mat' && (ids && ids.length ? ids.indexOf(c.id) >= 0 : isOpen(c)) && caseRefs(c.cn || '').length; });
  if (!list.length) { toast('No MAT case with an O.A. number to check.', 'err'); return Promise.resolve(); }
  TR.dailyMsg = 'Reading the MAT Nagpur Order calendar…'; paintDaily();
  return Promise.all([matDays(), pdfLibs()]).then(function (res) {
    var days = res[0], byDate = {}, noFile = 0, before = 0;
    list.forEach(function (c) {
      var e = c.eco = c.eco || {}; e.matDay = e.matDay || {};
      listedDates(c).forEach(function (d) {
        if (!again && e.matDay[d] && e.matDay[d] !== 'nofile') return;
        if (d < '2025-01-01') { before++; return; }
        if (!days[d]) { e.matDay[d] = 'nofile'; noFile++; return; }
        (byDate[d] = byDate[d] || []).push(c.id);
      });
    });
    var dates = Object.keys(byDate).sort(), got = 0, miss = 0, n = 0;
    if (!dates.length) { TR.dailyMsg = 'Nothing new to look for' + (noFile ? ' (' + noFile + ' listed date' + (noFile === 1 ? ' has' : 's have') + ' no order file on the MAT site yet)' : '') + '.'; paintDaily(); toast(TR.dailyMsg); saveAll(); return; }
    function next() {
      if (n >= dates.length) {
        saveAll(); try { refresh(); } catch (e) {}
        TR.dailyMsg = got + ' daily order' + (got === 1 ? '' : 's') + ' saved from ' + dates.length + ' sitting day' + (dates.length === 1 ? '' : 's') + (miss ? '; ' + miss + ' listed date' + (miss === 1 ? '' : 's') + ' had no order for the case in that day\'s file' : '') +
          (noFile ? '; ' + noFile + ' date' + (noFile === 1 ? '' : 's') + ' not uploaded on the MAT site yet' : '') + (before ? '; dates before 2025 are not on the calendar feed' : '') + '.';
        paintDaily(); toast(TR.dailyMsg); return;
      }
      var d = dates[n++];
      TR.dailyMsg = 'Day ' + n + ' of ' + dates.length + ': ' + fd(d) + '…'; paintDaily();
      return tpost({ action: 'matpdf', f: days[d] }).then(function (r) {
        if (r.missing || !r.b64) { byDate[d].forEach(function (id) { var c = find(id); if (c) c.eco.matDay[d] = 'nofile'; }); return; }
        var bytes = b64Bytes(r.b64);
        return pageTexts(bytes.slice()).then(function (pages) {
          var split = window.matSplit(pages, caseRefs);
          return byDate[d].reduce(function (p, id) {
            return p.then(function () {
              var c = find(id); if (!c) return;
              var mine = ordersFor(c, split, pages);
              if (!mine.length) { c.eco.matDay[d] = 'none'; miss++; return; }
              var o = { keys: mine[0].keys, pages: [], text: mine.map(function (x) { return x.text; }).join(' '), guess: mine.some(function (x) { return x.guess; }) };
              mine.forEach(function (x) { x.pages.forEach(function (q) { if (o.pages.indexOf(q) < 0) o.pages.push(q); }); });
              return savePart(c, d, o, bytes.slice()).then(function (f) {
                var e = c.eco; e.ord = e.ord || {}; e.src = e.src || 'mat';
                e.ord['md' + d] = { d: d, t: 'Daily order' + (o.guess ? ' (please check)' : ''), no: '', fid: f.fid, nm: f.nm, fo: f.fo, man: f.local ? 1 : undefined };
                e.hh = e.hh || [];
                var h = e.hh.filter(function (x) { return x.bd === d; })[0];
                if (!h) { h = { d: d, bd: d, p: 'MAT daily order', j: '' }; e.hh.push(h); e.hh.sort(function (a, b) { return String(a.bd || a.d) < String(b.bd || b.d) ? -1 : 1; }); }
                h.biz = o.text.slice(0, 4000);
                e.matDay[d] = 'found'; e.at = now(); got++; touch(c);
                if (typeof logAct === 'function') logAct('MAT Nagpur: daily order of ' + fd(d) + ' saved for ' + ctit(c));
              });
            });
          }, Promise.resolve());
        });
      }).catch(function (e) { TR.dailyErr = e.message || String(e); }).then(function () { saveAll(); return new Promise(function (r) { setTimeout(r, 400); }); }).then(next);
    }
    return next();
  }).catch(function (e) { TR.dailyMsg = 'Could not read the MAT Order calendar: ' + (e.message || e); paintDaily(); toast(TR.dailyMsg, 'err'); });
};
function paintDaily() { var m = document.getElementById('trDailyMsg'); if (m) m.textContent = TR.dailyMsg || ''; }

/* ---------------- Update Status on the board ---------------- */
window.trUpdate = function (cases) {
  var sc = cases.filter(function (c) { var k = kind(c); return k === 'sc' || k === 'cat'; }).map(function (c) { return c.id; });
  var mat = cases.filter(function (c) { return kind(c) === 'mat'; }).map(function (c) { return c.id; });
  if (sc.length) {
    toast('Fetching ' + sc.length + ' Supreme Court / CAT matter' + (sc.length === 1 ? '' : 's') + ' (no CAPTCHA)…');
    fetchMany(sc).then(function (r) { toast('Supreme Court / CAT: ' + r.ok + ' updated' + (r.bad ? ', ' + r.bad + ' could not be fetched (see the case)' : '') + '.', r.bad ? 'err' : ''); });
  }
  if (mat.length) { trMatCheck(mat); trMatDaily(mat); }
};

/* ---------------- BOMBAY HIGH COURT: find the CNR of a case that has only its number ----------------
   One CAPTCHA on the High Court search (through the eCourts backend) finds the case by type, number
   and year; its CNR is saved on the case, and the usual eCourts fetch then works for it.            */
function isHC(c) { return /high\s*court|\bH\.?\s*C\b/i.test(String(c && c.court || '')); }
function hcBench(c) { var t = String(c && c.court || ''); return /aurangabad|sambhaji/i.test(t) ? 'aurangabad' : /principal|mumbai|bombay\s*$/i.test(t) && !/nagpur/i.test(t) ? 'principal' : 'nagpur'; }
function hcNo(text) {
  var t = clean(text), m = t.match(/^\s*([A-Za-z][A-Za-z.()\s\/-]*?)\s*(?:No\.?\s*)?(\d{1,6})\s*(?:\/|of)\s*(\d{4})/i);
  return m ? { abbr: m[1].replace(/[^A-Za-z]/g, '').toUpperCase(), no: String(+m[2]), year: m[3] } : null;
}
window.trHcNo = hcNo;
var HCQ = {};
/* ---- reading the High Court case page here in the browser (same rules as the backend) ---- */
var HMON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function hpad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function hIso(s) {
  s = String(s || ''); var m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + hpad(m[2]) + '-' + hpad(m[1]);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m) { var mi = HMON.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return m[3] + '-' + hpad(mi + 1) + '-' + hpad(m[1]); }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
}
function hUnent(h) { return String(h || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }); }
function hStrip(h) {
  return hUnent(String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function hNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function hTables(html) {
  var list = [], re = /<table([^>]*)>([\s\S]*?)<\/table>/gi, m;
  while ((m = re.exec(html))) {
    var cls = ((m[1].match(/class\s*=\s*["']([^"']*)/i) || [])[1] || '') + ' ' + ((m[1].match(/id\s*=\s*["']([^"']*)/i) || [])[1] || '');
    var rows = [], rr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, r;
    while ((r = rr.exec(m[2]))) {
      var cells = [], cr = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi, c;
      while ((c = cr.exec(r[1]))) cells.push({ raw: hUnent(c[2] + ' ' + c[3]), t: hStrip(c[3]) });
      if (cells.length) rows.push(cells);
    }
    list.push({ cls: cls.toLowerCase(), rows: rows });
  }
  return list;
}
function hIdx(row, words) { for (var i = 0; i < row.length; i++) { var t = hNorm(row[i].t); for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) >= 0) return i; } return -1; }
function hcParse(html, c) {
  var d = { found: false, hist: [], orders: [] }, kv = {}, hOrd = [];
  hTables(html).forEach(function (tb) {
    var first = tb.rows[0] || [], ht = hNorm(first.map(function (x) { return x.t; }).join('|'));
    if (/history_table/.test(tb.cls) || (ht.indexOf('businessondate') >= 0 && ht.indexOf('hearingdate') >= 0)) {
      var iJ = hIdx(first, ['judge']), iB = hIdx(first, ['businessondate']), iH = hIdx(first, ['hearingdate']), iP = hIdx(first, ['purpose']);
      if (iB < 0) { iJ = 0; iB = 1; iH = 2; iP = 3; }
      tb.rows.slice(1).forEach(function (r) {
        if (r.length < 3) return;
        var bd = hIso(r[iB] && r[iB].t), hd = iH >= 0 ? hIso(r[iH] && r[iH].t) : '';
        if (!bd && !hd) return;
        d.hist.push({ bd: bd, d: hd, j: iJ >= 0 && r[iJ] ? r[iJ].t : '', p: iP >= 0 && r[iP] ? r[iP].t : '', a: null });
      });
      d.found = true; return;
    }
    /* orders table: Order Number | Order on | Judge | Order Date | Order Details (link to display_pdf.php) */
    if (/order_table/.test(tb.cls) || ht.indexOf('orderdate') >= 0) {
      var oN = hIdx(first, ['ordernumber', 'orderno']), oD = hIdx(first, ['orderdate']), oJ = hIdx(first, ['judge']);
      tb.rows.forEach(function (r) {
        var raw = r.map(function (x) { return x.raw; }).join(' '), lm = raw.match(/href\s*=\s*["']([^"']*display_pdf[^"']*)["']/i);
        if (!lm) return;
        var url = hUnent(lm[1]).trim(), od = oD >= 0 && r[oD] ? hIso(r[oD].t) : hIso(r.map(function (x) { return x.t; }).join(' '));
        var txt = r.map(function (x) { return x.t; }).join(' ');
        hOrd.push({ url: url, no: oN >= 0 && r[oN] ? r[oN].t.trim() : '', d: od, title: /judg/i.test(txt) ? 'Judgment' : 'Order', j: oJ >= 0 && r[oJ] ? r[oJ].t : '' });
      });
      d.found = true; return;
    }
    tb.rows.forEach(function (r) { for (var i = 0; i + 1 < r.length; i += 2) { var k = hNorm(r[i].t); if (k && kv[k] === undefined) kv[k] = r[i + 1].t; } });
    if (tb.cls.indexOf('petitioner') >= 0) d.pet = hStrip(tb.rows.map(function (r) { return r.map(function (x) { return x.t; }).join(' '); }).join('\n'));
    if (tb.cls.indexOf('respondent') >= 0) d.res = hStrip(tb.rows.map(function (r) { return r.map(function (x) { return x.t; }).join(' '); }).join('\n'));
  });
  if (!d.pet) { var pm = html.match(/class=["'][^"']*Petitioner_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (pm) d.pet = hStrip(pm[1]); }
  if (!d.res) { var rm = html.match(/class=["'][^"']*Respondent_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (rm) d.res = hStrip(rm[1]); }
  function g() { for (var i = 0; i < arguments.length; i++) { var v = kv[arguments[i]]; if (v) return v; } return ''; }
  d.ctype = g('casetype'); d.filing = g('filingnumber'); d.reg = g('registrationnumber'); d.cnr = g('cnrnumber');
  d.first = hIso(g('firsthearingdate')); d.next = hIso(g('nexthearingdate', 'nextdate')); d.decision = hIso(g('decisiondate', 'dateofdecision'));
  d.stage = g('casestage', 'stageofcase'); d.status = g('casestatus', 'status'); d.disposal = g('natureofdisposal'); d.judge = g('courtnumberandjudge', 'courtnoandjudge', 'coram');
  d.disposed = !!(d.decision || d.disposal || /dispos/i.test(d.status + ' ' + d.stage));
  if (d.ctype || d.reg || d.cnr || d.next || d.stage || d.status) d.found = true;
  if (d.next) d.hist.forEach(function (h) { if (h.d === d.next && h.p) d.purpose = h.p; });
  d.pet = (d.pet || '').slice(0, 600); d.res = (d.res || '').slice(0, 600);
  /* order PDFs: links to display_pdf.php (an order already known by the same link keeps its key) */
  var known = {}; ((c && c.eco && c.eco.ord) ? Object.keys(c.eco.ord) : []).forEach(function (k) { var o = c.eco.ord[k]; if (o && o.a && o.a[0] === 'HC') known[o.a[1]] = k; });
  var seen = {};
  hOrd.forEach(function (o) {
    if (seen[o.url]) return; seen[o.url] = 1;
    d.orders.push({ key: known[o.url] || ('h' + hash(o.url).slice(1)), no: o.no, d: o.d, title: o.title, a: ['HC', o.url] });
  });
  /* any other link to an order PDF elsewhere on the page */
  var re = /<a[^>]+href\s*=\s*["']([^"']*display_pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var url = hUnent(m[1]).trim(); if (seen[url]) continue; seen[url] = 1;
    var row = html.slice(Math.max(0, m.index - 400), m.index + 50);
    var dd = (row.match(/(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4})(?![\s\S]*\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4})/) || [])[1];
    d.orders.push({ key: known[url] || ('h' + hash(url).slice(1)), no: '', d: hIso(dd || ''), title: /judg/i.test(hStrip(m[2])) ? 'Judgment' : 'Order', a: ['HC', url] });
    d.found = true;
  }
  return d;
}
window.trHcParse = hcParse;
function hcGuess(types, abbr) {
  if (!abbr) return '';
  /* "Cri. WP", "CRWP", "Cr.Appeal"…: the criminal type of the same short name (e.g. WP(Criminal Writ Petition)) */
  var crim = /^CRI?/.test(abbr) && abbr.length > 3, core = abbr.replace(/^CRI?/, '');
  var firstOf = function (x) { return (String(x.t || '').toUpperCase().match(/^[A-Z.()\s\/-]+?(?=\s*[-(]|\s{2}|$)/) || [''])[0].replace(/[^A-Z]/g, ''); };
  var same = types.filter(function (x) { return firstOf(x) === abbr; });
  if (!same.length && crim) same = types.filter(function (x) { return firstOf(x) === core && /crim|\bcr\b|cr\./i.test(x.t); });
  if (same.length) {
    var pick = same.filter(function (x) { return crim === /crim|\bcr\b|cr\./i.test(x.t); })[0] || same[0];
    return pick.v;
  }
  var best = '', score = 0;
  types.forEach(function (x) {
    var t = String(x.t || '').toUpperCase(), lead = t.replace(/[^A-Z]/g, ''), first = (t.match(/^[A-Z.()\s\/-]+?(?=\s*[-(]|\s{2}|$)/) || [''])[0].replace(/[^A-Z]/g, '');
    var sc = first === abbr ? 3 : lead.indexOf(abbr) === 0 ? 2 : lead.indexOf(abbr) >= 0 ? 1 : 0;
    if (sc > score) { score = sc; best = x.v; }
  });
  return best;
}
window.trHcFind = function (id) {
  var c = find(id); if (!c) return;
  var q = hcNo(c.cn || '') || { abbr: '', no: '', year: '' };
  HCQ = { id: id, bench: hcBench(c), abbr: q.abbr, no: q.no, year: q.year, sid: '', img: '', types: [], type: '', via: '', cnr: (window.ECO && ECO.api ? ECO.api.cleanCnr(c.cnr) : String(c.cnr || '')).toUpperCase() };
  if (!/^HC[A-Z]{2}\d{12}$/.test(HCQ.cnr)) HCQ.cnr = '';
  window.HCQ = HCQ;
  hcPaint('Opening the High Court search (' + HCQ.bench + ' bench)…');
  /* through Charpe Helper on this PC when it is running (Google's servers are often turned away
     by the High Court site); otherwise through the backend as before */
  /* the High Court is fetched ONLY through Charpe Helper on this PC — never through Google's servers */
  helperCheck().then(function (ok) {
    if (!ok || (TR.helperV || 1) < 3) { HCQ.via = 'none'; throw new Error(helperPC() ? NOHELP_T : 'High Court cases are fetched only through Charpe Helper on the office PC. Open Charpe Suite on that PC (or install the helper here).'); }
    HCQ.via = 'helper';
    hcPaint('Opening the High Court search through Charpe Helper (' + HCQ.bench + ' bench)…');
    return helperPost({ action: 'hcopen', bench: HCQ.bench });
  }).then(function (r) {
    HCQ.sid = r.sid; HCQ.img = r.img; HCQ.types = r.types || []; HCQ.type = hcGuess(HCQ.types, HCQ.abbr);
    hcPaint(r.note ? '<span style="color:#a35b00">' + he(r.note) + '</span>' : '');
  }).catch(function (e) { hcPaint('<span style="color:#b3261e">' + he(e.message) + '</span> <button class="btn bg" style="font-size:11px;padding:2px 10px" onclick="trHcFind(HCQ.id)">&#8635; Try again</button>'); });
};
function hcPaint(msg, rows) {
  var c = find(HCQ.id);
  var one = HCQ.via === 'helper';
  scBox('<div style="font-weight:700;font-size:14px;margin-bottom:4px">Bombay High Court &mdash; ' + (one ? 'fetch this case' : 'find this case\'s CNR') + '</div>' +
    (c ? '<div class="mini" style="margin-bottom:8px">' + he(ctit(c)) + ' &middot; ' + he(c.cn || '(no case number)') + ' &middot; ' + he(HCQ.bench) + ' bench</div>' : '') +
    '<div class="mini" style="margin-bottom:8px">' + (one ? (HCQ.cnr ? 'Searching by its CNR <b>' + HCQ.cnr + '</b>. ' : 'Check the case type, number and year. ') + 'One CAPTCHA: the case is found, its CNR saved, and its next date, history and orders fetched (through Charpe Helper on this PC).'
      : 'Only needed once: the CNR is saved on the case, and Official eCourts / Update Status then fetch it like any other case. (Start Charpe Helper on this PC to find and fetch in one step.)') + '</div>' +
    '<div style="display:' + (one && HCQ.cnr ? 'none' : 'flex') + ';gap:6px;flex-wrap:wrap;margin-bottom:8px"><select id="hcqT" class="sinp" style="max-width:260px">' +
      (HCQ.types.length ? '<option value="">— case type —</option>' + HCQ.types.map(function (x) { return '<option value="' + he(x.v) + '"' + (x.v === HCQ.type ? ' selected' : '') + '>' + he(x.t) + '</option>'; }).join('') : '<option value="">(loading case types…)</option>') + '</select>' +
    '<input id="hcqN" class="sinp" style="max-width:110px" placeholder="Number" value="' + he(HCQ.no) + '"><input id="hcqY" class="sinp" style="max-width:80px" placeholder="Year" value="' + he(HCQ.year) + '"></div>' +
    (HCQ.img ? '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><img src="' + HCQ.img + '" style="height:48px;border:1px solid #ccc;border-radius:4px">' +
      '<input id="hcqC" class="sinp" style="max-width:130px;font:15px monospace" placeholder="CAPTCHA" autocomplete="off" onkeydown="if(event.key===\'Enter\')trHcGo()">' +
      '<button class="btn bg" onclick="trHcGo()">Search</button><a href="#" class="mini" onclick="trHcPic();return false">new picture</a></div>' : '') +
    '<div id="hcqM" class="mini" style="min-height:16px">' + (msg || '') + '</div>' +
    (rows && rows.length ? rows.map(function (r, i) { return '<div style="border-top:1px solid #eee;padding:5px 0"><b>' + he(r.no || '') + '</b> <span class="mini">' + he(r.cnr) + '</span><br><span class="mini">' + he(r.pet || '') + (r.res ? ' vs. ' + he(r.res) : '') + '</span> <button class="btn bg" style="font-size:10px;padding:2px 8px" onclick="trHcPick(' + i + ')">This is my case</button></div>'; }).join('') : '') +
    '<div style="text-align:right;margin-top:8px"><button class="btn bo" onclick="trScClose()">Close</button></div>');
  HCQ.rows = rows || HCQ.rows;
  var inp = document.getElementById('hcqC'); if (inp) inp.focus();
}
window.HCQ = HCQ;
window.trHcGo = function () {
  HCQ.type = document.getElementById('hcqT').value; HCQ.no = document.getElementById('hcqN').value.replace(/\D/g, ''); HCQ.year = document.getElementById('hcqY').value.replace(/\D/g, '');
  var cap = (document.getElementById('hcqC') || {}).value || '';
  var byCnr = HCQ.via === 'helper' && HCQ.cnr; HCQ.byCnr = !!byCnr;
  if (!byCnr && !HCQ.type) { hcPaint('<span style="color:#b3261e">Choose the case type.</span>'); return; }
  if (!byCnr && (!HCQ.no || HCQ.year.length !== 4)) { hcPaint('<span style="color:#b3261e">Give the number and a four-digit year.</span>'); return; }
  if (!cap.trim()) { hcPaint('<span style="color:#b3261e">Type the CAPTCHA.</span>'); return; }
  hcPaint('Searching…');
  var body = { sid: HCQ.sid, via: 'hc', bench: HCQ.bench, mode: 'cno', captcha: cap.trim(), type: HCQ.type, no: HCQ.no, year: HCQ.year, status: 'Both', q: '' };
  (HCQ.via === 'helper' ? helperPost(Object.assign({ action: byCnr ? 'hccnr' : 'hcsearch', cnr: HCQ.cnr }, body)) : api().post(Object.assign({ action: 'ssearch' }, body))).then(function (r) {
    if (r.expired) return trHcFind(HCQ.id);
    if (r.img) HCQ.img = r.img; if (r.sid) HCQ.sid = r.sid;
    if (r.bad) { hcPaint('<span style="color:#b3261e">Wrong CAPTCHA — type the new picture.</span>'); return; }
    if (r.notFound) { hcPaint('<span style="color:#a35b00">' + he(r.msg || 'Not found.') + '</span>'); return; }
    if (r.html) return hcDone(r.cnr, r.html);
    var rows = r.rows || [];
    if (!rows.length) { hcPaint('<span style="color:#a35b00">' + he(r.msg || 'Nothing found with that type, number and year.') + ' Check the case type, or try Search Courts by party name.</span>'); return; }
    if (rows.length === 1) { HCQ.rows = rows; return trHcPick(0); }
    hcPaint('More than one case — choose yours:', rows);
  }).catch(function (e) { hcPaint('<span style="color:#b3261e">' + he(e.message) + '</span>'); });
};
window.trHcPic = function () {
  if (HCQ.via !== 'helper') return trHcFind(HCQ.id);
  helperPost({ action: 'hcpic', sid: HCQ.sid }).then(function (r) { if (r.expired) return trHcFind(HCQ.id); HCQ.img = r.img; hcPaint(''); })
    .catch(function () { trHcFind(HCQ.id); });
};
/* the case page is in hand: save the CNR, read the page, apply it like an eCourts fetch, download the orders */
function hcDone(cnr, html) {
  var c = find(HCQ.id); if (!c) return;
  var d = hcParse(String(html || ''), c);
  if (cnr) c.cnr = cnr;
  if (!d.found) { touch(c); saveAll(); hcPaint('<span style="color:#a35b00">CNR ' + he(cnr || '') + ' saved, but the case page could not be read: ' + he(hStrip(html).slice(0, 160) || 'empty answer') + '</span>'); return; }
  var res = ECO.api.apply(c.id, d);
  if (typeof logAct === 'function') logAct('High Court fetched for ' + ctit(c) + (cnr ? ' (CNR ' + cnr + ')' : ''));
  try { refresh(); } catch (e) {}
  HCQ.img = ''; HCQ.rows = [];
  /* the High Court site gives out order PDFs only after a search by CNR: if the case was found by its
     number, one more CAPTCHA (by CNR) brings the orders */
  if (HCQ.byCnr) {
    ECO.api.queueCase(c.id, 'H:' + HCQ.sid, -1);
    hcPaint('<div style="color:#127a4b;font-weight:600;margin-bottom:4px">&#10003; Fetched from the High Court' + (cnr ? ' &middot; CNR ' + he(cnr) : '') + '</div>' + res.html +
      '<div class="mini" style="margin-top:6px">Orders download in the background into Drive (see Orders &amp; order sheets on the case).</div>');
    return;
  }
  var nOrd = (d.orders || []).length;
  hcPaint('<div style="color:#127a4b;font-weight:600;margin-bottom:4px">&#10003; Found and fetched &middot; CNR ' + he(cnr || '') + ' saved</div>' + res.html +
    (nOrd ? '<div style="margin-top:8px;background:#fff8e6;border:1px solid #f0d48a;border-radius:6px;padding:7px 9px;font-size:12px">The High Court gives out the ' + nOrd + ' order PDF' + (nOrd === 1 ? '' : 's') +
      ' only after a search by CNR. <button class="btn bg" onclick="trScClose();ecoOpenBatch([\'' + c.id + '\'])">Type one more CAPTCHA to get the orders</button></div>' : ''));
}
window.trHcPick = function (i) {
  var r = (HCQ.rows || [])[i], c = find(HCQ.id); if (!r || !c) return;
  if (HCQ.via === 'helper') {
    hcPaint('Fetching the case…');
    helperPost({ action: 'hchist', sid: HCQ.sid, cnr: r.cnr, case_no: r.case_no, court_code: r.court_code }).then(function (x) {
      if (x.expired) return trHcFind(HCQ.id);
      hcDone(r.cnr, x.html);
    }).catch(function (e) { hcPaint('<span style="color:#b3261e">' + he(e.message) + '</span>'); });
    return;
  }
  c.cnr = r.cnr; touch(c); saveAll(); trScClose();
  if (typeof logAct === 'function') logAct('High Court CNR ' + r.cnr + ' found for ' + ctit(c));
  try { refresh(); } catch (e) {}
  toast('CNR ' + r.cnr + ' saved. Now type one more CAPTCHA to fetch the case.');
  if (typeof ecoOpenBatch === 'function') ecoOpenBatch([c.id]);
};

/* ---------------- DISTRICT, LABOUR AND INDUSTRIAL COURTS: find the CNR on eCourts ----------------
   Court → the establishment on eCourts (guessed from the court name), case type (guessed from the
   case number), number, year, one CAPTCHA. The CNR is saved; the usual eCourts fetch then works.   */
var DCQ = {};
var EST_GUESS = [[/labou?r/i, /labou?r/i], [/industrial/i, /industrial/i], [/senior|sr\.?\s*d/i, /senior|sr\.?\s*d/i], [/junior|jr\.?\s*d/i, /junior|jr\.?\s*d/i],
  [/motor|m\.?a\.?c\.?t|accident/i, /motor|accident|m\.?a\.?c/i], [/family/i, /family/i], [/co-?op/i, /co-?op/i], [/railway/i, /railway/i],
  [/school\s*tribunal/i, /school/i], [/district|sessions/i, /district|sessions/i], [/c\.?j\.?m|chief\s+judicial|j\.?m\.?f\.?c|magistrate/i, /magistrate|c\.?j\.?m|j\.?m\.?f\.?c/i]];
var DISTRICTS = ['Nagpur', 'Wardha', 'Amravati', 'Yavatmal', 'Chandrapur', 'Bhandara', 'Gondia', 'Gadchiroli', 'Akola', 'Washim', 'Buldhana', 'Mumbai', 'Pune', 'Aurangabad'];
function dcDistrict(c) { var t = String(c.court || ''); for (var i = 0; i < DISTRICTS.length; i++) if (new RegExp(DISTRICTS[i], 'i').test(t)) return DISTRICTS[i]; return 'Nagpur'; }
function estGuess(c, list) {
  var t = String(c.court || ''), generic = /^(court|courts|civil|criminal|judge|junior|senior|division|district|sessions?|session|small|causes|motor|vechicle|vehicle|railway|industrial|labour|family|school|tribunal|chief|judicial|magistrate|joint|and|the|first|class|cooperative|appellate|state)$/i;
  /* the place in the case's court name: a town that appears in the court list (Katol, Umrer, Kamptee…), else the district */
  var places = {}; list.forEach(function (x) { String(x.t).split(/[^A-Za-z]+/).forEach(function (w) { if (w.length > 3 && !generic.test(w)) places[w.toLowerCase()] = 1; }); });
  var hit = Object.keys(places).filter(function (w) { return new RegExp('\\b' + w + '\\b', 'i').test(t); }).sort(function (a, b) { return /nagpur/.test(a) - /nagpur/.test(b); })[0];
  var city = new RegExp(hit || dcDistrict(c), 'i');
  /* courts in the case's own city first ("Jt. Civil Judge Sr. Dn., Nagpur" → Nagpur, not Katol) */
  var mine = list.filter(function (x) { return city.test(x.t); }), rest = list.filter(function (x) { return !city.test(x.t); });
  for (var i = 0; i < EST_GUESS.length; i++) if (EST_GUESS[i][0].test(t)) {
    var m = mine.filter(function (x) { return EST_GUESS[i][1].test(x.t); })[0] || rest.filter(function (x) { return EST_GUESS[i][1].test(x.t); })[0];
    if (m) return m.v;
  }
  return '';
}
function typeGuess(types, cn) {
  var q = hcNo(cn || ''); if (!q || !q.abbr) return '';
  var a = q.abbr.replace(/^(REGULAR|SPECIAL)?/, ''), best = '', score = 0;
  var pre = (String(cn || '').match(/^\s*([A-Za-z][A-Za-z.()\s-]*?)\s*(?:No\.?\s*)?\/?\s*\d/) || ['', ''])[1].toUpperCase().replace(/\s+/g, ' ').replace(/\s*\/\s*$/, '').trim();
  types.forEach(function (x) {
    var t = String(x.t || '').toUpperCase(), lead = t.replace(/[^A-Z]/g, ''), first = (t.match(/^[A-Z.()\s\/]+?(?=\s*[-(]|\s{2}|$)/) || [''])[0].replace(/[^A-Z]/g, '');
    var sc = first === q.abbr ? 4 : first === a ? 3 : lead.indexOf(q.abbr) === 0 ? 2 : lead.indexOf(q.abbr) >= 0 ? 1 : 0;
    /* written exactly as in the case number ("Complaint ULP", not "Complaint U.L.P") wins a tie */
    if (sc && t.replace(/\s*-\s*.*$/, '').replace(/\s+/g, ' ').trim() === pre) sc += 0.5;
    if (sc > score) { score = sc; best = x.v; }
  });
  return best;
}
window.trDcFind = function (id) {
  var c = find(id); if (!c) return;
  var q = hcNo(c.cn || '') || { no: '', year: '' };
  DCQ = { id: id, district: dcDistrict(c), no: q.no, year: q.year, sid: '', img: '', est: [], estv: '', types: [], type: '' };
  window.DCQ = DCQ;
  dcPaint('Opening eCourts (' + DCQ.district + ' district)…');
  /* through Charpe Helper on this PC when it is running; otherwise the Google backend */
  helperCheck().then(function (ok) {
    DCQ.via = ok && (TR.helperV || 1) >= 6 ? 'helper' : 'backend';
    if (DCQ.via === 'backend' && helperPC()) throw new Error(NOHELP_T);
    return DCQ.via === 'helper' ? helperPost({ action: 'dcopen', district: DCQ.district }) : api().post({ action: 'sopen', via: 'dc', state: 'Maharashtra', district: DCQ.district });
  }).then(function (r) {
    DCQ.sid = r.sid; DCQ.img = r.img; DCQ.est = (r.lists && r.lists.est) || [];
    var cityRe = new RegExp(DCQ.district, 'i');
    DCQ.est = DCQ.est.filter(function (x) { return cityRe.test(x.t); }).concat(DCQ.est.filter(function (x) { return !cityRe.test(x.t); }));
    DCQ.estv = estGuess(c, DCQ.est);
    dcPaint((r.note ? '<span style="color:#a35b00">' + he(r.note) + '</span> ' : '') + (DCQ.via === 'backend' ? '<span style="color:#a35b00">Charpe Helper could not be reached, so this goes through Google (slower; the court site may refuse it). <a href="#" onclick="charpeHelperTest();return false">Test the connection</a></span>' : ''));
    if (DCQ.estv) trDcTypes();
  }).catch(function (e) { dcPaint('<span style="color:#b3261e">' + he(e.message) + '</span> <button class="btn bg" style="font-size:11px;padding:2px 10px" onclick="trDcFind(DCQ.id)">&#8635; Try again</button>'); });
};
window.trDcTypes = function () {
  var e = document.getElementById('dcqE'); if (e) DCQ.estv = e.value;
  if (!DCQ.estv) return;
  dcPaint('Loading the case types of that court…');
  (DCQ.via === 'helper' ? helperPost({ action: 'dctypes', sid: DCQ.sid, est: DCQ.estv }) : api().post({ action: 'stypes', sid: DCQ.sid, est: DCQ.estv })).then(function (r) {
    if (r.expired) return trDcFind(DCQ.id);
    DCQ.types = r.types || []; DCQ.type = typeGuess(DCQ.types, (find(DCQ.id) || {}).cn); dcPaint('');
  }).catch(function (x) { dcPaint('<span style="color:#b3261e">' + he(x.message) + '</span>'); });
};
function dcPaint(msg, rows) {
  var c = find(DCQ.id), o = function (v, t, s) { return '<option value="' + he(v) + '"' + (s ? ' selected' : '') + '>' + he(t) + '</option>'; };
  scBox('<div style="font-weight:700;font-size:14px;margin-bottom:4px">eCourts &mdash; find this case\'s CNR</div>' +
    (c ? '<div class="mini" style="margin-bottom:8px">' + he(ctit(c)) + ' &middot; ' + he(c.court || '') + ' &middot; ' + he(c.cn || '(no case number)') + '</div>' : '') +
    '<div class="mini" style="margin-bottom:8px">Only needed once: the CNR is saved on the case, and Official eCourts / Update Status then fetch it like any other case.</div>' +
    '<div style="margin-bottom:6px"><select id="dcqE" class="sinp" style="width:100%" onchange="trDcTypes()">' + (DCQ.est.length ? o('', '— court / establishment on eCourts —', !DCQ.estv) + DCQ.est.map(function (x) { return o(x.v, x.t, x.v === DCQ.estv); }).join('') : o('', '(loading the courts of ' + DCQ.district + '…)', true)) + '</select></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><select id="dcqT" class="sinp" style="max-width:260px">' + (DCQ.types.length ? o('', '— case type —', !DCQ.type) + DCQ.types.map(function (x) { return o(x.v, x.t, x.v === DCQ.type); }).join('') : o('', DCQ.estv ? '(loading case types…)' : '(choose the court first)', true)) + '</select>' +
    '<input id="dcqN" class="sinp" style="max-width:110px" placeholder="Number" value="' + he(DCQ.no) + '"><input id="dcqY" class="sinp" style="max-width:80px" placeholder="Year" value="' + he(DCQ.year) + '"></div>' +
    (DCQ.img ? '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><img src="' + DCQ.img + '" style="height:48px;border:1px solid #ccc;border-radius:4px">' +
      '<input id="dcqC" class="sinp" style="max-width:130px;font:15px monospace" placeholder="CAPTCHA" autocomplete="off" onkeydown="if(event.key===\'Enter\')trDcGo()">' +
      '<button class="btn bg" onclick="trDcGo()">Search</button><a href="#" class="mini" onclick="trDcFind(DCQ.id);return false">new picture</a></div>' : '') +
    '<div id="dcqM" class="mini" style="min-height:16px">' + (msg || '') + '</div>' +
    (rows && rows.length ? rows.map(function (r, i) { return '<div style="border-top:1px solid #eee;padding:5px 0"><b>' + he(r.no || '') + '</b> <span class="mini">' + he(r.cnr) + ' &middot; ' + he(r.court || '') + '</span><br><span class="mini">' + he(r.pet || '') + (r.res ? ' vs. ' + he(r.res) : '') + '</span> <button class="btn bg" style="font-size:10px;padding:2px 8px" onclick="trDcPick(' + i + ')">This is my case</button></div>'; }).join('') : '') +
    '<div style="text-align:right;margin-top:8px"><button class="btn bo" onclick="trScClose()">Close</button></div>');
  DCQ.rows = rows || DCQ.rows;
  var inp = document.getElementById('dcqC'); if (inp && DCQ.types.length) inp.focus();
}
window.DCQ = DCQ;
window.trDcGo = function () {
  DCQ.estv = document.getElementById('dcqE').value; DCQ.type = document.getElementById('dcqT').value;
  DCQ.no = document.getElementById('dcqN').value.replace(/\D/g, ''); DCQ.year = document.getElementById('dcqY').value.replace(/\D/g, '');
  var cap = (document.getElementById('dcqC') || {}).value || '';
  if (!DCQ.estv) { dcPaint('<span style="color:#b3261e">Choose the court.</span>'); return; }
  if (!DCQ.type) { dcPaint('<span style="color:#b3261e">Choose the case type.</span>'); return; }
  if (!DCQ.no || DCQ.year.length !== 4) { dcPaint('<span style="color:#b3261e">Give the number and a four-digit year.</span>'); return; }
  if (!cap.trim()) { dcPaint('<span style="color:#b3261e">Type the CAPTCHA.</span>'); return; }
  dcPaint('Searching…');
  var dq = { sid: DCQ.sid, via: 'dc', mode: 'cno', captcha: cap.trim(), est: DCQ.estv, type: DCQ.type, no: DCQ.no, year: DCQ.year, status: 'Both', q: '' };
  (DCQ.via === 'helper' ? helperPost(Object.assign({ action: 'dcfind' }, dq)) : api().post(Object.assign({ action: 'ssearch' }, dq))).then(function (r) {
    if (r.expired) return trDcFind(DCQ.id);
    if (r.img) DCQ.img = r.img; if (r.sid) DCQ.sid = r.sid;
    if (r.bad) { dcPaint('<span style="color:#b3261e">Wrong CAPTCHA — type the new picture.</span>'); return; }
    var rows = r.rows || [];
    if (!rows.length) { dcPaint('<span style="color:#a35b00">' + he(r.msg || 'Nothing found.') + ' Check the court and case type (e.g. a ULP complaint may be filed under &ldquo;Complaint (ULP)&rdquo;).</span>'); return; }
    if (rows.length === 1) { DCQ.rows = rows; return trDcPick(0); }
    dcPaint('More than one case — choose yours:', rows);
  }).catch(function (e) { dcPaint('<span style="color:#b3261e">' + he(e.message) + '</span>'); });
};
window.trDcPick = function (i) {
  var r = (DCQ.rows || [])[i], c = find(DCQ.id); if (!r || !c) return;
  c.cnr = r.cnr; touch(c); saveAll(); trScClose();
  if (typeof logAct === 'function') logAct('eCourts CNR ' + r.cnr + ' found for ' + ctit(c));
  try { refresh(); } catch (e) {}
  toast('CNR ' + r.cnr + ' saved. Now type one more CAPTCHA to fetch the case.');
  if (typeof ecoOpenBatch === 'function') ecoOpenBatch([c.id]);
};

/* ---------------- a button on each case ---------------- */
var _bld = window.bldRow;
window.bldRow = bldRow = function (c) {
  var h = _bld.apply(this, arguments), k = kind(c);
  if (!k && isHC(c) && !/supreme/i.test(c.court || '')) {
    var hb1 = '<button class="btn bg" onclick="event.stopPropagation();trHcFind(\'' + c.id + '\')" title="One CAPTCHA: find the case on the High Court site by its number (or CNR), save the CNR and fetch next date, history and orders">&#9878; Fetch from High Court</button>';
    var at1 = '<button class="btn bo" onclick="event.stopPropagation();prtC(';
    return h.indexOf(at1) >= 0 ? h.replace(at1, hb1 + at1) : h;
  }
  if (!k && !(typeof ecoOk === 'function' && ecoOk(c)) && !/supreme/i.test(c.court || '')) {
    var hb = isHC(c)
      ? '<button class="btn bg" onclick="event.stopPropagation();trHcFind(\'' + c.id + '\')" title="Find this case on the High Court site by its number (one CAPTCHA) and save its CNR">&#9878; Find on High Court</button>'
      : '<button class="btn bg" onclick="event.stopPropagation();trDcFind(\'' + c.id + '\')" title="Find this case on eCourts by its number (one CAPTCHA) and save its CNR">&#9878; Find on eCourts</button>';
    var at0 = '<button class="btn bo" onclick="event.stopPropagation();prtC(';
    return h.indexOf(at0) >= 0 ? h.replace(at0, hb + at0) : h;
  }
  if (!k) return h;
  var b = k === 'mat'
    ? '<button class="btn bg" onclick="event.stopPropagation();trMatCheck([\'' + c.id + '\']);trMatDaily([\'' + c.id + '\'])" title="Daily orders for the dates listed in the tool, and any judgment, from the MAT Nagpur site (no CAPTCHA)">&#9878; Check MAT Nagpur</button>'
    : '<button class="btn bg" onclick="event.stopPropagation();trFetch(\'' + c.id + '\')" title="Fetch status, next date and orders (no CAPTCHA)">&#9878; Fetch from ' + NAME[k] + '</button>';
  var at = '<button class="btn bo" onclick="event.stopPropagation();prtC(';
  return h.indexOf(at) >= 0 ? h.replace(at, b + at) : h;
};

/* ---------------- Sync Centre → "Supreme Court · CAT · MAT" ---------------- */
function addTab() {
  var tabs = document.querySelector('#psync .tabs'); if (!tabs || document.getElementById('scTri')) return;
  tabs.insertAdjacentHTML('beforeend', '<button class="tbt" onclick="stab(this,\'scTri\');scTri()">Supreme Court &middot; CAT &middot; MAT</button>');
  tabs.parentNode.insertAdjacentHTML('beforeend', '<div id="scTri" class="tp"></div>');
}
function lastAt(c) { var e = c.eco || {}; return e.src && e.at ? (typeof cs2Fmt === 'function' ? cs2Fmt(e.at) : e.at.slice(0, 10)) : '<span style="color:#a35b00">never</span>'; }
window.scTri = function () {
  var el = document.getElementById('scTri'); if (!el) return;
  var all = LC().filter(function (c) { return isOpen(c) && kind(c); });
  var g = { sc: [], cat: [], mat: [] }; all.forEach(function (c) { g[kind(c)].push(c); });
  function list(arr, k) {
    if (!arr.length) return '<div class="mini" style="padding:4px 0">No open ' + NAME[k] + ' matters.</div>';
    return arr.map(function (c) {
      var probl = k === 'sc' && !scDiary(c, false) ? (scCaseNo(c.cn) ? ' <span style="color:#a35b00">— one CAPTCHA the first time (press Fetch)</span>' : ' <span style="color:#b3261e">— diary or case number needed</span>') : k === 'cat' && !catRef(c) ? ' <span style="color:#b3261e">— case number should read O.A. 297/2026</span>' : '';
      return '<div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid #eee;padding:4px 0;font-size:11.5px"><span style="flex:1"><a href="#" onclick="jumpCase(\'' + c.id + '\');return false">' + he(ctit(c)) + '</a> <span class="mini">' + he(c.cn || '') + '</span>' + probl + '</span>' +
        '<span class="mini">next ' + (c.nd ? fd(c.nd) : '—') + ' &middot; checked ' + lastAt(c) + '</span>' +
        (k === 'mat' ? '' : '<button class="btn bo" style="font-size:10px;padding:2px 8px" onclick="trFetch(\'' + c.id + '\')">Fetch</button>') + '</div>';
    }).join('');
  }
  var adv = (window.S && S.tr && S.tr.adv) || 'Charpe';
  if (TR.helper === null) helperCheck().then(function () { if (document.getElementById('scTri')) scTri(); });
  var hs = TR.helper === true ? '<span style="color:#127a4b;font-weight:600">&#10003; Charpe Helper is running on this PC</span> &mdash; Supreme Court and MAT are fetched from this office\'s own connection.'
    : TR.helper === false ? '<span style="color:#b3261e;font-weight:600">&#9888; Charpe Helper is not running on this PC.</span> The Supreme Court and MAT sites turn away Google\'s servers, so they need it. Install it once from <b>Charpe-Helper.zip</b> (double-click <b>Install Charpe Helper.bat</b>); it then starts with Windows.'
    : 'Checking for Charpe Helper on this PC&hellip;';
  var h = '<div class="nbox" style="font-size:11.5px;line-height:1.6;background:' + (TR.helper === false ? '#fff4f2' : '#f3faf5') + '">' + hs + ' <a href="#" onclick="trHelperCheck();return false">Check again</a></div>' +
    '<div class="nbox" style="font-size:11.5px;line-height:1.6">No CAPTCHA is needed for any of these. Orders and judgments are saved in Drive and on this PC like eCourts orders. ' +
    'Supreme Court cases work from the <b>diary number</b> (CNR <code>SCIN01…</code>, or &ldquo;Diary No. 38471/2025&rdquo;), or from the case number (SLP(C), SLP(Crl), Civil / Criminal Appeal…) with one CAPTCHA the first time; CAT cases need the case number as <b>O.A. 297/2026</b>.</div>' +
    '<h4 style="margin:12px 0 4px">Supreme Court of India (' + g.sc.length + ')</h4>' + list(g.sc, 'sc') +
    '<h4 style="margin:12px 0 4px">CAT Mumbai Bench &mdash; incl. Nagpur circuit (' + g.cat.length + ')</h4>' + list(g.cat, 'cat') +
    '<div style="margin:8px 0"><button class="btn bg" id="trAllBtn" onclick="trAll()">Fetch all Supreme Court and CAT matters</button> <span id="trAllMsg" class="mini"></span></div>' +
    '<h4 style="margin:14px 0 4px">MAT Nagpur Bench (' + g.mat.length + ')</h4>' +
    '<div class="mini" style="margin-bottom:4px">Daily orders come from the MAT Order calendar (one PDF per sitting day): for every date the tool shows a MAT case as listed, its own order is cut out of that day\'s PDF. The site gives no next dates, so MAT next dates stay as you enter them.' + (TR.matAt ? ' Last read: ' + (typeof cs2Fmt === 'function' ? cs2Fmt(TR.matAt) : TR.matAt) + ', ' + (TR.mat || []).length + ' judgments.' : '') + '</div>' +
    list(g.mat, 'mat') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0"><button class="btn bg" onclick="trMatDaily();trMatCheck()">Check MAT Nagpur now</button>' +
    '<button class="btn bo" onclick="trMatDaily(null,true)" title="Look again at dates already checked">Re-check all listed dates</button><span id="trDailyMsg" class="mini">' + he(TR.dailyMsg || '') + '</span></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px">' +
    '<label class="mini"><input type="checkbox" id="trOld"> include judgments before 2025 (slower)</label>' +
    '<span class="mini">Flag judgments naming advocate:</span><input class="sinp" style="max-width:160px" value="' + he(adv) + '" onchange="trSetAdv(this.value)"></div>';
  if (TR.review.length) h += '<div class="nbox" style="background:#fff8e6;border-color:#f0d48a"><b>Please confirm</b> &mdash; the number and year match, but the applicant\'s name differs:' +
    TR.review.map(function (r, i) {
      return '<div style="padding:4px 0;border-bottom:1px solid #f0e2b8;font-size:11.5px"><b>' + he(r.e.caseText) + '</b> ' + he(r.e.applicant) + ' &mdash; ' + fd(r.e.date) + ' ' + he(r.e.decision) +
        '<br>Your case: ' + he(ctit(r.c)) + ' ' + he(r.c.cn || '') + ' <button class="btn bg" style="font-size:10px;padding:2px 8px" onclick="trMatOk(' + i + ')">Same case &mdash; attach</button> <button class="btn bo" style="font-size:10px;padding:2px 8px" onclick="trMatNo(' + i + ')">Not mine</button></div>';
    }).join('') + '</div>';
  if (TR.mine.length) h += '<div class="nbox"><b>MAT Nagpur judgments naming ' + he(adv) + ' that are not in the tool</b> (' + TR.mine.length + '):' +
    TR.mine.slice(0, 60).map(function (e, i) {
      return '<div style="padding:4px 0;border-bottom:1px solid #eee;font-size:11.5px"><b>' + he(e.caseText) + '</b> ' + he(e.applicant) + ' v. ' + he(e.respondents.slice(0, 80)) + ' &mdash; ' + fd(e.date) + ' ' + he(e.decision) +
        (e.url ? ' <a href="' + he(e.url) + '" target="_blank" rel="noopener">PDF</a>' : '') + ' <button class="btn bo" style="font-size:10px;padding:2px 8px" onclick="trMatAdd(\'mine\',' + i + ')">+ Add</button></div>';
    }).join('') + '</div>';
  el.innerHTML = h;
};
window.trSetAdv = function (v) { S.tr = S.tr || {}; S.tr.adv = clean(v) || 'Charpe'; saveAll(); };
var _mc = window.trMatCheck;
window.trMatCheck = function (ids) { var o = document.getElementById('trOld'); return _mc(ids, !!(o && o.checked)); };
window.trAll = function () {
  var ids = LC().filter(function (c) { var k = kind(c); return isOpen(c) && (k === 'sc' && scDiary(c, false) || k === 'cat' && catRef(c)); }).map(function (c) { return c.id; });
  if (!ids.length) { toast('No Supreme Court or CAT matter is ready to fetch.', 'err'); return; }
  var b = document.getElementById('trAllBtn'); if (b) b.disabled = true;
  fetchMany(ids, function (id, r, i, n) { var m = document.getElementById('trAllMsg'); if (m) m.textContent = i + ' of ' + n + ' — ' + ctit(find(id) || {}).slice(0, 40) + ': ' + (r.ok ? 'done' : r.msg.slice(0, 80)); })
    .then(function (r) { if (b) b.disabled = false; toast(r.ok + ' updated' + (r.bad ? ', ' + r.bad + ' not' : '') + '.'); scTri(); });
};

/* ---------------- Search Courts: Supreme Court, CAT, MAT without the official page ---------------- */
var TS = { rows: [], q: '' };
var _sp = window.srPaint;
window.srPaint = function () {
  var el = document.getElementById('srBody'); if (!el || !window.SR) return;
  var k = SR.court; if (k !== 'sc' && k !== 'cat' && k !== 'mat') return _sp.apply(this, arguments);
  var opt = function (v, t, s) { return '<option value="' + he(v) + '"' + (s ? ' selected' : '') + '>' + he(t) + '</option>'; };
  var courts = [['dc', 'District & Sessions Court Nagpur and subordinate courts (incl. Labour, Industrial, MACT, Railway Court)'], ['hcn', 'Bombay High Court — Nagpur Bench'], ['hca', 'Bombay High Court — Aurangabad Bench'],
    ['hcm', 'Bombay High Court — Principal Seat, Mumbai'], ['sc', 'Supreme Court of India'], ['cat', 'Central Administrative Tribunal, Mumbai Bench'], ['mat', 'Maharashtra Administrative Tribunal, Nagpur Bench']];
  var h = '<div class="fgr"><div class="fg f2"><label>Court</label><select onchange="SR.court=this.value;SR.sid=\'\';SR.rows=[];TS.rows=[];srPaint()">' + courts.map(function (x) { return opt(x[0], x[1], x[0] === k); }).join('') + '</select></div>';
  if (k === 'sc') {
    var seen = {};
    h += '<div class="fg"><label>Search by</label><select id="tsB" onchange="TS.scBy=this.value;srPaint()">' + opt('diary', 'Diary number (no CAPTCHA)', TS.scBy !== 'case') + opt('case', 'Case number (one CAPTCHA)', TS.scBy === 'case') + '</select></div>';
    if (TS.scBy === 'case') h += '<div class="fg"><label>Case type</label><select id="tsT">' + SCT.filter(function (x) { if (seen[x[0]]) return false; seen[x[0]] = 1; return true; }).map(function (x) { return opt(x[0], x[1], x[0] === TS.sct); }).join('') + '</select></div>';
    h += '<div class="fg"><label>' + (TS.scBy === 'case' ? 'Number' : 'Diary number') + '</label><input id="tsN" value="' + he(TS.n || '') + '"></div><div class="fg"><label>Year</label><input id="tsY" value="' + he(TS.y || '') + '"></div>';
  }
  if (k === 'cat') h += '<div class="fg"><label>Case type</label><select id="tsT">' + [['OA', 'O.A.'], ['MA', 'M.A.'], ['CP', 'C.P.'], ['RA', 'R.A.'], ['TA', 'T.A.'], ['PT', 'P.T.'], ['CCP', 'Cr.C.P.']].map(function (x) { return opt(x[0], x[1], x[0] === TS.t); }).join('') + '</select></div>' +
    '<div class="fg"><label>Number</label><input id="tsN" value="' + he(TS.n || '') + '"></div><div class="fg"><label>Year</label><input id="tsY" value="' + he(TS.y || '') + '"></div>';
  if (k === 'mat') h += '<div class="fg f2"><label>Advocate, party or O.A. number</label><input id="tsQ" value="' + he(TS.q || (window.S && S.tr && S.tr.adv) || 'Charpe') + '"></div>';
  h += '</div><div style="display:flex;gap:10px;align-items:center;margin:6px 0 10px"><button class="btn bg" onclick="tsGo()">&#128269; ' + (k === 'mat' ? 'Search the MAT Nagpur judgments' : 'Look up') + '</button>' +
    (k === 'mat' ? '<span class="mini" style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="tsOld" style="width:auto"' + (TS.old ? ' checked' : '') + '> include judgments before 2025</span>' : '') +
    '<span class="mini">' + (k === 'sc' && TS.scBy === 'case' ? 'One CAPTCHA (a small sum) finds the diary number.' : 'No CAPTCHA needed.') + '</span><span id="tsMsg" class="mini"></span></div><div id="tsRes"></div>';
  el.innerHTML = h; tsRows();
};
function tsMsg(t, col) { var m = document.getElementById('tsMsg'); if (m) { m.style.color = col || '#555'; m.innerHTML = t; } }
window.TS = TS;
window.tsGo = function () {
  var g = function (id) { var e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; };
  TS.n = g('tsN'); TS.y = g('tsY'); TS.t = g('tsT') || 'OA'; TS.q = g('tsQ'); TS.old = g('tsOld');
  var k = SR.court; TS.rows = []; tsMsg('Looking up…');
  if (k === 'mat') {
    var p = TR.mat && TR.matOld === !!TS.old ? Promise.resolve(TR.mat) : matRows(TS.old);
    p.then(function (rows) {
      var q = TS.q.toUpperCase(), refs = caseRefs(TS.q).map(function (r) { return r.key; }), qq = q.replace(/[^A-Z0-9]/g, '');
      TS.rows = rows.filter(function (e) {
        if (refs.length) return e.refs.some(function (r) { return refs.indexOf(r.key) >= 0; });
        return qq.length >= 3 && (e.advocate + ' ' + e.applicant + ' ' + e.caseText + ' ' + e.respondents).toUpperCase().replace(/[^A-Z0-9]/g, '').indexOf(qq) >= 0;
      }).map(function (e) { return { mat: e }; });
      tsMsg(TS.rows.length + ' found in ' + rows.length + ' MAT Nagpur judgments.' + (TS.rows.length ? '' : ' Pending matters are not on this list (it holds judgments only) &mdash; <a href="#" onclick="srManual(\'' + SR.court + '\');return false">Add the case by hand</a>; its daily orders are then picked up by &ldquo;Check MAT Nagpur&rdquo;.'), TS.rows.length ? '#1e8449' : '#a35b00'); tsRows();
    }).catch(function (e) { tsMsg(he(e.message), '#c0392b'); });
    return;
  }
  if (!/^\d+$/.test(TS.n) || !/^\d{4}$/.test(TS.y)) { tsMsg('Give the number and a four-digit year.', '#c0392b'); return; }
  if (k === 'sc' && TS.scBy === 'case') { TS.sct = g('tsT'); tsMsg(''); scCaptcha(null, { type: TS.sct, no: TS.n, year: TS.y }); return; }
  var body = k === 'sc' ? { action: 'sci', diary: TS.n + '/' + TS.y } : { action: 'cat', type: TS.t, no: TS.n, year: TS.y };
  tpost(body).then(function (r) {
    if (r.notFound) { tsMsg(he(r.msg || 'Not found') + ' &mdash; <a href="#" onclick="srManual(\'' + SR.court + '\');return false">Add the case by hand</a>.', '#a35b00'); tsRows(); return; }
    TS.rows = [{ k: k, d: r.data }]; tsMsg('Found.', '#1e8449'); tsRows();
  }).catch(function (e) { tsMsg(he(e.message), '#c0392b'); });
};
function tsRows() {
  var el = document.getElementById('tsRes'); if (!el) return;
  if (!TS.rows.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11.5px"><tbody>' + TS.rows.map(function (r, i) {
    if (r.mat) {
      var e = r.mat;
      return '<tr style="border-bottom:1px solid #eee"><td style="padding:6px"><b>' + he(e.caseText) + '</b><div class="mini">' + fd(e.date) + ' &middot; ' + he(e.district) + '</div></td>' +
        '<td style="padding:6px">' + he(e.applicant) + ' <i>vs.</i> ' + he(e.respondents.slice(0, 90)) + '<div class="mini">Adv. ' + he(e.advocate) + ' &middot; ' + he(e.subject) + ' &middot; ' + he(e.decision) + '</div></td>' +
        '<td style="padding:6px;white-space:nowrap">' + (e.url ? '<a class="btn bo" href="' + he(e.url) + '" target="_blank" rel="noopener">PDF</a> ' : '') +
        (function () {
          var keys = e.refs.map(function (x) { return x.key; }), mine = LC().filter(function (c) { return kind(c) === 'mat' && caseRefs(c.cn || '').some(function (x) { return keys.indexOf(x.key) >= 0; }); })[0];
          if (!mine) return '<button class="btn bg" onclick="trMatAdd(\'ts\',' + i + ')">+ Add</button>';
          var att = mine.eco && mine.eco.ord && mine.eco.ord[hash(e.url || e.caseText + e.date)];
          return '<button class="btn bo" onclick="jumpCase(\'' + mine.id + '\')">Already in the tool &mdash; open</button>' +
            (att ? '' : ' <button class="btn bg" onclick="trMatAttach(' + i + ',\'' + mine.id + '\')">Attach this judgment</button>');
        })() + '</td></tr>';
    }
    var d = r.d, have = LC().filter(function (c) { return kind(c) === r.k && (r.k === 'sc' ? scDiary(c, false) === d.diary : catRef(c) && d.reg && catRef(c).key === (caseRefs(d.reg)[0] || {}).key); })[0];
    var twin = !have && r.k === 'sc' ? LC().filter(function (c) { if (kind(c) !== 'sc' || scDiary(c, false)) return false; var q = scCaseNo(c.cn); return q && (d.reg || '').replace(/\b0+(\d)/g, '$1').indexOf(q.no + ' ') >= 0 && (d.reg || '').indexOf(q.year) >= 0; })[0] : null;
    return '<tr style="border-bottom:1px solid #eee"><td style="padding:6px"><b>' + he(r.k === 'sc' ? 'Diary No. ' + d.diary : d.reg) + '</b><div class="mini">' + he(r.k === 'sc' ? d.reg : (d.place || '') + (d.diary ? ' &middot; Diary ' + d.diary : '')) + '</div></td>' +
      '<td style="padding:6px">' + he(d.pet || '') + ' <i>vs.</i> ' + he(d.res || '') + '<div class="mini">' + he(d.status || '') + (d.next ? ' &middot; next ' + fd(d.next) : '') + (d.decision ? ' &middot; decided ' + fd(d.decision) : '') + ' &middot; ' + (d.orders || []).length + ' orders</div></td>' +
      '<td style="padding:6px;white-space:nowrap">' + (have ? '<button class="btn bo" onclick="jumpCase(\'' + have.id + '\')">Already in the tool &mdash; open</button>'
        : twin ? '<button class="btn bg" onclick="trLink(' + i + ',\'' + twin.id + '\')">This is my case &ldquo;' + he(ctit(twin).slice(0, 40)) + '&rdquo; &mdash; link it</button> <button class="btn bo" onclick="trAdd(' + i + ')">+ Add as new</button>'
        : '<button class="btn bg" onclick="trAdd(' + i + ')">+ Add and fetch</button>') + '</td></tr>';
  }).join('') + '</tbody></table>';
}
window.trAdd = function (i) {
  if (!guard('edit')) return;
  var r = TS.rows[i]; if (!r) return;
  var d = r.d, nc = normCase({});
  var cn = r.k === 'sc' ? ((d.reg || '').split(/Registered/)[0].trim() + ' (Diary No. ' + d.diary + ')').trim() : (caseRefs(d.reg)[0] ? caseRefs(d.reg)[0].type.replace(/^(.)(.)$/, '$1.$2.') + ' ' + caseRefs(d.reg)[0].no + '/' + caseRefs(d.reg)[0].year : d.reg);
  Object.assign(nc, { court: COURT[r.k], cn: cn, cnr: r.k === 'sc' ? (d.cnr || '') : '', pl: d.pet || '', de: d.res || '', st: d.disposed ? 'disposed' : 'active', added: td(), addedBy: cu ? cu.name : '' });
  touch(nc); C.push(nc); saveAll(); logAct('Added from Search Courts: ' + ctit(nc)); refresh();
  toast('Added ' + ctit(nc) + ' — fetching its orders.');
  fetchOne(nc.id, true).then(function () { tsRows(); });
};
window.trLink = function (i, id) {
  if (!guard('edit')) return;
  var r = TS.rows[i], c = find(id); if (!r || !c) return;
  var m = String(r.d.diary || '').match(/(\d+)\/(\d{4})/);
  if (m) c.cnr = 'SCIN01' + ('000000' + m[1]).slice(-6) + m[2];
  touch(c); saveAll(); logAct('Diary No. ' + r.d.diary + ' linked from Search Courts: ' + ctit(c));
  toast('Diary No. ' + r.d.diary + ' saved on ' + ctit(c) + ' — fetching it.');
  fetchOne(c.id, true).then(function () { try { refresh(); } catch (e) {} tsRows(); });
};
window.trMatAttach = function (i, id) {
  var e = (TS.rows[i] || {}).mat, c = find(id); if (!e || !c) return;
  if (attach(c, e)) { saveAll(); api().queueCase(c.id, 'M-' + c.id, -1); toast('Judgment attached to ' + ctit(c) + '.'); }
  try { refresh(); } catch (x) {} tsRows();
};
window.trMatAdd = function (from, i) {
  if (!guard('edit')) return;
  var e = from === 'ts' ? (TS.rows[i] || {}).mat : TR.mine[i]; if (!e) return;
  var r0 = e.refs[0], nc = normCase({});
  Object.assign(nc, { court: COURT.mat, cn: r0 ? 'O.A. ' + e.refs.filter(function (x) { return x.type === 'OA'; }).map(function (x) { return x.no; }).join(', ') + '/' + r0.year : e.caseText,
    pl: e.applicant, de: e.respondents.slice(0, 160), st: 'active', added: td(), addedBy: cu ? cu.name : '' });
  if (!e.refs.filter(function (x) { return x.type === 'OA'; }).length) nc.cn = e.caseText;
  touch(nc); C.push(nc);
  attach(nc, e); saveAll(); logAct('Added from MAT Nagpur: ' + ctit(nc)); refresh();
  api().queueCase(nc.id, 'M-' + nc.id, -1);
  if (from !== 'ts') { TR.mine.splice(i, 1); scTri(); }
  toast('Added ' + ctit(nc) + ' with its judgment.');
};

/* ---------------- start ---------------- */
addTab();
})();
