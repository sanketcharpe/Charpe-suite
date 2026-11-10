/* Case Manager › Settings › "Case numbers & duplicates"  (Nov 2026)
   1. Office serial numbers: number every case once (1, 2, 3 …), shown as a small badge
      beside the case wherever it is listed; new cases take the next number.
   2. Duplicate finder: groups entries that are the same case (same CNR, or same court and
      case number, or — without a case number — same court and same parties), keeps the most
      complete entry of each group and sends the others to Deleted in one click
      (revivable from Deleted for 30 days, like any deletion). */
(function () {
  'use strict';
  var st = document.createElement('style');
  st.textContent = '.snb{display:inline-block;min-width:18px;padding:0 5px;margin-right:4px;border-radius:9px;background:#1a2744;color:#e8c96a;font:700 10px/16px system-ui,Arial,sans-serif;text-align:center;font-style:normal;text-decoration:none;vertical-align:1px}' +
    '@media print{.snb{background:none;color:#000;border:1px solid #000}}' +
    '.ctbox{border:1px solid #d5dbe4;border-radius:6px;padding:12px;margin-bottom:10px;background:#fbfcfe}.ctbox h4{margin:0 0 6px;font-size:12.5px}.ctbox p{font-size:11px;color:#555;margin:4px 0 8px}' +
    '.ctrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11.5px}.ctrow select,.ctrow input{font-size:11.5px;padding:3px 5px}' +
    '.dupg{border:1px solid #e6d3a8;background:#fffaf0;border-radius:6px;padding:7px 9px;margin:6px 0;font-size:11.5px}.dupg .keep{color:#127a4b;font-weight:700}.dupg .drop{color:#a5452f}.dupg li{margin:2px 0}.dupg ul{margin:4px 0 0;padding-left:18px}.duptab{width:100%;border-collapse:collapse}.duptab td{padding:4px 6px;border-top:1px dotted #e6d3a8;vertical-align:top;font-size:11.5px}.duptab tr.keep td{background:#eefaf2}.duptab tr.drop td{color:#7a3b33}.duptab label{white-space:nowrap;cursor:pointer}.duptab input{width:auto}';
  document.head.appendChild(st);

  function live() { return C.filter(function (c) { return !c.del; }); }
  window.snNext = function () { var m = 0; C.forEach(function (c) { if (c.sn > m) m = c.sn; }); return m + 1; };

  /* cases that arrive another way (eCourts import, sync from another computer) also get a number */
  function snFill() {
    if (!S.snOn) return false;
    var miss = live().filter(function (c) { return !c.sn; });
    if (!miss.length) return false;
    miss.sort(function (a, b) { return String(a.added || a.mod || '').localeCompare(String(b.added || b.mod || '')); });
    var n = snNext(); miss.forEach(function (c) { c.sn = n++; touch(c); });
    return true;
  }
  var _refresh = window.refresh;
  if (typeof _refresh === 'function') window.refresh = function () { if (snFill()) saveAll(); return _refresh.apply(this, arguments); };

  var ORDERS = {
    added: { t: 'Date the case was added (oldest first)', f: function (a, b) { return String(a.added || '').localeCompare(String(b.added || '')) || ctit(a).localeCompare(ctit(b)); } },
    court: { t: 'Court, then case number', f: function (a, b) { return String(a.court || '').localeCompare(String(b.court || '')) || yr(a) - yr(b) || num(a) - num(b) || ctit(a).localeCompare(ctit(b)); } },
    year: { t: 'Year of the case, then case number', f: function (a, b) { return yr(a) - yr(b) || num(a) - num(b) || ctit(a).localeCompare(ctit(b)); } },
    party: { t: 'Petitioner / plaintiff name (A–Z)', f: function (a, b) { return ctit(a).localeCompare(ctit(b)); } },
    next: { t: 'Next date (earliest first)', f: function (a, b) { return String(a.nd || '9999').localeCompare(String(b.nd || '9999')); } }
  };
  function yr(c) { var m = String(c.cn || '').match(/(19|20)\d\d(?!.*(19|20)\d\d)/); return m ? +m[0] : 9999; }
  function num(c) { var m = String(c.cn || '').match(/\d+/); return m ? +m[0] : 1e9; }

  window.ctNumber = function () {
    if (!guard('set')) return;
    var how = (document.getElementById('ctOrd') || {}).value || 'added';
    var from = parseInt((document.getElementById('ctFrom') || {}).value, 10) || 1;
    var list = live().slice().sort(ORDERS[how].f);
    var b = document.getElementById('ctNumBtn');
    if (b && !b.dataset.sure && list.some(function (c) { return c.sn; })) {
      b.dataset.sure = '1'; b.textContent = 'Press again to renumber all ' + list.length + ' cases';
      setTimeout(function () { if (b) { delete b.dataset.sure; b.textContent = 'Number all cases'; } }, 6000);
      return;
    }
    C.forEach(function (c) { if (c.del && c.sn) { c.sn = 0; touch(c); } });
    list.forEach(function (c, i) { c.sn = from + i; touch(c); });
    S.snOn = true; S.snOrd = how;
    saveAll(); logAct('Numbered ' + list.length + ' cases (' + ORDERS[how].t + ')');
    toast('Numbered ' + list.length + ' cases, ' + from + ' to ' + (from + list.length - 1) + '.');
    refresh(); renderCT(); if (S.jbKey && typeof push === 'function') push();
  };
  window.ctShow = function (on) {
    if (!guard('set')) return;
    S.snOn = !!on;
    if (on && !live().some(function (c) { return c.sn; })) { ctNumber(); return; }
    saveAll(); refresh(); renderCT();
    toast(on ? 'Case numbers are shown.' : 'Case numbers are hidden (kept, not lost).');
  };

  /* ---------- duplicates ----------
     Sure duplicates: same CNR; or same court and case number; or (no case number) same court and parties.
     Probable duplicates: the same case type, number and year under a differently written court name,
     with a party in common or a note "Connected matter — <that number>" (the eCourts import made one
     entry per co-petitioner). The copy kept is the one most recently brought up to date — judged by
     real activity (last fetch from the court, last hearing, last note), not by the time of saving,
     which Drive sync renews on every case. */
  function k(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function cnKey(c) {
    var s = String(c.cn || '').toLowerCase();
    var nums = s.match(/\d+/g) || [];
    var letters = k(s.replace(/\d+/g, ' ').replace(/\b(no|nos|of|dated|year|case)\b\.?/g, ' '));
    return nums.length ? letters + '|' + nums.map(Number).join('/') : '';
  }
  function courtKey(c) { return k(c.court).replace(/(nagpur|bench|circuit|at|the)/g, ''); }
  function typeNo(c) {
    var s = String(c.cn || ''), m = s.match(/^\s*(.*?)(\d{1,7})\s*(?:\/|of|-)\s*((?:19|20)\d\d)\s*$/i);
    if (!m) return '';
    return k(m[1].replace(/\b(no|nos|of|case|complaint)\b\.?/gi, ' ')) + '|' + (+m[2]) + '|' + m[3];
  }
  var STOP = /^(state|union|india|maharashtra|others|through|corporation|msrtc|divisional|controller|road|transport|manager|general|secretary|government|director|private|limited|pvt|ltd)$/;
  function ptoks(c) { return (String(c.pl || '') + ' ' + String(c.de || '')).toLowerCase().match(/[a-z]{4,}/g) || []; }
  function share(a, b) { var A = {}; ptoks(a).forEach(function (t) { if (!STOP.test(t)) A[t] = 1; }); return ptoks(b).some(function (t) { return A[t]; }); }
  function connected(a, b) { var n = k(b.cn); if (!n) return false; return (a.notes || []).some(function (x) { return /connected matter/i.test(x.text || '') && k(x.text).indexOf(n) >= 0; }); }
  /* the same court written differently: "7th District and Session Court" = "District and Session Court" */
  function courtFam(c) { return String(c.court || '').toLowerCase().replace(/\b\d+(st|nd|rd|th)?\b/g, ' ').replace(/\b(no|court|the|at|nagpur|bench|ad ?hoc|n\/b)\b\.?/g, ' ').replace(/[^a-z]/g, ''); }
  function iso(x) { var m = String(x || '').match(/^\d{4}-\d\d-\d\d/); return m ? m[0] : ''; }
  function activity(c) {
    var e = c.eco || {}, t = td(), ds = [iso(e.at), c.pd && c.pd <= t ? c.pd : ''];
    (c.hist || []).forEach(function (h) { ds.push(iso(h.pd)); ds.push(iso(h.dt)); });
    (e.hh || []).forEach(function (h) { var d = iso(h.bd || h.d); if (d && d <= t) ds.push(d); });
    (c.notes || []).forEach(function (n) { ds.push(iso(n.date)); });
    var last = ds.filter(Boolean).sort().pop() || '';
    var f = ['court', 'cn', 'cnr', 'jd', 'pl', 'de', 'cl', 'cp', 'cm', 'pd', 'ps', 'nd', 'ns'].filter(function (x) { return c[x]; }).length;
    var hh = (e.hh || []).length, ord = Object.keys(e.ord || {}).length, nt = (c.notes || []).length, hs = (c.hist || []).length;
    return { last: last, nd: iso(c.nd), fetched: iso(e.at), hh: hh, ord: ord, notes: nt, hist: hs, score: f + nt * 2 + hs * 2 + (hh + ord) * 3 + (c.cnr ? 5 : 0) + (c.nd ? 3 : 0) };
  }
  function better(a, b) {   /* > 0 when b is more up to date than a */
    var A = activity(a), B = activity(b);
    return String(B.fetched).localeCompare(String(A.fetched)) || String(B.nd).localeCompare(String(A.nd)) || String(B.last).localeCompare(String(A.last)) || B.score - A.score || String(a.added || '').localeCompare(String(b.added || ''));
  }
  function groups() {
    var L = live(), par = {}, keyOwner = {}, soft = {};
    function root(i) { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }
    function join(x, y, probable) { var a = root(x), b = root(y); if (a === b) return; par[b] = a; if (probable || soft[b]) soft[a] = 1; }
    L.forEach(function (c) { par[c.id] = c.id; });
    L.forEach(function (c) {
      var keys = [];
      if (c.cnr && c.cnr.length >= 12) keys.push('cnr:' + c.cnr.toUpperCase());
      var ck = cnKey(c);
      if (ck) keys.push('cn:' + courtKey(c) + ':' + ck);
      else if (c.pl && c.de) keys.push('pt:' + courtKey(c) + ':' + k(c.pl) + ':' + k(c.de));
      keys.forEach(function (key) { if (keyOwner[key]) join(keyOwner[key], c.id, false); else keyOwner[key] = c.id; });
    });
    var byNo = {};
    L.forEach(function (c) { var t = typeNo(c); if (t) (byNo[t] = byNo[t] || []).push(c); });
    Object.keys(byNo).forEach(function (t) {
      var cs = byNo[t];
      for (var i = 0; i < cs.length; i++) for (var j = i + 1; j < cs.length; j++) {
        var a = cs[i], b = cs[j]; if (root(a.id) === root(b.id)) continue;
        if (share(a, b) || (courtFam(a) === courtFam(b) && (connected(a, b) || connected(b, a)))) join(a.id, b.id, true);
      }
    });
    var g = {};
    L.forEach(function (c) { var r = root(c.id); (g[r] = g[r] || []).push(c); });
    return Object.keys(g).filter(function (r) { return g[r].length > 1; }).map(function (r) {
      var x = g[r].slice().sort(better);
      return { cases: x, probable: !!soft[r], keep: x[0].id, drop: x.slice(1).map(function (c) { return c.id; }) };
    });
  }
  var lastScan = null;
  function rowHTML(g, gi, c) {
    var a = activity(c), keep = g.keep === c.id, drop = g.drop.indexOf(c.id) >= 0;
    return '<tr class="' + (keep ? 'keep' : drop ? 'drop' : '') + '">' +
      '<td><label title="Keep this one"><input type="radio" name="ctk' + gi + '" ' + (keep ? 'checked' : '') + ' onchange="ctKeep(' + gi + ',\'' + c.id + '\')"> keep</label></td>' +
      '<td><label title="Delete this one"><input type="checkbox" ' + (drop ? 'checked' : '') + (keep ? ' disabled' : '') + ' onchange="ctDrop(' + gi + ',\'' + c.id + '\',this.checked)"> delete</label></td>' +
      '<td><b>' + he(ctit(c)) + '</b><br><span class="mini">' + he(c.court || '—') + (c.cn ? ' · ' + he(c.cn) : '') + (c.cnr ? ' · CNR ' + he(c.cnr) : ' · <i>no CNR</i>') + (c.added ? ' · added ' + fd(c.added) : '') + '</span></td>' +
      '<td class="mini">' + (a.fetched ? 'fetched ' + fd(a.fetched) : '<i>never fetched</i>') + '<br>last activity ' + (a.last ? fd(a.last) : '—') + '</td>' +
      '<td class="mini">' + a.hh + ' hearings · ' + a.ord + ' orders<br>' + a.notes + ' notes · ' + a.hist + ' dates posted</td>' +
      '<td class="mini">' + (c.nd ? 'next ' + fd(c.nd) : 'no next date') + '</td></tr>';
  }
  function paint() {
    var el = document.getElementById('ctDup'); if (!el || !lastScan) return;
    if (!lastScan.length) { el.innerHTML = '<div style="color:#127a4b;font-size:11.5px;margin-top:6px">&#10004; No duplicate entries among ' + live().length + ' cases.</div>'; return; }
    var n = lastScan.reduce(function (s, g) { return s + g.drop.length; }, 0), pr = lastScan.filter(function (g) { return g.probable; }).length;
    el.innerHTML = '<div style="font-size:11.5px;margin:6px 0"><b>' + lastScan.length + ' case' + (lastScan.length === 1 ? '' : 's') + '</b> appear more than once' + (pr ? ' (' + pr + ' marked <b>probable — check</b>)' : '') +
      '. In each, the copy most recently brought up to date is marked <b>keep</b>; the others are ticked for deletion. Change any tick or the kept copy before deleting. ' +
      'Notes, dates and orders of a deleted copy are carried into the kept one, with a note of the party names it was entered under; deleted copies stay revivable in Deleted.</div>' +
      lastScan.map(function (g, gi) {
        return '<div class="dupg"><div style="margin-bottom:4px"><b>' + he(g.cases[0].cn || ctit(g.cases[0])) + '</b> — ' + g.cases.length + ' entries' +
          (g.probable ? ' <span style="background:#fff1c2;border:1px solid #e8c96a;border-radius:8px;padding:0 6px;font-size:10.5px">probable — check</span>' : '') + '</div>' +
          '<table class="duptab">' + g.cases.map(function (c) { return rowHTML(g, gi, c); }).join('') + '</table></div>';
      }).join('') +
      '<button class="btn br" id="ctDelBtn" onclick="ctDelete()" style="margin-top:6px"' + (n ? '' : ' disabled') + '>&#x2715; Delete the ' + n + ' ticked entr' + (n === 1 ? 'y' : 'ies') + '</button>';
  }
  window.ctScan = function () { lastScan = groups(); paint(); };
  window.ctKeep = function (gi, id) {
    var g = lastScan[gi]; g.keep = id; g.drop = g.cases.filter(function (c) { return c.id !== id; }).map(function (c) { return c.id; }); paint();
  };
  window.ctDrop = function (gi, id, on) {
    var g = lastScan[gi]; g.drop = g.drop.filter(function (x) { return x !== id; }); if (on && id !== g.keep) g.drop.push(id); paint();
  };
  window.ctDelete = function () {
    if (!guard('del', 'You are not allowed to delete records.')) return;
    if (!lastScan) return;
    var who = cu ? (cu.name || cu.username) : '', n = 0, t = now();
    lastScan.forEach(function (g) {
      var keep = find(g.keep); if (!keep) return;
      var names = [];
      g.drop.forEach(function (id) {
        var d = find(id); if (!d || d.del) return;
        ['court', 'cn', 'cnr', 'jd', 'pl', 'de', 'cl', 'cp', 'cm', 'pd', 'ps', 'nd', 'ns', 'imp'].forEach(function (f) { if (!keep[f] && d[f]) keep[f] = d[f]; });
        var ke = keep.eco || {}, de = d.eco || {};
        if (!keep.eco || ((de.hh || []).length > (ke.hh || []).length && !keep.cnr)) { if (d.eco) keep.eco = d.eco; }
        else if (de.ord) { ke.ord = ke.ord || {}; Object.keys(de.ord).forEach(function (x) { if (!ke.ord[x]) ke.ord[x] = de.ord[x]; }); }
        keep.notes = keep.notes || [];
        (d.notes || []).forEach(function (x) { if (!keep.notes.some(function (y) { return y.text === x.text; })) keep.notes.push(x); });
        keep.hist = keep.hist || [];
        (d.hist || []).forEach(function (h) { if (!keep.hist.some(function (y) { return y.pd === h.pd && y.nd === h.nd; })) keep.hist.push(h); });
        if (!keep.sn && d.sn) keep.sn = d.sn;
        if (ctit(d) !== ctit(keep)) names.push(ctit(d) + (d.court && d.court !== keep.court ? ' (' + d.court + ')' : ''));
        d.del = t; d.delBy = who; touch(d); n++;
      });
      if (names.length) keep.notes.push({ text: 'Also entered as: ' + names.join('; ') + ' — duplicate entries merged into this one.', date: td(), by: who });
      touch(keep);
    });
    saveAll(); logAct('Removed ' + n + ' duplicate case entries');
    toast(n + ' duplicate entr' + (n === 1 ? 'y' : 'ies') + ' moved to Deleted (revivable from there).');
    lastScan = null; refresh(); renderCT(); if (S.jbKey && typeof push === 'function') push();
  };

  window.renderCT = function () {
    var el = document.getElementById('tct'); if (!el) return;
    var L = live(), numbered = L.filter(function (c) { return c.sn; }).length;
    el.innerHTML =
      '<div class="ctbox"><h4>&#35; Office serial number for each case</h4>' +
      '<p>Use this when only your own cases are in the tool. Each case gets a number, shown as a small badge beside it in every list and searchable as <b>#12</b>. New cases take the next number.</p>' +
      '<div class="ctrow"><label><input type="checkbox" ' + (S.snOn ? 'checked' : '') + ' onchange="ctShow(this.checked)"> Show case numbers</label>' +
      '<span style="color:#555">' + (numbered ? numbered + ' of ' + L.length + ' cases numbered' : 'Not numbered yet') + '</span></div>' +
      '<div class="ctrow" style="margin-top:8px">Number in the order of <select id="ctOrd">' + Object.keys(ORDERS).map(function (x) { return '<option value="' + x + '"' + ((S.snOrd || 'added') === x ? ' selected' : '') + '>' + ORDERS[x].t + '</option>'; }).join('') + '</select>' +
      ' starting at <input id="ctFrom" type="number" min="1" value="1" style="width:64px">' +
      ' <button class="btn bg" id="ctNumBtn" onclick="ctNumber()">' + (numbered ? 'Renumber all cases' : 'Number all cases') + '</button></div></div>' +
      '<div class="ctbox"><h4>&#9776; Duplicate case entries</h4>' +
      '<p>Finds a case entered more than once — same CNR, same court and case number, or the same case number under a differently written court name — and recommends the less updated copies for deletion. Nothing is deleted until you press the red button.</p>' +
      '<button class="btn bg" onclick="ctScan()">&#128269; Recommend duplicates to delete</button><div id="ctDup"></div></div>';
  };
})();
