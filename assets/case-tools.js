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
    '.dupg{border:1px solid #e6d3a8;background:#fffaf0;border-radius:6px;padding:7px 9px;margin:6px 0;font-size:11.5px}.dupg .keep{color:#127a4b;font-weight:700}.dupg .drop{color:#a5452f}.dupg li{margin:2px 0}.dupg ul{margin:4px 0 0;padding-left:18px}';
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

  /* ---------- duplicates ---------- */
  function k(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function cnKey(c) {
    var s = String(c.cn || '').toLowerCase();
    var nums = s.match(/\d+/g) || [];
    var letters = k(s.replace(/\d+/g, ' ').replace(/\b(no|nos|of|dated|year|case)\b\.?/g, ' '));
    return nums.length ? letters + '|' + nums.map(Number).join('/') : '';
  }
  function courtKey(c) { return k(c.court).replace(/(nagpur|bench|circuit|at|the)/g, ''); }
  function score(c) {
    var f = ['court', 'cn', 'cnr', 'jd', 'pl', 'de', 'cl', 'cp', 'cm', 'pd', 'ps', 'nd', 'ns'].filter(function (x) { return c[x]; }).length;
    var e = c.eco || {};
    return f + (c.notes || []).length * 2 + (c.hist || []).length * 2 + ((e.hh || []).length + (e.ord || []).length) * 3 + (c.imp ? 1 : 0);
  }
  function groups() {
    var L = live(), par = {}, keyOwner = {};
    function root(i) { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }
    L.forEach(function (c) { par[c.id] = c.id; });
    L.forEach(function (c) {
      var keys = [];
      if (c.cnr && c.cnr.length >= 12) keys.push('cnr:' + c.cnr.toUpperCase());
      var ck = cnKey(c);
      if (ck) keys.push('cn:' + courtKey(c) + ':' + ck);
      else if (c.pl && c.de) keys.push('pt:' + courtKey(c) + ':' + k(c.pl) + ':' + k(c.de));
      keys.forEach(function (key) {
        if (keyOwner[key]) { var a = root(keyOwner[key]), b = root(c.id); if (a !== b) par[b] = a; }
        else keyOwner[key] = c.id;
      });
    });
    var g = {};
    L.forEach(function (c) { var r = root(c.id); (g[r] = g[r] || []).push(c); });
    return Object.keys(g).map(function (r) { return g[r]; }).filter(function (x) { return x.length > 1; }).map(function (x) {
      x.sort(function (a, b) { return score(b) - score(a) || String(a.added || '').localeCompare(String(b.added || '')); });
      return x;
    });
  }
  var lastScan = null;
  window.ctScan = function () {
    lastScan = groups();
    var el = document.getElementById('ctDup'); if (!el) return;
    if (!lastScan.length) { el.innerHTML = '<div style="color:#127a4b;font-size:11.5px;margin-top:6px">&#10004; No duplicate entries among ' + live().length + ' cases.</div>'; return; }
    var n = lastScan.reduce(function (s, g) { return s + g.length - 1; }, 0);
    el.innerHTML = '<div style="font-size:11.5px;margin:6px 0"><b>' + lastScan.length + ' case' + (lastScan.length === 1 ? '' : 's') + '</b> entered more than once — <b>' + n + '</b> extra entr' + (n === 1 ? 'y' : 'ies') + '. The fullest entry of each is kept (green); blanks in it are filled from the others.</div>' +
      lastScan.map(function (g) {
        return '<div class="dupg"><ul>' + g.map(function (c, i) {
          return '<li class="' + (i ? 'drop' : 'keep') + '">' + (i ? '&#x2715; remove: ' : '&#10004; keep: ') + he(ctit(c)) + ' <span style="color:#555;font-weight:400">— ' + he(c.court || '—') + (c.cn ? ' · ' + he(c.cn) : '') + (c.cnr ? ' · ' + he(c.cnr) : '') + (c.nd ? ' · next ' + fd(c.nd) : '') + (c.added ? ' · added ' + fd(c.added) : '') + '</span></li>';
        }).join('') + '</ul></div>';
      }).join('') +
      '<button class="btn br" id="ctDelBtn" onclick="ctDelete()" style="margin-top:6px">&#x2715; Delete the ' + n + ' duplicate entr' + (n === 1 ? 'y' : 'ies') + '</button>';
  };
  window.ctDelete = function () {
    if (!guard('del', 'You are not allowed to delete records.')) return;
    if (!lastScan) return;
    var who = cu ? (cu.name || cu.username) : '', n = 0, t = now();
    lastScan.forEach(function (g) {
      var keep = g[0];
      g.slice(1).forEach(function (d) {
        ['court', 'cn', 'cnr', 'jd', 'pl', 'de', 'cl', 'cp', 'cm', 'pd', 'ps', 'nd', 'ns', 'imp'].forEach(function (f) { if (!keep[f] && d[f]) keep[f] = d[f]; });
        if (!keep.eco && d.eco) keep.eco = d.eco;
        if (!keep.sn && d.sn) keep.sn = d.sn;
        d.del = t; d.delBy = who; touch(d); n++;
      });
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
      '<p>Finds a case entered more than once: same CNR, or same court and case number, or (without a case number) same court and same parties.</p>' +
      '<button class="btn bo" onclick="ctScan()">Find duplicates</button><div id="ctDup"></div></div>';
  };
})();
