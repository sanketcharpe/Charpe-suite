/* MAT Nagpur daily orders: one PDF per sitting day holds every order passed that day.
   Each order begins "O.A. 74/2026 (D.B.) Coram : …" (or "R.A.No.23/2025 in O.A.No.816/2023 (S.B.)").
   matSplit(pages) → the orders found, each with its case keys, page range and text.  */
(function (root) {
'use strict';
var TYPE = /(?:M\s*\.?\s*C\s*\.?\s*A|O\s*\.?\s*A\s*\.?\s*s?|R\s*\.?\s*A|M\s*\.?\s*A|C\s*\.?\s*A|C\s*\.?\s*P|T\s*\.?\s*A|REV(?:IEW)?\s*\.?\s*A(?:PPL(?:ICATION|N)?)?|ORIGINAL\s+APPLICATIONS?|CONTEMPT\s+PETITIONS?|MISC(?:ELLANEOUS)?\.?\s+APPLICATIONS?)\s*\.?/i;
/* "(S.B.)" / "(D.B.)" — or bare "D.B." when "Coram" follows soon after */
var MARK = /\(\s*[SD]\s*\.?\s*B\s*\.?\s*\)|(?<![A-Za-z])[SD]\s*\.\s*B\s*\.(?=[\s\S]{0,250}?C\s*o\s*r\s*a\s*m)/gi;
/* the case-number group just before a marker: case types, numbers and connectors only;
   a new case type straight after a year starts a new group (the previous order's tail) */
/* the PDFs' text sometimes breaks words and numbers ("w ith", "O.A.13 8 1/26" = O.A. 1381/26) */
function mend(t) { return t.replace(/(\d)\s*(in|with|and)\s*(?=[A-Z]\.?)/gi, '$1 $2 ').replace(/\b([A-Za-z])\s+(ith|n|f|nd)\b/g, function (m0, a, b) { return /^(w|i|o|a)$/i.test(a) ? a + b : m0; }); }
function headBefore(pre) {
  pre = mend(pre);
  var allowed = new RegExp('((?:' + TYPE.source + '|\\bNos?\\b\\.?|\\bin\\b|\\bwith\\b|\\band\\b|\\bof\\b|[\\d\\s,&\\/.\\-])+)$', 'i');
  var m = pre.match(allowed); if (!m) return '';
  var g = m[1], re = new RegExp(TYPE.source, 'gi'), x, cut = 0;
  while ((x = re.exec(g))) { if (/\d{2,4}\s*$/.test(g.slice(0, x.index))) cut = x.index; }
  return g.slice(cut).replace(/(\d)\s+(?=\d)/g, '$1').trim();
}
function matSplit(pages, refs) {
  var heads = [];
  pages.forEach(function (t, p) {
    var re = new RegExp(MARK.source, 'gi'), m;
    while ((m = re.exec(t))) {
      var s0 = Math.max(0, m.index - 140), win = t.slice(s0, m.index), h = headBefore(win);
      if (!h || !/\d/.test(h)) continue;
      heads.push({ p: p, i: Math.max(s0, m.index - h.length - 12), head: h, keys: refs(h).map(function (r) { return r.key; }) });
    }
    /* an order with no (S.B.)/(D.B.) at all: read the case number just before "Coram" (party names in brackets skipped) */
    var cr = /C\s*o\s*r\s*a\s*m/gi, cm, mine = heads.filter(function (x) { return x.p === p; });
    while ((cm = cr.exec(t))) {
      var at = cm.index;
      if (mine.some(function (x) { return x.i <= at && at - x.i < 400; })) continue;
      var pre = t.slice(Math.max(0, at - 220), at).replace(/\s*[:\-]?\s*$/, '');
      for (var z = 0; z < 2; z++) pre = pre.replace(/\([^()]*\)\s*$/, '');
      var h3 = headBefore(pre);
      if (!h3 || !/\d/.test(h3) || !refs(h3).length) continue;
      var hd = { p: p, i: Math.max(0, at - 220 + pre.lastIndexOf(h3.slice(0, 6))), head: h3, keys: refs(h3).map(function (r) { return r.key; }) };
      heads.push(hd); mine.push(hd);
    }
  });
  heads.sort(function (x, y) { return x.p - y.p || x.i - y.i; });
  return heads.map(function (h, k) {
    var nx = heads[k + 1], last = nx ? (nx.i > 40 ? nx.p : nx.p - 1) : pages.length - 1;
    if (last < h.p) last = h.p;
    var pg = []; for (var q = h.p; q <= last; q++) pg.push(q);
    var txt = '';
    pg.forEach(function (q) {
      var t = pages[q], a = q === h.p ? h.i : 0, b = nx && q === nx.p ? nx.i : t.length;
      txt += (txt ? ' ' : '') + t.slice(a, Math.max(a, b));
    });
    return { head: h.head, keys: h.keys, pages: pg, text: txt.replace(/\s+/g, ' ').trim() };
  });
}
var api = { matSplit: matSplit, headBefore: headBefore };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else { root.matSplit = matSplit; root.matHeadBefore = headBefore; }
})(this);
