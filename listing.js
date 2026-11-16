/* ============================================================================
   CHARPE SUITE — COURT POSITIONS ON THE DAY BOARD                        Nov 2026
   ----------------------------------------------------------------------------
   One button on every day board ("Court positions") does, for that date:

   District Court, Nagpur (nagpur.dcourts.gov.in)
     1. reads the List of Judges (name, designation, room) and Judges on Leave as
        they stand that day, and the court list of every court complex;
     2. for each matter, takes the court number from its eCourts status
        ("205-10th Jt. Civil Judge Senior Division …") and the establishment from
        its CNR (MHNG03…), finds the judge sitting in that court today, the
        designation and the room, and whether the judge is on leave;
     3. asks for ONE CAPTCHA per court (all on one screen, one Submit), reads each
        court's cause list and finds the serial number of each matter.

   High Court, Nagpur Bench (bombayhighcourt.gov.in) — no CAPTCHA
     reads every PDF cause list of the day, finds each matter: court, serial
     number, the stage it is listed for, any remark against it, the court's
     special notes, and a breakdown of the board (Orders 1–18 · Admission 19–64 …).

   MAT Nagpur (board display) and CAT Mumbai (Nagpur sittings): the same, from
   their published lists.

   Everything that is found goes onto the board for that day (screen, print,
   PDF, Word). Court notes can be struck out by staff; a struck note stays on
   screen (crossed out, restorable) and is left off the printout.

   Fetching is done by Charpe Helper on the PC (v14+) or by the phone app's own
   engine, from the office's own internet connection: the court sites turn
   away other servers. Nothing is sent anywhere else.
   ========================================================================== */
(function () {
  'use strict';

  var HELPER = 'http://127.0.0.1:8770/';
  var NEED_HELPER = 14;
  var DCB = 'https://nagpur.dcourts.gov.in';
  var DC_AJAX = DCB + '/wp-admin/admin-ajax.php';
  var DC_CL = DCB + '/cause-list-%e2%81%84-daily-board/';
  var BHC = 'https://bombayhighcourt.gov.in/bhc/';
  var MAT_API = 'https://uatmat.mahaitgov.in/api/board-display';
  var MAT_FILES = 'https://uatmat.mahaitgov.in/storage/boarddisp/';
  var CAT_API = 'https://cgat.gov.in/catapi/getcatCauselist';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_W = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var CRYPTOJS = 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js';
  var KEEP_DAYS = 45;

  /* ------------------------------------------------------------ small helpers */
  function esc(s) { return (typeof he === 'function') ? he(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function str(x) { return x == null ? '' : String(x); }
  function z2(n) { n = parseInt(n, 10); return (n < 10 ? '0' : '') + n; }
  function dmy(iso, sep) { var p = String(iso).split('-'); return p[2] + (sep || '/') + p[1] + (sep || '/') + p[0]; }
  function isoOf(s) { var m = String(s || '').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); return m ? m[3] + '-' + z2(m[2]) + '-' + z2(m[1]) : ''; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var TA = null;
  function unent(h) { h = String(h == null ? '' : h); if (h.indexOf('&') < 0) return h; TA = TA || document.createElement('textarea'); TA.innerHTML = h; return TA.value; }
  function strip(h) {
    h = String(h == null ? '' : h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n');
    h = unent(h.replace(/<[^>]+>/g, ' ')).replace(/ /g, ' ');
    return h.replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function one(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function user() { try { return (window.cu && (cu.name || cu.username)) || 'staff'; } catch (e) { return 'staff'; } }
  function tbls(h) {
    var out = [], m, rx = /<table([^>]*)>([\s\S]*?)<\/table>/gi;
    while ((m = rx.exec(h))) {
      var rows = [], r, rr = /<tr([^>]*)>([\s\S]*?)<\/tr>/gi;
      while ((r = rr.exec(m[2]))) {
        var cells = [], c, rc = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
        while ((c = rc.exec(r[2]))) cells.push({ th: c[1] === 'h', attr: c[2], raw: c[3], t: one(strip(c[3])) });
        rows.push({ attr: r[1], raw: r[2], cells: cells });
      }
      out.push({ attr: m[1], rows: rows, raw: m[0] });
    }
    return out;
  }

  /* ------------------------------------------------------------ the helper (PC) or the phone's engine */
  function hp(body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 180000) : 0;
    return fetch(HELPER, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(t); return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Charpe Helper reported a problem'); return j; })
      .catch(function (e) {
        if (/Failed to fetch|NetworkError|aborted|Load failed/i.test(e && e.message || '')) throw new Error('Charpe Helper on this PC is not answering. Open 127.0.0.1:8770 in Chrome to check it is running, then try again.');
        throw e;
      });
  }
  var HV = { v: 0, at: 0 };
  function helperReady() {
    if (HV.v >= NEED_HELPER && Date.now() - HV.at < 600000) return Promise.resolve(HV.v);
    return hp({ action: 'ping' }, 8000).then(function (j) {
      HV.v = +j.helper || 0; HV.at = Date.now();
      if (HV.v < NEED_HELPER) throw new Error('Charpe Helper on this PC is version ' + HV.v + '; court positions need version ' + NEED_HELPER +
        ' or later. Install the new helper (double-click "Install Charpe Helper.bat" from the latest Charpe-Helper folder), then try again.');
      return HV.v;
    });
  }
  /* a "job" keeps one cookie jar at the helper across its calls */
  function Job() { this.wid = ''; }
  Job.prototype.get = function (url, o) {
    var self = this; o = o || {};
    return hp({ action: 'wget', wid: this.wid, url: url, referer: o.ref, xhr: !!o.xhr, bin: !!o.bin, headers: o.h || {} }).then(function (r) { self.wid = r.wid; return r; });
  };
  Job.prototype.post = function (url, form, o) {
    var self = this; o = o || {};
    var b = { action: 'wpost', wid: this.wid, url: url, referer: o.ref, xhr: !!o.xhr, bin: !!o.bin, headers: o.h || {} };
    if (Array.isArray(form)) b.pairs = form; else b.form = form || {};
    if (o.multipart) b.multipart = true;
    return hp(b).then(function (r) { self.wid = r.wid; return r; });
  };
  Job.prototype.drop = function () { if (this.wid) hp({ action: 'wdrop', wid: this.wid }).catch(function () {}); };

  /* ------------------------------------------------------------ libraries (loaded only when needed) */
  var libs = {};
  function lib(url, test) {
    if (test()) return Promise.resolve();
    if (libs[url]) return libs[url];
    return (libs[url] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = url;
      s.onload = function () { res(); };
      s.onerror = function () { libs[url] = null; rej(new Error('A reader library could not load — check the internet connection.')); };
      document.head.appendChild(s);
    }));
  }
  function pdfjs() { return lib(PDFJS, function () { return !!window.pdfjsLib; }).then(function () { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_W; }); }
  function b64bytes(b64) { var s = atob(b64 || ''), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  /* a PDF as lines of text, top to bottom, page by page (items on one baseline joined) */
  function pdfLines(bytes) {
    return pdfjs().then(function () { return pdfjsLib.getDocument({ data: bytes }).promise; }).then(function (doc) {
      var lines = [], p = 1;
      function next() {
        if (p > doc.numPages) return lines;
        var pn = p++;
        return doc.getPage(pn).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var rows = [];
          tc.items.forEach(function (it) {
            if (!it.str || !it.str.trim()) return;
            var y = it.transform[5], x = it.transform[4], row = null;
            for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) < 2.5) { row = rows[i]; break; }
            if (!row) { row = { y: y, items: [] }; rows.push(row); }
            row.items.push({ x: x, s: it.str, w: it.width || 0 });
          });
          rows.sort(function (a, b) { return b.y - a.y; });
          rows.forEach(function (r) {
            r.items.sort(function (a, b) { return a.x - b.x; });
            var t = '', end = null;
            r.items.forEach(function (it) {
              if (end !== null) t += (it.x - end > 1.5 ? (it.x - end > 18 ? '   ' : ' ') : '');
              t += it.s; end = it.x + it.w;
            });
            lines.push({ p: pn, x: r.items[0].x, t: t.replace(/\s+$/, '') });
          });
          return next();
        });
      }
      return next();
    });
  }

  /* ------------------------------------------------------------ names and designations */
  var HON = /^(shri|smt|sau|kum|ms|mrs|mr|dr|hon'?ble|justice|the)\.?$/i;
  function nameKey(n) {
    var t = String(n || '').replace(/^\s*\d+\s+/, '').replace(/[.,]/g, ' ').replace(/\s+-\s+.*$/, '').split(/\s+/).filter(function (w) { return w && !HON.test(w); });
    if (!t.length) return null;
    var sur = t[t.length - 1].toLowerCase().split('-').pop();
    var ini = [];
    t.slice(0, -1).forEach(function (w) { ini.push(w.charAt(0).toLowerCase()); });
    return { sur: sur, ini: ini, all: t.join(' ').toLowerCase() };
  }
  function sameName(a, b) {
    var x = nameKey(a), y = nameKey(b);
    if (!x || !y || x.sur !== y.sur) return 0;
    if (!x.ini.length || !y.ini.length) return 1;
    var n = Math.min(x.ini.length, y.ini.length), hit = 0;
    for (var i = 0; i < n; i++) if (x.ini[i] === y.ini[i]) hit++;
    return hit === n ? 3 : (x.ini[0] === y.ini[0] ? 2 : 0);
  }
  var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  /* "10th Jt. Civil Judge Senior Division & ACJM, Nagpur" -> {n:10, k:'cjsd'} */
  function desKey(d) {
    var s = ' ' + String(d || '').toLowerCase().replace(/&/g, ' and ').replace(/[.,()]/g, ' ').replace(/\s+/g, ' ') + ' ';
    var k = '';
    if (/principal district/.test(s)) k = 'pdj';
    else if (/ad[- ]?hoc district/.test(s)) k = 'adhocdj';
    else if (/extra j(oin)?t district|extra joint district/.test(s)) k = 'extradj';
    else if (/m ?a ?c ?t|motor accident/.test(s)) k = 'mact';
    else if (/district judge/.test(s)) k = 'dj';
    else if (/small cause/.test(s)) k = /2nd addl|second addl/.test(s) ? 'sc2' : (/addl|additional/.test(s) ? 'sc1' : 'sc');
    else if (/chief judicial magistrate/.test(s) && !/civil judge/.test(s)) k = /2nd/.test(s) ? 'acjm2' : (/addl|additional/.test(s) ? 'acjm' : 'cjm');
    else if (/civil judge/.test(s) && /(senior|sr) ?d(iv(ision)?|n)?\b|\bcjsd\b|sr dn|sr div/.test(s)) k = 'cjsd';
    else if (/civil judge/.test(s) && /(junior|jr) ?d(iv(ision)?|n)?\b|\bcjjd\b|jr dn/.test(s)) k = 'cjjd';
    else if (/\bcjsd\b/.test(s)) k = 'cjsd';
    else if (/\bcjjd\b/.test(s)) k = 'cjjd';
    else if (/railway/.test(s)) k = 'rly';
    else if (/m ?v|motor vehicle/.test(s) && /jmfc|magistrate|j m f c/.test(s)) k = 'mv';
    else if (/juvenile/.test(s)) k = 'jjb';
    var n = 0, m = s.match(/(\d+)\s*(?:st|nd|rd|th)\b/) || s.match(/(?:judge|no|court|tribunal)\s*[-–]?\s*(\d+)\b/);
    if (m) n = +m[1];
    else { var w = s.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/); if (w) n = ORD[w[1]]; }
    var place = (s.match(/\b(nagpur|katol|saoner|ramtek|umred|umrer|kamptee|narkhed|kuhi|kalmeshwar|hingna|mouda|bhiwapur|parshioni|parseoni|paresoni)\b/) || [])[1] || '';
    place = place.replace(/umrer/, 'umred').replace(/parseoni|paresoni/, 'parshioni');
    if ((k === 'cjsd' || k === 'cjjd') && !n && !/\bjt\b|joint/.test(s)) n = 0;
    return { k: k, n: n, place: place || 'nagpur', jt: /\bjt\b|joint/.test(s) };
  }
  function sameDes(a, b) {
    var x = desKey(a), y = desKey(b);
    if (!x.k || x.k !== y.k || x.place !== y.place) return false;
    if (x.n !== y.n) {
      /* "Civil Judge Senior Division, Nagpur" (no ordinal) vs "Jt. Civil Judge Sr. Dn." (no ordinal) are different courts */
      return false;
    }
    if (!x.n && x.jt !== y.jt) return false;
    return true;
  }

  /* ------------------------------------------------------------ case numbers */
  var TYPE_ALIAS = [
    [/\bwrit\s+petitions?\b|\bw\.?\s*p\.?\b/g, 'WP'], [/\bfirst\s+appeals?\b|\bf\.?\s*a\.?\b/g, 'FA'], [/\bsecond\s+appeals?\b|\bs\.?\s*a\.?\b/g, 'SA'],
    [/\bletters?\s+patent\s+appeals?\b|\bl\.?\s*p\.?\s*a\.?\b/g, 'LPA'], [/\bcriminal\s+appeals?\b|\bcr(?:i|l)?\.?\s*a(?:ppeal|pl)?\.?\b|\bapeal\b/g, 'APEAL'],
    [/\bcriminal\s+applications?\b|\bcr(?:i|l)\.?\s*appln?\b|\bapl\b/g, 'APL'], [/\bcivil\s+applications?\b/g, 'CA'],
    [/\bcivil\s+revision\s+applications?\b|\bc\.?\s*r\.?\s*a\.?\b/g, 'CRA'], [/\bcriminal\s+revision\s+applications?\b|\bcri\.?\s*rev(?:ision)?\b|\brevn\b/g, 'REVN'],
    [/\bcontempt\s+petitions?\b|\bc\.?\s*p\.?\b/g, 'CP'], [/\boriginal\s+applications?\b|\bo\.?\s*a\.?\b/g, 'OA'],
    [/\bmisc(?:ellaneous)?\.?\s+civil\s+applications?\b|\bm\.?\s*c\.?\s*a\.?\b/g, 'MCA'], [/\bmisc(?:ellaneous)?\.?\s+applications?\b|\bm\.?\s*a\.?\b/g, 'MA'],
    [/\breview\s+applications?\b|\br\.?\s*a\.?\b/g, 'RA'], [/\bregular\s+civil\s+suits?\b|\br\.?\s*c\.?\s*s\.?\b/g, 'RCS'],
    [/\bspecial\s+civil\s+suits?\b|\bs\.?\s*c\.?\s*s\.?\b/g, 'SCS'], [/\bsummary\s+civil\s+suits?\b|\bsum\.?\s*s(?:uit)?\b/g, 'SUMS'],
    [/\bregular\s+civil\s+appeals?\b|\br\.?\s*c\.?\s*a\.?\b/g, 'RCA'], [/\bregular\s+criminal\s+cases?\b|\br\.?\s*c\.?\s*c\.?\b/g, 'RCC'],
    [/\bsummary\s+criminal\s+cases?\b|\bs\.?\s*c\.?\s*c\.?\b/g, 'SCC'], [/\bsessions?\s+cases?\b|\bs\.?\s*c\.?\b/g, 'SC'],
    [/\bmotor\s+accident\s+claim\s+petitions?\b|\bm\.?\s*a\.?\s*c\.?\s*p\.?\b/g, 'MACP'], [/\bmisc(?:ellaneous)?\.?\s+criminal\s+applications?\b|\bm\.?\s*c\.?\s*a\.?\b/g, 'MCA'],
    [/\bland\s+acquisition\s+cases?\b|\bl\.?\s*a\.?\s*c\.?\b/g, 'LAC'], [/\bcivil\s+misc(?:ellaneous)?\.?\s+applications?\b|\bc\.?\s*m\.?\s*a\.?\b/g, 'CMA'],
    [/\bcomplaint\s*\(?ulp\)?\b|\bulp\b/g, 'ULP'], [/\bcriminal\s+misc(?:ellaneous)?\.?\s+applications?\b|\bcri\.?\s*m\.?\s*a\.?\b/g, 'CRIMA'],
    [/\bexecution\s+petitions?\b|\bdarkhast\b|\be\.?\s*p\.?\b/g, 'EP'], [/\bhindu\s+marriage\s+petitions?\b|\bh\.?\s*m\.?\s*p\.?\b/g, 'HMP'],
    [/\bpetitions?\s*a\b/g, 'PA'], [/\bcivil\s+appeals?\b/g, 'CIVA']
  ];
  /* every (type, number, year) the text names; type '' if none can be told */
  function refs(text) {
    var t = ' ' + String(text || '').replace(/[\[\]]/g, ' ').replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})\b/g, ' ') + ' ', out = [], seen = {};
    var rx = /([A-Za-z][A-Za-z.()\s]{0,40}?)?\s*(?:No\.?\s*|Nos\.?\s*)?(?:st\.?\s*)?(\d{1,6})\s*(?:\/|of|-)\s*(\d{4}|\d{2})(?![\d])/gi, m;
    while ((m = rx.exec(t))) {
      var y = +m[3]; if (y < 100) y += y > 60 ? 1900 : 2000;
      if (y < 1950 || y > 2100) continue;
      var ty = typeOf(m[1] || '');
      var k = ty + '|' + (+m[2]) + '|' + y;
      if (!seen[k]) { seen[k] = 1; out.push({ type: ty, no: +m[2], year: y }); }
    }
    /* "WP/3692/2026" style */
    var rx2 = /\b([A-Z][A-Z.()]{0,12})\s*\/\s*(?:ST\.?)?(\d{1,6})\s*\/\s*(\d{4})\b/g;
    while ((m = rx2.exec(t.toUpperCase()))) {
      var ty2 = typeOf(m[1]), k2 = ty2 + '|' + (+m[2]) + '|' + m[3];
      if (!seen[k2]) { seen[k2] = 1; out.push({ type: ty2, no: +m[2], year: +m[3] }); }
    }
    return out;
  }
  function typeOf(s) {
    var t = ' ' + String(s || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    for (var i = 0; i < TYPE_ALIAS.length; i++) { TYPE_ALIAS[i][0].lastIndex = 0; if (TYPE_ALIAS[i][0].test(t)) return TYPE_ALIAS[i][1]; }
    var w = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
    return w.length >= 2 && w.length <= 8 ? w : '';
  }
  function typeOk(a, b) { if (!a || !b) return true; if (a === b) return true; return a.indexOf(b) === 0 || b.indexOf(a) === 0; }
  function caseRefsOf(c) {
    var src = [c.cn, c.eco && c.eco.reg, c.eco && c.eco.cn, c.ct ? c.ct + ' ' + c.cn : ''].filter(Boolean).join(' ; ');
    return refs(src);
  }
  function refHit(mine, theirs) {
    var best = null;
    for (var i = 0; i < mine.length; i++) for (var j = 0; j < theirs.length; j++) {
      var a = mine[i], b = theirs[j];
      if (a.no === b.no && a.year === b.year && typeOk(a.type, b.type)) {
        var ex = !!(a.type && b.type && a.type === b.type);
        if (!best || (ex && !best.exact)) best = { exact: ex, ref: b };
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ which forum a case belongs to */
  function forum(c) {
    var g = (typeof courtGroup === 'function') ? courtGroup(c) : '';
    var k = '';
    try { k = window.trKind ? trKind(c) : ''; } catch (e) {}
    var cnr = str(c.cnr).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (g === 'hc' || /^HCBM/.test(cnr)) return 'hc';
    if (k === 'cat' || g === 'cat') return 'cat';
    if (k === 'mat' || g === 'mat') return 'mat';
    if (/^MHNG\d{2}/.test(cnr)) return 'dc';
    if (g === 'dist') return 'dc';
    return '';
  }
  function dcCourtNo(c) {
    var j = str(c.eco && c.eco.judge);
    var m = j.match(/^\s*(\d{1,4})\s*[-–:]/) || j.match(/court\s*(?:no\.?|number)\s*(\d{1,4})/i);
    return m ? m[1] : '';
  }
  function dcEst(c) { var cnr = str(c.cnr).toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^MHNG\d{2}/.test(cnr) ? cnr.slice(0, 6) : ''; }
  var CRIM = /crim|\bcri\b|\bcrl\b|session|\bs\.?\s*c\.?\s*c\b|\br\.?\s*c\.?\s*c\b|bail|n\.?\s*i\.?\s*act|\b138\b|\bd\.?\s*v\.?\b|domestic violence|juvenile|\bm\.?\s*c\.?\s*a\b|magistrate|\bspl\.?\s*case|\bpocso|\bndps|\bcr\.?\s*m\.?\s*a|\bs\.?\s*t\.?\s*c\b|\bexcise/i;
  function guessCivCri(c) {
    var s = [c.cn, c.ct, c.eco && c.eco.ctype, c.eco && c.eco.reg, c.court].filter(Boolean).join(' ');
    if (/civil|suit|r\.?\s*c\.?\s*s|s\.?\s*c\.?\s*s|darkhast|execution|hindu marriage|m\.?\s*a\.?\s*c\.?\s*p|land acquisition|probate|succession/i.test(s) && !/criminal/i.test(s)) return '2';
    return CRIM.test(s) ? '3' : '2';
  }

  /* ------------------------------------------------------------ store (inside S, so it syncs with everything else) */
  function store() {
    if (!window.S) return {};
    S.lst = S.lst || {};
    var cut = typeof shift === 'function' ? shift(td(), -KEEP_DAYS) : '';
    Object.keys(S.lst).forEach(function (d) { if (cut && d < cut) delete S.lst[d]; });
    return S.lst;
  }
  function day(iso, make) { var st = store(); if (!st[iso] && make) st[iso] = { at: '', cases: {}, courts: {} }; return st[iso] || null; }
  function save() { try { if (typeof saveAll === 'function') saveAll(); } catch (e) {} }

  /* ================================================================ DISTRICT COURT */
  var DCK = { at: 0, judges: null, leave: null, courts: {}, page: null };

  function parseJudgeRows(rows, sec) {
    var out = [];
    rows.forEach(function (r) {
      var cs = r.cells.filter(function (c) { return !c.th; });
      if (cs.length < 3) return;
      var name = '', des = '', room = '';
      /* columns: picture, name, designation, room (picture may be missing) */
      var off = cs.length >= 4 ? cs.length - 3 : 0;
      name = cs[off].t; des = cs[off + 1].t; room = cs[off + 2] ? cs[off + 2].t : '';
      if (!name || /^vacant$/i.test(name)) { if (des) out.push({ name: '', des: des, room: room, sec: sec, vacant: true }); return; }
      out.push({ name: name, des: des, room: room, sec: sec });
    });
    return out;
  }
  function dcJudges(job, log) {
    return job.get(DCB + '/list-of-judges/').then(function (r) {
      var h = r.text || '';
      var nonce = (h.match(/class="ww_html"[^>]*data-nonce="([^"]+)"/) || [])[1] || '';
      var prof = (h.match(/class="ww_html"[^>]*data-profile="([^"]*)"/) || [])[1] || '1';
      var filt = (h.match(/class="ww_html"[^>]*data-filter="([^"]*)"/) || [])[1] || 'name,designation,room_number';
      var show = (h.match(/id="show_link_or_not"\s+value="([^"]*)"/) || [])[1] || '0';
      var parts = h.split(/<div class="whoswho"/).slice(1);
      var all = [], more = [];
      parts.forEach(function (p) {
        var id = (p.match(/data-id="(\d+)"/) || [])[1], sec = unent((p.match(/data-name="([^"]*)"/) || [])[1] || '');
        var t = tbls(p)[0];
        if (t) all = all.concat(parseJudgeRows(t.rows, sec));
        var pg = p.match(/class="paged">\s*(\d+)\s*<\/span>\s*of\s*(\d+)/);
        if (pg && +pg[2] > 1) for (var k = 1; k < +pg[2]; k++) more.push({ id: id, sec: sec, paged: k });
      });
      var p = Promise.resolve();
      more.forEach(function (m) {
        p = p.then(function () {
          return job.post(DC_AJAX, { action: 'judge_pages', paged: m.paged, tax_slug: m.id, type: 'next', profile_image: prof, filter: filt, show_link: show, security: nonce },
            { ref: DCB + '/list-of-judges/', xhr: true }).then(function (x) {
            var j; try { j = JSON.parse(x.text); } catch (e) { j = null; }
            var rows = j && j.html;
            if (!rows) return;
            Object.keys(rows).forEach(function (k) {
              var o = rows[k], name = '', des = '', room = '';
              Object.keys(o).forEach(function (col) {
                var v = one(strip(o[col])), c = col.toLowerCase();
                if (/name/.test(c)) name = v; else if (/design/.test(c)) des = v; else if (/room/.test(c)) room = v;
              });
              if (name || des) all.push({ name: /^vacant$/i.test(name) ? '' : name, des: des, room: room, sec: m.sec, vacant: /^vacant$/i.test(name) });
            });
          }).catch(function (e) { log('List of judges: page ' + (m.paged + 1) + ' of "' + m.sec + '" could not be read (' + e.message + ')', 'warn'); });
        });
      });
      return p.then(function () { return all; });
    });
  }
  function dcLeave(job) {
    return job.get(DCB + '/judges-on-leave/').then(function (r) {
      var out = [];
      tbls(r.text || '').forEach(function (t) {
        t.rows.forEach(function (row) {
          var c = row.cells.filter(function (x) { return !x.th; });
          if (c.length < 4) return;
          var from = isoOf(c[2].t), to = isoOf(c[3].t);
          if (!from) return;
          out.push({ name: c[1].t, from: from, to: to || from, kind: c[4] ? c[4].t : '' });
        });
      });
      return out;
    });
  }
  /* the cause-list page: complexes, and the hidden fields one CAPTCHA needs */
  function dcPage(job) {
    return job.get(DC_CL).then(function (r) {
      var h = r.text || '';
      var f = (h.match(/<form[^>]*id="ecourt-services-cause-list-cause-list"[\s\S]*?<\/form>/i) || [''])[0];
      var cx = [], m, rx = /<select[^>]*id="est_code"[\s\S]*?<\/select>/i;
      var sel = (f.match(rx) || [''])[0], ro = /<option\s+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi;
      while ((m = ro.exec(sel))) cx.push({ v: unent(m[1]), t: one(strip(m[2])) });
      var scid = (f.match(/name="scid"\s+value="([^"]+)"/) || f.match(/id="input_siwp_captcha_id_0"[^>]*value="([^"]+)"/) || [])[1] || '';
      var tok = f.match(/name="(tok_[a-f0-9]+)"\s+value="([^"]*)"/i);
      var img = (f.match(/id="siwp_captcha_image_0"[^>]*src="([^"]+)"/) || [])[1] || '';
      return { complexes: cx, scid: scid, tokN: tok ? tok[1] : '', tokV: tok ? tok[2] : '', img: unent(img) };
    });
  }
  function dcCourts(job, cxVal, pg) {
    var form = { service_type: 'courtComplex', est_code: cxVal, cause_type: '2', es_ajax_request: '1', action: 'get_court_lists' };
    if (pg.scid) form.scid = pg.scid;
    if (pg.tokN) form[pg.tokN] = pg.tokV;
    return job.post(DC_AJAX, form, { ref: DC_CL, xhr: true }).then(function (r) {
      var j; try { j = JSON.parse(r.text); } catch (e) { j = null; }
      var h = j ? (typeof j.data === 'string' ? j.data : JSON.stringify(j.data || '')) : (r.text || '');
      var out = [], m, ro = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
      while ((m = ro.exec(h))) {
        var v = unent(m[1]), t = one(strip(m[2])), o = null;
        if (!v) continue;
        try { o = JSON.parse(atob(v)); } catch (e) { o = null; }
        var no = o && o.court_no ? String(o.court_no).split('~') : (t.match(/^(\d+)/) || []).slice(1);
        out.push({ v: v, t: t, no: no[0] || '', est: (o && o.court_est_code) || no[1] || '', judge: o ? one(String(o.judge_name || '').replace(/^\d+\s+/, '')) : one(t.replace(/^\d+\s+/, '').split(' - ')[0]),
                   des: o ? one(o.desgname || '') : one(t.split(' - ').slice(1).join(' - ')) });
      }
      return out;
    });
  }
  /* one fresh CAPTCHA (its own cookie jar) for one court's cause list */
  function dcCaptcha() {
    var job = new Job();
    return dcPage(job).then(function (pg) {
      if (!pg.img || !pg.scid) throw new Error('the court site did not give a CAPTCHA');
      var img = pg.img.indexOf('http') === 0 ? pg.img : DCB + (pg.img.charAt(0) === '/' ? '' : '/') + pg.img;
      return job.get(img, { ref: DC_CL, bin: true }).then(function (r) {
        return { job: job, pg: pg, img: 'data:' + ((r.ctype || 'image/png').split(';')[0]) + ';base64,' + r.b64 };
      });
    });
  }
  function dcCauseList(cap, cx, courtV, iso, ctype, answer) {
    var base = { service_type: 'courtComplex', est_code: cx, court: courtV, date: dmy(iso), cause_type: ctype, scid: cap.pg.scid,
                 siwp_captcha_value: String(answer || '').trim(), es_ajax_request: '1', action: 'get_causes' };
    if (cap.pg.tokN) base[cap.pg.tokN] = cap.pg.tokV;
    return cap.job.post(DC_AJAX, base, { ref: DC_CL, xhr: true }).then(function (r) {
      var j; try { j = JSON.parse(r.text); } catch (e) { j = null; }
      if (!j) return { bad: false, err: 'The court site gave an answer that could not be read (HTTP ' + r.status + ').' };
      if (!j.success) {
        var msg = ''; try { msg = (JSON.parse(j.data || '{}') || {}).message || ''; } catch (e) { msg = strip(j.data || ''); }
        if (/captcha|security code|invalid code/i.test(msg)) return { bad: true, err: msg || 'Wrong CAPTCHA' };
        return { none: true, err: msg || 'Nothing found' };
      }
      var html = String(j.data || ''), pages = [html], guard = 0;
      /* "load more": the site gives a long list in parts */
      function more(h) {
        var nm = h.match(/data-next-page=["'](\d+)["']/);
        if (!nm || guard++ > 25) return Promise.resolve();
        var f = Object.assign({}, base, { page: nm[1], loadmore_clicked: '1' });
        var em = h.match(/data-est-code=["']([^"']+)["']/); if (em) f.est_code = em[1];
        return cap.job.post(DC_AJAX, f, { ref: DC_CL, xhr: true }).then(function (x) {
          var jj; try { jj = JSON.parse(x.text); } catch (e) { jj = null; }
          if (!jj || !jj.success || !jj.data) return;
          pages.push(String(jj.data));
          if (String(jj.data).length > 50) return more(String(jj.data));
        }).catch(function () {});
      }
      return more(html).then(function () { return { html: pages.join('\n') }; });
    });
  }
  /* rows of a District Court cause list: serial, text, CNR (if shown), the heading it falls under */
  function parseDcList(html) {
    var items = [], notes = [], head = '', heads = [];
    var pre = html.split(/<table/i)[0];
    strip(pre).split('\n').forEach(function (l) { l = one(l); if (l.length > 6 && /note|will|not|adjourn|leave|sit|only|urgent|board|taken/i.test(l)) notes.push(l); });
    tbls(html).forEach(function (t) {
      var cap = (t.raw.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) || [])[1];
      if (cap) { head = one(strip(cap)); heads.push(head); }
      t.rows.forEach(function (r) {
        var cs = r.cells;
        if (!cs.length) return;
        var txt = cs.map(function (c) { return c.t; }).filter(Boolean);
        var allTh = cs.every(function (c) { return c.th; });
        if (allTh && txt.length > 1 && /sr|case|part|advocate/i.test(txt.join(' '))) return;   /* column titles */
        if (cs.length === 1 || (txt.length === 1 && /colspan/i.test(cs[0].attr))) {
          var h1 = txt[0] || '';
          if (h1 && !/^\d+$/.test(h1)) { head = h1; heads.push(head); }
          return;
        }
        var sr = (txt[0] || '').match(/^(\d{1,4})\b/);
        if (!sr) return;
        var raw = r.raw;
        var cnr = (raw.match(/\b(MH[A-Z]{2}\d{14})\b/) || raw.match(/\b([A-Z]{4}\d{12})\b/) || [])[1] || '';
        items.push({ sr: +sr[1], text: txt.slice(1).join(' | '), cnr: cnr, head: head, refs: refs(txt.slice(1).join(' ')) });
      });
    });
    return { items: items, notes: notes, heads: heads };
  }

  /* judge / designation / room / leave for one district case on one date */
  function dcIdentify(c, iso, ctx) {
    var out = { f: 'dc', rem: [] };
    var est = dcEst(c), no = dcCourtNo(c), courtJ = str(c.eco && c.eco.judge).replace(/^\s*\d+\s*[-–:]\s*/, '');
    out.est = est; out.no = no;
    var opt = null;
    if (est && no) {
      var list = ctx.courtsByEst[est] || [];
      opt = list.filter(function (o) { return o.no === no && (!o.est || o.est === est); })[0] || null;
      if (!opt && list.length) out.rem.push('Court No. ' + no + ' is not in today\'s court list of ' + est + ' — the court may have been renumbered; fetch the case from eCourts again.');
    } else if (!est) out.rem.push('No CNR on this case, so its court on the site is not known.');
    else out.rem.push('Court number not known yet — fetch this case once from eCourts (Unfetched) so its court number is recorded.');
    if (opt) { out.opt = opt.v; out.cx = ctx.cxOfEst[est] || est; out.judgeFull = opt.judge; out.desSite = opt.des; }
    var want = opt ? opt.des : courtJ || c.court || '';
    /* the List of Judges entry: by the sitting judge's name first, then by the designation */
    var row = null, how = '';
    if (opt && opt.judge) {
      var best = 0;
      ctx.judges.forEach(function (j) { var s = sameName(j.name, opt.judge); if (s > best) { best = s; row = j; } });
      if (row && best >= 2) how = 'name'; else row = null;
    }
    if (!row && want) {
      var hits = ctx.judges.filter(function (j) { return j.des && sameDes(j.des, want); });
      if (hits.length === 1) { row = hits[0]; how = 'designation'; }
      else if (hits.length > 1) out.rem.push('More than one judge in the List of Judges has the designation "' + want + '" — please check.');
    }
    if (row) {
      out.judge = row.name || (opt && opt.judge) || '';
      out.des = row.des || (opt && opt.des) || courtJ;
      out.room = row.room || '';
      if (how === 'designation' && opt && opt.judge && row.name && !sameName(row.name, opt.judge))
        out.rem.push('The cause-list site names ' + opt.judge + ' for this court, the List of Judges names ' + row.name + ' for "' + row.des + '" — please confirm.');
      if (opt && opt.des && row.des && how === 'name' && !sameDes(row.des, opt.des))
        out.rem.push('Designation differs: court list says "' + opt.des + '", List of Judges says "' + row.des + '".');
    } else {
      out.judge = opt ? opt.judge : (typeof judgeOn === 'function' ? judgeOn(c, iso) : '') || '';
      out.des = opt ? opt.des : courtJ;
      if (want) out.rem.push('Not found in the List of Judges — room not known.');
    }
    if (courtJ && out.des && !sameDes(courtJ, out.des) && desKey(courtJ).k && desKey(out.des).k)
      out.rem.push('eCourts shows this case in "' + courtJ + '"; today that court is "' + out.des + '".');
    /* leave */
    var names = [out.judge, out.judgeFull].filter(Boolean);
    ctx.leave.forEach(function (l) {
      if (iso < l.from || iso > l.to) return;
      if (names.some(function (n) { return sameName(n, l.name) >= 2; })) out.leave = { name: l.name, from: l.from, to: l.to, kind: l.kind };
    });
    return out;
  }

  /* ================================================================ HIGH COURT (Nagpur Bench) */
  function hcLists(iso, log) {
    var job = new Job();
    return job.get(BHC + 'bench/change?bench=N', { ref: BHC }).then(function () {
      return job.get(BHC + 'causelistFinal', { ref: BHC });
    }).then(function (r) {
      var h = r.text || '';
      var f = (h.match(/<form[^>]*class="pdfcauselist_form"[\s\S]*?<\/form>/i) || [''])[0];
      function val(n) { var m = f.match(new RegExp('name="' + n + '"\\s+value="([^"]*)"')); return m ? unent(m[1]) : ''; }
      var tok = val('_token') || (h.match(/name="csrf-token"\s+content="([^"]+)"/) || [])[1] || '';
      var form = { _token: tok, form_secret: val('form_secret'), chkpassphrase: val('chkpassphrase'), m_juris: 'N', m_causedt: dmy(iso, '-') };
      return job.post(BHC + 'causelist/get-data', form, { ref: BHC + 'causelistFinal', xhr: true, h: { 'X-CSRF-TOKEN': tok } });
    }).then(function (r) {
      var j; try { j = JSON.parse(r.text); } catch (e) { j = null; }
      if (!j) throw new Error('the High Court site did not answer properly (HTTP ' + r.status + ')');
      var page = String(j.page || '');
      if (!j.status || /not available/i.test(strip(page).slice(0, 300))) return { job: job, lists: [], none: one(strip(j.message || page)).slice(0, 160) || 'No cause list published yet' };
      var lists = [];
      var t = tbls(page).filter(function (x) { return /causelist-table/.test(x.attr); })[0] || tbls(page)[0];
      (t ? t.rows : []).forEach(function (row) {
        if (!row.cells.length || row.cells[0].th) return;
        var coram = one(strip(row.cells[0].raw.replace(/<br\s*\/?>/gi, ' & ')));
        var m, rx = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((m = rx.exec(row.raw))) {
          var label = one(strip(m[2]));
          if (!/causelist|daily|weekly|chamber|supplement|main|production/i.test(label)) continue;
          lists.push({ coram: coram, label: label, url: unent(m[1]) });
        }
      });
      return { job: job, lists: lists };
    });
  }
  /* reads one High Court list PDF into courts → notes, sections, items */
  function parseHc(lines, label) {
    var B = { court: '', bench: '', at: '', coram: [], notes: [], sections: [], items: [], label: label };
    var phase = 'head', cur = null, sec = null, noteBuf = null, lastItemLine = -1, lastLen = 0;
    function addNote(t) { t = one(t); if (t) B.notes.push(t); }
    function flushNote() { if (noteBuf) { addNote(noteBuf); noteBuf = null; } }
    lines.forEach(function (L, idx) {
      var t = one(L.t);
      if (!t) return;
      if (/^\d+\s*\/\s*\d+$/.test(t)) return;                                  /* page number */
      if (/CAUSELIST\s+COURT\s+NO/i.test(t) && /HIGH COURT/i.test(t)) return;   /* running page header */
      if (phase === 'head') {
        var m;
        if (t.length <= 3) return;                                              /* "th" of "9th", stray marks */
        if (/^HIGH COURT OF BOMBAY/i.test(t) || /CAUSELIST$/i.test(t) || /^For\s+\w+day/i.test(t)) return;
        if ((m = t.match(/^COURT NO\.?\s*([A-Z0-9-]+)/i))) { B.court = m[1]; return; }
        if (/^(SINGLE|DIVISION|FULL)$/i.test(t)) { B.bench = t; return; }
        if ((m = t.match(/^AT\s*(.*)$/i)) && t.length < 30) { B.at = one(m[1]); return; }
        if (/^HON'?BLE/i.test(t)) { flushNote(); B.coram.push(t); phase = 'coram'; return; }
        /* court notes: "1) …", or plain sentences, wrapped over several lines. The list breaks lines at a
           fixed width, even inside a word ("FOLLO" / "WING"): a full-width line is joined without a space */
        if (/^\d{1,2}\s*\)/.test(t) || !noteBuf) { flushNote(); noteBuf = t; }
        else noteBuf += (lastLen >= 72 && /[A-Za-z]$/.test(noteBuf) && /^[A-Za-z]/.test(t) ? '' : ' ') + t;
        lastLen = t.length;
        return;
      }
      if (phase === 'coram' && /^HON'?BLE/i.test(t)) { B.coram.push(t); return; }
      phase = 'body';
      /* section heading */
      if (/\bMATTERS\s*\)?\s*$/i.test(t) && !/^\d+\s/.test(t) && !/\/\d{4}/.test(t) || /^(DAILY|WEEKLY)?\s*SUPPLEMENTARY\b/i.test(t) && t.length < 90) {
        sec = { title: t, from: 0, to: 0 }; B.sections.push(sec); cur = null; return;
      }
      var im = t.match(/^(\d{1,4})\s+((?:[A-Z][A-Z.()]*)\s*\/\s*(?:ST\.?\s*)?[0-9]+\s*\/\s*\d{2,4})/);
      if (im) {
        cur = { sr: +im[1], main: one(im[2]), refs: refs(t.slice(im[1].length)), lines: [t], with: [], sec: sec ? sec.title : '', remark: '' };
        if (!sec) { sec = { title: '(no heading)', from: 0, to: 0 }; B.sections.push(sec); }
        if (!sec.from) sec.from = cur.sr; sec.to = cur.sr;
        B.items.push(cur); lastItemLine = idx; return;
      }
      if (!cur) {
        if (t.length > 8 && /WILL BE|NOT SIT|TAKEN UP|ADJOURN|NOTE|ONLY|FIRST|LUNCH|P\.?M\.?|A\.?M\.?/i.test(t)) addNote(t);
        return;
      }
      cur.lines.push(t);
      var cm = t.match(/^((?:[A-Z][A-Z.()]*)\s*\/\s*(?:ST\.?\s*)?[0-9]+\s*\/\s*\d{2,4})/);
      if (cm) { cur.with.push(one(cm[1])); cur.refs = cur.refs.concat(refs(cm[1])); cur.inRem = false; return; }
      if (/^(WITH|IN|AND)$/i.test(t)) { cur.inRem = false; return; }
      if (!cur.remark && /^(FOR|TO BE|PETITION FOR|APPLICATION FOR|CIRCULATED|PART[- ]HEARD|SPEAKING|PRONOUNCEMENT|ADJOURNED|NOT BEFORE)\b/i.test(t)) { cur.remark = t; cur.inRem = true; return; }
      if (cur.inRem && cur.remark.length < 320) cur.remark += ' ' + t;
    });
    flushNote();
    return B;
  }
  /* calling-order hints a court note can carry */
  function orderHints(B) {
    var h = { start: 0, suppFirst: false, timed: {}, fhAfter: false };
    B.notes.forEach(function (n, i) {
      var m;
      if ((m = n.match(/(?:BOARD|LIST)[^.]{0,40}?(?:WILL\s+)?(?:START|COMMENCE|BEGIN|TAKEN UP)[^.]{0,20}?FROM\s+(?:SR\.?|SERIAL|ITEM)?\s*(?:NO\.?)?\s*(\d{1,4})/i))) h.start = +m[1];
      if (/SUPPLEMENTARY[^.]{0,60}(FIRST|BEFORE)/i.test(n)) h.suppFirst = true;
      if (/FINAL HEARING[^.]{0,80}AFTER/i.test(n)) h.fhAfter = true;
      if ((m = n.match(/SR\.?\s*NOS?\.?\s*([\d\s,&AND-]+?)\s+(?:ARE\s+)?(?:WILL\s+)?(?:BE\s+)?(?:TAKEN UP|HEARD|CALLED)[^.]*?AT\s+([\d.:]+\s*(?:A\.?M\.?|P\.?M\.?))/i))) {
        var nums = m[1].match(/\d+/g) || [], range = m[1].match(/(\d+)\s*(?:-|TO)\s*(\d+)/i);
        if (range) { nums = []; for (var x = +range[1]; x <= +range[2] && nums.length < 200; x++) nums.push(String(x)); }
        nums.forEach(function (k) { h.timed[+k] = { at: one(m[2]), note: i }; });
      }
    });
    return h;
  }
  function stageWord(title) {
    var t = String(title || '').toUpperCase();
    if (/PRONOUNCE/.test(t)) return 'Pronouncement';
    if (/SPEAKING TO MINUTES/.test(t)) return 'Speaking to minutes';
    if (/FINAL HEARING|FOR HEARING|HEARING/.test(t)) return 'Final hearing';
    if (/ADMISSION/.test(t)) return 'Admission';
    if (/ORDERS?\b/.test(t)) return 'Orders';
    if (/DIRECTION/.test(t)) return 'Directions';
    if (/MENTION/.test(t)) return 'Mentioning';
    if (/SUPPLEMENTARY/.test(t)) return 'Supplementary';
    return one(t.replace(/\((CIVIL|CRIMINAL) SIDE MATTERS\)/i, '').replace(/^FOR\s+/i, '')).toLowerCase().replace(/^\w/, function (x) { return x.toUpperCase(); });
  }
  function breakdown(B) {
    return B.sections.filter(function (s) { return s.from; }).map(function (s) {
      var side = /CRIMINAL/i.test(s.title) ? ' (Crl.)' : /CIVIL/i.test(s.title) ? ' (Civ.)' : '';
      return { s: stageWord(s.title) + side, a: s.from, b: s.to, full: s.title };
    });
  }
  function position(B, item, hints) {
    var srs = B.items.map(function (x) { return x.sr; });
    var total = srs.length, idx = srs.indexOf(item.sr), pos = idx + 1;
    if (hints.start && item.sr >= hints.start) pos = srs.filter(function (s) { return s >= hints.start && s <= item.sr; }).length;
    else if (hints.start && item.sr < hints.start) pos = srs.filter(function (s) { return s >= hints.start; }).length + srs.filter(function (s) { return s <= item.sr; }).length;
    var inSec = B.items.filter(function (x) { return x.sec === item.sec; });
    return { pos: pos, total: total, inSec: inSec.map(function (x) { return x.sr; }).indexOf(item.sr) + 1, secTotal: inSec.length };
  }

  /* ================================================================ MAT (Nagpur) and CAT boards: generic list reading */
  function parseGeneric(lines, label) {
    var B = { court: '', coram: [], notes: [], sections: [], items: [], label: label, at: '' }, sec = null, cur = null;
    lines.forEach(function (L) {
      var t = one(L.t); if (!t) return;
      if (/^page\s*\d+|^\d+\s*\/\s*\d+$/i.test(t)) return;
      if (/^HON'?BLE/i.test(t) && !cur) { B.coram.push(t); return; }
      var im = t.match(/^(\d{1,4})[.)]?\s+(.*)$/);
      if (im && refs(im[2]).length) { cur = { sr: +im[1], text: im[2], refs: refs(im[2]), sec: sec ? sec.title : '', remark: '', lines: [t] }; if (!sec) { sec = { title: '(no heading)', from: 0, to: 0 }; B.sections.push(sec); } if (!sec.from) sec.from = cur.sr; sec.to = cur.sr; B.items.push(cur); return; }
      if (t === t.toUpperCase() && t.length < 90 && /ADMISSION|ORDERS?|HEARING|FINAL|REPLY|FRESH|MENTION|PRONOUNCE|DIRECTION|PART[- ]HEARD|SPEAKING|NOTICE|BOARD/.test(t) && !refs(t).length) {
        if (/WILL|NOT SIT|ADJOURN|TAKEN UP|LEAVE|ONLY/.test(t)) { B.notes.push(t); return; }
        sec = { title: t, from: 0, to: 0 }; B.sections.push(sec); cur = null; return;
      }
      if (cur) { cur.lines.push(t); if (refs(t).length && cur.lines.length < 6) cur.refs = cur.refs.concat(refs(t)); if (!cur.remark && /^(FOR|TO BE|STAGE|PURPOSE)\b/i.test(t)) cur.remark = t; return; }
      if (t.length > 8 && /WILL BE|NOT SIT|TAKEN UP|ADJOURN|NOTE|ONLY|LUNCH|P\.?M\.?|A\.?M\.?/i.test(t)) B.notes.push(t);
    });
    return B;
  }
  function matBoards(job, iso) {
    return job.get(MAT_API, { ref: 'https://mat.maharashtra.gov.in/', xhr: true }).then(function (r) {
      var j; try { j = JSON.parse(r.text); } catch (e) { j = []; }
      var nag = (Array.isArray(j) ? j : []).filter(function (x) { return +x.div_id === 2; });
      var on = nag.filter(function (x) { return String(x.board_date || '').slice(0, 10) === iso; });
      var latest = nag.map(function (x) { return String(x.board_date || '').slice(0, 10); }).sort().pop() || '';
      return { boards: on.map(function (x) { return { label: one(x.coram_details || 'MAT Nagpur board'), url: MAT_FILES + encodeURIComponent(x.board_file).replace(/%2F/g, '/') }; }), latest: latest };
    });
  }
  function catList(job, iso) {
    var sch = (S.lstCfg && S.lstCfg.catSchema) || '210';
    return job.post(CAT_API, { catschemaId: sch, catCauseListDate: dmy(iso) }, { ref: 'https://cgat.gov.in/', multipart: true }).then(function (r) {
      var t = String(r.text || '').trim();
      if (!t || t === '[]' || t === '""') return { rows: [], none: true };
      return lib(CRYPTOJS, function () { return !!window.CryptoJS; }).then(function () {
        var data = null;
        try { var enc = t.charAt(0) === '"' ? JSON.parse(t) : t; data = JSON.parse(CryptoJS.AES.decrypt(enc, 'CatApplication').toString(CryptoJS.enc.Utf8)); }
        catch (e) { try { data = JSON.parse(t); } catch (e2) { data = null; } }
        if (!data) return { rows: [], err: 'The CAT list could not be read.' };
        var rows = [];
        (function walk(x, ctx) {
          if (Array.isArray(x)) { x.forEach(function (y) { walk(y, ctx); }); return; }
          if (x && typeof x === 'object') {
            var flat = Object.keys(x).filter(function (k) { return typeof x[k] !== 'object'; });
            var txt = flat.map(function (k) { return x[k]; }).join(' | ');
            if (refs(txt).length && flat.length >= 3) rows.push({ o: x, txt: txt, refs: refs(txt), ctx: ctx });
            Object.keys(x).forEach(function (k) { if (x[k] && typeof x[k] === 'object') walk(x[k], Object.assign({}, ctx, flat.reduce(function (a, f) { a[f] = x[f]; return a; }, {}))); });
          }
        })(data, {});
        return { rows: rows };
      });
    });
  }
  function pick(o, re) { var k = Object.keys(o || {}).filter(function (x) { return re.test(x); })[0]; return k ? str(o[k]) : ''; }

  /* ================================================================ the window */
  var W = null;
  function css() {
    if (document.getElementById('lstCss')) return;
    var s = document.createElement('style'); s.id = 'lstCss';
    s.textContent =
      '#lstOv{display:none;position:fixed;inset:0;background:rgba(10,20,50,.6);z-index:600;align-items:center;justify-content:center;padding:8px}' +
      '#lstOv.open{display:flex}#lstOv .lm{background:#fff;border-radius:8px;width:100%;max-width:1060px;max-height:94vh;overflow-y:auto;font-size:12px}' +
      '#lstOv .lh{background:#1a2744;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;font-weight:600;position:sticky;top:0;z-index:2}' +
      '#lstOv .lb{padding:12px 14px}#lstOv .lx{background:none;border:none;color:#fff;font-size:18px;cursor:pointer}' +
      '#lstOv h4{margin:12px 0 6px;font-size:12.5px;color:#1a2744}#lstOv .lg{font-size:11px;color:#444;max-height:140px;overflow:auto;background:#fafaf5;border:1px solid #e3dcc4;border-radius:4px;padding:5px 7px}' +
      '#lstOv .lg div.w{color:#a35b00}#lstOv .lg div.e{color:#b3261e}#lstOv table.lt{border-collapse:collapse;width:100%}#lstOv table.lt td,#lstOv table.lt th{border:1px solid #ddd;padding:4px 6px;vertical-align:top;text-align:left}' +
      '#lstOv table.lt th{background:#f3efe2;font-size:11px}#lstOv .cap{height:46px;border:1px solid #ccc;border-radius:3px;vertical-align:middle;background:#fff}' +
      '#lstOv .ci{width:96px;font-size:15px;padding:4px 6px;letter-spacing:1px}#lstOv .st{font-size:11px}#lstOv .st.ok{color:#127a4b}#lstOv .st.bad{color:#b3261e}' +
      '.lstcell{margin-top:3px;font-size:.86em;line-height:1.3;font-style:normal;text-decoration:none}.lstcell .sr{display:inline-block;background:#1a2744;color:#fff;border-radius:3px;padding:0 5px;font-weight:700;margin-right:4px}' +
      '.lstcell .lv{display:inline-block;background:#b3261e;color:#fff;border-radius:3px;padding:0 5px;font-weight:700;margin-right:4px}' +
      '.lstcell .rm{color:#a35b00}.lstcell .bk{color:#555}' +
      '.lstnotes{border:1px solid #e3dcc4;background:#fffdf4;border-radius:4px;padding:6px 8px;margin:4px 0 8px;font-size:11px}' +
      '.lstnotes .ct{font-weight:700;margin-top:4px}.lstnotes .nt{margin:2px 0 2px 10px}.lstnotes .nt.x{text-decoration:line-through;color:#999}' +
      '.lstnotes button{font-size:10px;padding:0 5px;margin-left:6px;cursor:pointer;border:1px solid #bbb;background:#fff;border-radius:3px}';
    document.head.appendChild(s);
  }
  function ov() {
    css();
    var el = document.getElementById('lstOv');
    if (!el) {
      el = document.createElement('div'); el.id = 'lstOv';
      el.innerHTML = '<div class="lm"><div class="lh"><span id="lstTitle">Court positions</span><button class="lx" onclick="lstClose()">&#x2715;</button></div><div class="lb" id="lstBody"></div></div>';
      document.body.appendChild(el);
    }
    return el;
  }
  window.lstClose = function () {
    var el = document.getElementById('lstOv'); if (el) el.classList.remove('open');
    if (W && W.caps) W.caps.forEach(function (x) { if (x.cap) x.cap.job.drop(); });
    if (W && W.job) W.job.drop();
    W = null;
    try { if (typeof refresh === 'function') refresh(); } catch (e) {}
  };
  function log(msg, k) {
    var el = document.getElementById('lstLog'); if (!el) return;
    var d = document.createElement('div'); if (k) d.className = k === 'warn' ? 'w' : 'e'; d.textContent = msg; el.appendChild(d); el.scrollTop = el.scrollHeight;
  }

  /* entry point: the board's button */
  window.lstOpen = function (iso) {
    if (typeof can === 'function' && !can('edit') && !can('exp')) { /* viewers may still look */ }
    var rows = (typeof boardOn === 'function' ? boardOn(iso) : []).map(function (x) { return x.c; });
    var cases = rows.filter(function (c) { return forum(c); });
    ov().classList.add('open');
    document.getElementById('lstTitle').innerHTML = 'Court positions for ' + esc(typeof fdl === 'function' ? fdl(iso) : iso) +
      ' &mdash; <span style="color:#e8c96a">' + cases.length + ' matter' + (cases.length === 1 ? '' : 's') + '</span>';
    var body = document.getElementById('lstBody');
    if (!cases.length) { body.innerHTML = '<p>No District Court, High Court, CAT or MAT matters on the board for this date.</p>'; return; }
    W = { iso: iso, cases: cases, job: new Job(), caps: [], ctx: null };
    var nDc = cases.filter(function (c) { return forum(c) === 'dc'; }).length, nHc = cases.filter(function (c) { return forum(c) === 'hc'; }).length;
    var nMat = cases.filter(function (c) { return forum(c) === 'mat'; }).length, nCat = cases.filter(function (c) { return forum(c) === 'cat'; }).length;
    body.innerHTML =
      '<div style="font-size:11.5px;color:#333">District Court: <b>' + nDc + '</b> &middot; High Court: <b>' + nHc + '</b> &middot; MAT: <b>' + nMat + '</b> &middot; CAT: <b>' + nCat + '</b>' +
      ' &nbsp; <span style="color:#666">Step 1 needs no CAPTCHA. Step 2 asks one CAPTCHA per District Court court, all together.</span></div>' +
      '<h4>Step 1 &mdash; judges, rooms, leave; High Court / MAT / CAT lists</h4><div class="lg" id="lstLog"></div>' +
      '<div id="lstStep2"></div><div id="lstRes"></div>';
    helperReady().then(function () { return step1(); }).catch(function (e) { log(e.message, 'err'); });
  };

  function step1() {
    var iso = W.iso, D = day(iso, true);
    D.at = new Date().toISOString(); D.by = user();
    var dcCases = W.cases.filter(function (c) { return forum(c) === 'dc'; });
    var jobs = [];
    if (dcCases.length) jobs.push(step1dc(dcCases));
    var hc = W.cases.filter(function (c) { return forum(c) === 'hc'; });
    if (hc.length) jobs.push(stepHc(hc).catch(function (e) { log('High Court: ' + e.message, 'err'); }));
    var mat = W.cases.filter(function (c) { return forum(c) === 'mat'; });
    if (mat.length) jobs.push(stepMat(mat).catch(function (e) { log('MAT: ' + e.message, 'err'); }));
    var cat = W.cases.filter(function (c) { return forum(c) === 'cat'; });
    if (cat.length) jobs.push(stepCat(cat).catch(function (e) { log('CAT: ' + e.message, 'err'); }));
    return Promise.all(jobs).then(function () { save(); showResults(); });
  }

  function step1dc(dcCases) {
    var job = W.job, iso = W.iso;
    log('District Court: reading the List of Judges…');
    var ctx = { judges: [], leave: [], courtsByEst: {}, cxOfEst: {} };
    W.ctx = ctx;
    return dcJudges(job, log).then(function (j) {
      ctx.judges = j; log('List of Judges: ' + j.length + ' entries.');
      return dcLeave(job);
    }).then(function (l) {
      ctx.leave = l;
      var today = l.filter(function (x) { return iso >= x.from && iso <= x.to; });
      log('Judges on leave on ' + dmy(iso) + ': ' + (today.length ? today.map(function (x) { return x.name; }).join(', ') : 'none listed') + '.');
      return dcPage(job);
    }).then(function (pg) {
      var ests = {};
      dcCases.forEach(function (c) { var e = dcEst(c); if (e) ests[e] = 1; });
      var want = pg.complexes.filter(function (cx) { return cx.v.split(',').some(function (e) { return ests[e]; }); });
      var p = Promise.resolve();
      want.forEach(function (cx) {
        p = p.then(function () {
          return dcCourts(job, cx.v, pg).then(function (list) {
            list.forEach(function (o) { var e = o.est || cx.v.split(',')[0]; (ctx.courtsByEst[e] = ctx.courtsByEst[e] || []).push(o); ctx.cxOfEst[e] = cx.v; });
            log('Courts of ' + cx.t + ': ' + list.length + '.');
          }).catch(function (e) { log('Could not read the courts of ' + cx.t + ': ' + e.message, 'warn'); });
        });
      });
      return p;
    }).then(function () {
      var D = day(iso, true), groups = {};
      dcCases.forEach(function (c) {
        var id = dcIdentify(c, iso, ctx);
        var rec = D.cases[c.id] = Object.assign(D.cases[c.id] || {}, { f: 'dc', judge: id.judge, des: id.des, room: id.room, leave: id.leave || null, rem: id.rem, est: id.est, no: id.no });
        if (id.opt) {
          var key = id.est + '~' + id.no;
          rec.ck = key;
          var g = groups[key] = groups[key] || { key: key, cx: id.cx, opt: id.opt, est: id.est, no: id.no, judge: id.judge, des: id.des, room: id.room, leave: id.leave, cases: [], ct: guessCivCri(c) };
          g.cases.push(c);
          if (guessCivCri(c) !== g.ct) g.both = true;
          D.courts[key] = Object.assign(D.courts[key] || { notes: [] }, { title: (id.des || ('Court No. ' + id.no)) + (id.judge ? ' — ' + id.judge : '') + (id.room ? ' — Room ' + id.room : ''), f: 'dc', leave: id.leave || null });
        }
      });
      W.groups = Object.keys(groups).map(function (k) { return groups[k]; });
      log('District Court: ' + W.groups.length + ' court' + (W.groups.length === 1 ? '' : 's') + ' to read for serial numbers.');
      save();
      step2();
    }).catch(function (e) { log('District Court: ' + e.message, 'err'); });
  }

  /* Step 2: one CAPTCHA per District Court court, all on one screen */
  function step2() {
    var el = document.getElementById('lstStep2'); if (!el) return;
    if (!W.groups.length) { el.innerHTML = ''; return; }
    var rows = [];
    W.groups.forEach(function (g) {
      rows.push({ g: g, ct: g.ct });
      if (g.both) rows.push({ g: g, ct: g.ct === '2' ? '3' : '2' });
    });
    W.caps = rows;
    el.innerHTML = '<h4>Step 2 &mdash; District Court cause lists (one CAPTCHA per court)</h4>' +
      '<table class="lt"><thead><tr><th>Court (today)</th><th>Matters</th><th>List</th><th>CAPTCHA</th><th>Type it</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var g = r.g;
        return '<tr><td><b>' + esc(g.des || ('Court No. ' + g.no)) + '</b><br>' + esc(g.judge || '') + (g.room ? ' &middot; Room ' + esc(g.room) : '') +
          (g.leave ? '<br><span style="color:#b3261e;font-weight:700">ON LEAVE ' + esc(dmy(g.leave.from)) + '–' + esc(dmy(g.leave.to)) + '</span>' : '') +
          '<br><span style="color:#888">' + esc(g.est) + ' / court ' + esc(g.no) + '</span></td>' +
          '<td>' + g.cases.map(function (c) { return esc(c.cn || '') + '<br><span style="color:#666">' + esc(typeof ctit === 'function' ? ctit(c) : '') + '</span>'; }).join('<hr style="border:0;border-top:1px dashed #ddd;margin:3px 0">') + '</td>' +
          '<td><select id="lstCt' + i + '"><option value="2"' + (r.ct === '2' ? ' selected' : '') + '>Civil</option><option value="3"' + (r.ct === '3' ? ' selected' : '') + '>Criminal</option></select></td>' +
          '<td><img class="cap" id="lstImg' + i + '" alt="loading…"> <button class="btn bo" onclick="lstPic(' + i + ')" title="Another picture">&#8635;</button></td>' +
          '<td><input class="ci" id="lstIn' + i + '" autocomplete="off" onkeydown="if(event.key===\'Enter\')lstSubmit()"></td>' +
          '<td class="st" id="lstSt' + i + '">getting CAPTCHA…</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button class="btn bg" id="lstGo" onclick="lstSubmit()">&#10003; Submit all CAPTCHAs</button>' +
      '<span style="font-size:11px;color:#666">Each court&rsquo;s list is read once its CAPTCHA is right; a wrong one gets a new picture.</span></div>';
    var p = Promise.resolve();
    rows.forEach(function (r, i) { p = p.then(function () { return lstPic(i); }); });
  }
  window.lstPic = function (i) {
    var r = W && W.caps[i]; if (!r) return Promise.resolve();
    var st = document.getElementById('lstSt' + i); if (st) { st.textContent = 'getting CAPTCHA…'; st.className = 'st'; }
    if (r.cap) r.cap.job.drop();
    return dcCaptcha().then(function (cap) {
      r.cap = cap;
      var im = document.getElementById('lstImg' + i); if (im) im.src = cap.img;
      if (st) st.textContent = 'type the CAPTCHA';
    }).catch(function (e) { if (st) { st.textContent = 'No CAPTCHA: ' + e.message; st.className = 'st bad'; } });
  };
  window.lstSubmit = function () {
    if (!W || !W.caps.length) return;
    var go = document.getElementById('lstGo'); if (go) go.disabled = true;
    var p = Promise.resolve();
    W.caps.forEach(function (r, i) {
      if (r.done) return;
      var ans = (document.getElementById('lstIn' + i) || {}).value || '';
      if (!ans.trim() || !r.cap) return;
      var ct = (document.getElementById('lstCt' + i) || {}).value || r.ct;
      p = p.then(function () {
        var st = document.getElementById('lstSt' + i); st.textContent = 'reading the list…'; st.className = 'st';
        return dcCauseList(r.cap, r.g.cx, r.g.opt, W.iso, ct, ans).then(function (res) {
          if (res.bad) { st.textContent = 'Wrong CAPTCHA — new picture'; st.className = 'st bad'; document.getElementById('lstIn' + i).value = ''; return lstPic(i).then(function () { st.textContent = 'Wrong CAPTCHA — type the new one'; st.className = 'st bad'; }); }
          if (res.err && !res.html) { st.textContent = res.err; st.className = 'st bad'; r.done = true; applyDcList(r.g, ct, null, res.err); return; }
          r.done = true;
          var L = parseDcList(res.html);
          var n = applyDcList(r.g, ct, L, '');
          st.textContent = L.items.length + ' items read; ' + n + ' of your matter' + (n === 1 ? '' : 's') + ' found'; st.className = 'st ok';
        }).catch(function (e) { st.textContent = e.message; st.className = 'st bad'; });
      });
    });
    p.then(function () { if (go) go.disabled = false; save(); showResults(); });
  };
  function applyDcList(g, ct, L, err) {
    var D = day(W.iso, true), found = 0, kind = ct === '3' ? 'Criminal list' : 'Civil list';
    var C = D.courts[g.key] = D.courts[g.key] || { notes: [] };
    C.read = (C.read || []).concat([kind]);
    if (L) {
      var bk = {}, order = [];
      L.items.forEach(function (it) { var h = it.head || '(list)'; if (!bk[h]) { bk[h] = { s: h, a: it.sr, b: it.sr }; order.push(h); } bk[h].b = it.sr; });
      C.bk = (C.bk || []).filter(function (x) { return x.list !== kind; }).concat(order.map(function (h) { return { s: bk[h].s, a: bk[h].a, b: bk[h].b, list: kind }; }));
      C.total = (C.total || 0) + L.items.length;
      addNotes(C, L.notes);
    }
    g.cases.forEach(function (c) {
      var rec = D.cases[c.id] = D.cases[c.id] || { f: 'dc', rem: [] };
      if (rec.sr && rec.list && rec.list !== kind) return;           /* already found in the other list */
      if (!L) { if (err) rec.rem = uniq((rec.rem || []).concat([kind + ': ' + err])); return; }
      var cnr = str(c.cnr).toUpperCase().replace(/[^A-Z0-9]/g, ''), mine = caseRefsOf(c);
      var hits = L.items.filter(function (it) { return cnr && it.cnr && it.cnr === cnr; });
      if (!hits.length) hits = L.items.filter(function (it) { return refHit(mine, it.refs); });
      if (hits.length > 1) { var ex = hits.filter(function (it) { var h = refHit(mine, it.refs); return h && h.exact; }); if (ex.length) hits = ex; }
      if (hits.length === 1) {
        var it = hits[0]; found++;
        rec.sr = it.sr; rec.list = kind; rec.stg = it.head || ''; rec.pos = L.items.indexOf(it) + 1; rec.tot = L.items.length;
        rec.rem = (rec.rem || []).filter(function (x) { return !/not found in the|was not found/i.test(x); });
      } else if (hits.length > 1) {
        rec.rem = uniq((rec.rem || []).concat(['Several entries in the ' + kind.toLowerCase() + ' match this case number (Sr. ' + hits.map(function (h) { return h.sr; }).join(', ') + ') — please check.']));
      } else if (!rec.sr) {
        rec.rem = uniq((rec.rem || []).concat([c.cn ? c.cn + ' was not found in the ' + kind.toLowerCase() + ' of this court.' : 'Case number not recorded, so it could not be looked up in the list.']));
      }
    });
    return found;
  }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  function addNotes(C, notes) {
    C.notes = C.notes || [];
    (notes || []).forEach(function (t) {
      t = one(t); if (!t || t.length < 6) return;
      if (C.notes.some(function (n) { return n.t === t; })) return;
      C.notes.push({ t: t });
    });
  }

  /* ---- High Court ---- */
  function stepHc(cases) {
    log('High Court: reading the cause lists of ' + dmy(W.iso) + '…');
    return hcLists(W.iso, log).then(function (res) {
      var D = day(W.iso, true);
      if (!res.lists.length) {
        log('High Court: ' + (res.none || 'no lists published'), 'warn');
        cases.forEach(function (c) { var r = D.cases[c.id] = D.cases[c.id] || { f: 'hc' }; r.f = 'hc'; r.rem = ['High Court list for ' + dmy(W.iso) + ': ' + (res.none || 'not published yet') + '.']; });
        res.job.drop(); return;
      }
      log('High Court: ' + res.lists.length + ' lists to read.');
      var parsed = [], p = Promise.resolve();
      res.lists.forEach(function (L) {
        p = p.then(function () {
          return res.job.get(L.url, { ref: BHC + 'causelistFinal', bin: true }).then(function (r) {
            var u = b64bytes(r.b64);
            if (!(u[0] === 37 && u[1] === 80)) { log('High Court: "' + L.label + '" of ' + L.coram + ' did not come as a PDF.', 'warn'); return; }
            return pdfLines(u).then(function (lines) { var B = parseHc(lines, L.label); B.coramSite = L.coram; B.url = L.url; parsed.push(B); });
          }).catch(function (e) { log('High Court: could not read "' + L.label + '" of ' + L.coram + ' (' + e.message + ')', 'warn'); });
        });
      });
      return p.then(function () {
        res.job.drop();
        log('High Court: ' + parsed.length + ' lists read, ' + parsed.reduce(function (a, b) { return a + b.items.length; }, 0) + ' items.');
        cases.forEach(function (c) {
          var mine = caseRefsOf(c), rec = D.cases[c.id] = { f: 'hc', rem: [] };
          if (!mine.length) { rec.rem.push('Case number not recorded in a form that can be looked up (e.g. WP 3692/2026).'); return; }
          var hits = [];
          parsed.forEach(function (B) { B.items.forEach(function (it) { var h = refHit(mine, it.refs); if (h) hits.push({ B: B, it: it, exact: h.exact, main: refHit(mine, refs(it.main)) }); }); });
          if (hits.length > 1) { var ex = hits.filter(function (h) { return h.exact; }); if (ex.length) hits = ex; }
          if (!hits.length) { rec.rem.push('Not found in any High Court list of ' + dmy(W.iso) + '.'); return; }
          var h = hits[0], B = h.B, it = h.it, hints = orderHints(B), ps = position(B, it, hints);
          var key = 'HC~' + (B.court || B.coramSite) + '~' + B.label;
          rec.ck = key; rec.court = B.court ? 'Court ' + B.court : ''; rec.sr = it.sr; rec.list = B.label; rec.stg = stageWord(it.sec);
          rec.stgFull = it.sec; rec.remark = it.remark; rec.coram = (B.coram.length ? B.coram : [B.coramSite]).join(' & ');
          rec.pos = ps.pos; rec.tot = ps.total; rec.inSec = ps.inSec; rec.secTot = ps.secTotal;
          if (!h.main) rec.with = it.main;
          if (hints.timed[it.sr]) rec.time = hints.timed[it.sr].at;
          if (hints.start) rec.start = hints.start;
          if (hits.length > 1) rec.rem.push('Also listed elsewhere today: ' + hits.slice(1).map(function (x) { return (x.B.court ? 'Court ' + x.B.court + ' ' : '') + x.B.label + ' Sr. ' + x.it.sr; }).join('; ') + '.');
          var C = D.courts[key] = D.courts[key] || { notes: [] };
          C.f = 'hc'; C.title = 'High Court' + (B.court ? ', Court ' + B.court : '') + ' — ' + rec.coram + ' — ' + B.label + (B.at ? ' — at ' + B.at : '');
          C.bk = breakdown(B); C.total = B.items.length; addNotes(C, B.notes);
        });
      });
    });
  }

  /* ---- MAT Nagpur ---- */
  function stepMat(cases) {
    log('MAT Nagpur: reading the board display…');
    var job = new Job(), D = day(W.iso, true);
    return matBoards(job, W.iso).then(function (res) {
      if (!res.boards.length) {
        var msg = 'MAT Nagpur board for ' + dmy(W.iso) + ' is not on the site' + (res.latest ? ' (latest board: ' + dmy(res.latest) + ')' : '') + '.';
        log(msg, 'warn');
        cases.forEach(function (c) { D.cases[c.id] = { f: 'mat', rem: [msg] }; });
        job.drop(); return;
      }
      var parsed = [], p = Promise.resolve();
      res.boards.forEach(function (b) {
        p = p.then(function () {
          return job.get(b.url, { ref: 'https://mat.maharashtra.gov.in/', bin: true }).then(function (r) {
            return pdfLines(b64bytes(r.b64)).then(function (lines) {
              if (lines.length < 3) log('MAT: "' + b.label + '" has no readable text (a scanned page) — open it from the MAT site.', 'warn');
              var B = parseGeneric(lines, b.label); B.url = b.url; parsed.push(B);
            });
          }).catch(function (e) { log('MAT: could not read "' + b.label + '" (' + e.message + ')', 'warn'); });
        });
      });
      return p.then(function () {
        job.drop();
        log('MAT: ' + parsed.length + ' board(s) read.');
        cases.forEach(function (c) { placeGeneric(c, parsed, 'mat', D, 'MAT Nagpur'); });
        parsed.forEach(function (B) { if (B.notes.length && !B.items.length) { var k = 'MAT~' + B.label; var C = D.courts[k] = D.courts[k] || { notes: [] }; C.f = 'mat'; C.title = 'MAT Nagpur — ' + B.label; addNotes(C, B.notes); } });
      });
    });
  }
  function placeGeneric(c, parsed, f, D, name) {
    var mine = caseRefsOf(c), rec = D.cases[c.id] = { f: f, rem: [] };
    if (!mine.length) { rec.rem.push('Case number not recorded in a form that can be looked up (e.g. O.A. 297/2026).'); return; }
    var hits = [];
    parsed.forEach(function (B) { B.items.forEach(function (it) { var h = refHit(mine, it.refs); if (h) hits.push({ B: B, it: it, exact: h.exact }); }); });
    if (!hits.length) { rec.rem.push('Not found on the ' + name + ' board of ' + dmy(W.iso) + '.'); return; }
    var h = hits[0], B = h.B, it = h.it, hints = orderHints(B), ps = position(B, it, hints), key = f.toUpperCase() + '~' + B.label;
    rec.ck = key; rec.sr = it.sr; rec.list = B.label; rec.stg = stageWord(it.sec); rec.stgFull = it.sec; rec.remark = it.remark;
    rec.coram = B.coram.join(' & '); rec.pos = ps.pos; rec.tot = ps.total; rec.inSec = ps.inSec; rec.secTot = ps.secTotal;
    if (hints.timed[it.sr]) rec.time = hints.timed[it.sr].at;
    if (hits.length > 1) rec.rem.push('Also on: ' + hits.slice(1).map(function (x) { return x.B.label + ' Sr. ' + x.it.sr; }).join('; ') + '.');
    var C = D.courts[key] = D.courts[key] || { notes: [] };
    C.f = f; C.title = name + ' — ' + (rec.coram || B.label); C.bk = breakdown(B); C.total = B.items.length; addNotes(C, B.notes);
  }

  /* ---- CAT Mumbai (Nagpur sittings) ---- */
  function stepCat(cases) {
    log('CAT: reading the cause list…');
    var job = new Job(), D = day(W.iso, true);
    return catList(job, W.iso).then(function (res) {
      job.drop();
      if (res.err || !res.rows.length) {
        var msg = res.err || ('CAT cause list for ' + dmy(W.iso) + ' is not on the site yet.');
        log('CAT: ' + msg, 'warn');
        cases.forEach(function (c) { D.cases[c.id] = { f: 'cat', rem: [msg] }; });
        return;
      }
      log('CAT: ' + res.rows.length + ' entries read.');
      cases.forEach(function (c) {
        var mine = caseRefsOf(c), rec = D.cases[c.id] = { f: 'cat', rem: [] };
        var hits = res.rows.filter(function (r) { return refHit(mine, r.refs); });
        if (!hits.length) { rec.rem.push('Not found in the CAT cause list of ' + dmy(W.iso) + '.'); return; }
        var o = Object.assign({}, hits[0].ctx, hits[0].o);
        rec.sr = pick(o, /^(item|sr|s_?no|serial|srno|item_?no)/i) || '';
        rec.court = pick(o, /court|bench_?no|hall/i);
        rec.coram = pick(o, /coram|member|judge/i);
        rec.stg = pick(o, /stage|purpose|listing_?type|list_?type|category/i);
        rec.remark = pick(o, /remark|note/i);
        rec.ck = 'CAT~' + (rec.court || rec.coram || 'list');
        var C = D.courts[rec.ck] = D.courts[rec.ck] || { notes: [] }; C.f = 'cat'; C.title = 'CAT Mumbai Bench (Nagpur sitting)' + (rec.court ? ' — Court ' + rec.court : '') + (rec.coram ? ' — ' + rec.coram : '');
        if (hits.length > 1) rec.rem.push('More than one entry matches — please check.');
      });
    });
  }

  /* ---- the results inside the window ---- */
  function showResults() {
    var el = document.getElementById('lstRes'); if (!el || !W) return;
    var D = day(W.iso, false); if (!D) { el.innerHTML = ''; return; }
    el.innerHTML = '<h4>What will show on the board</h4>' +
      '<table class="lt"><thead><tr><th>Matter</th><th>Court position</th></tr></thead><tbody>' +
      W.cases.map(function (c) { return '<tr><td><b>' + esc(c.cn || '') + '</b><br>' + esc(typeof ctit === 'function' ? ctit(c) : '') + '<br><span style="color:#888">' + esc(c.court || '') + '</span></td><td>' + (cellHTML(c, W.iso, false) || '<span style="color:#888">—</span>') + '</td></tr>'; }).join('') +
      '</tbody></table>' + notesHTML(W.iso, false, true) +
      '<div style="margin-top:10px;text-align:right"><button class="btn bg" onclick="lstClose()">Done &mdash; back to the board</button></div>';
  }

  /* ================================================================ on the board */
  function bkText(C, kindOnly) {
    if (!C || !C.bk || !C.bk.length) return '';
    return C.bk.filter(function (x) { return !kindOnly || !x.list || x.list === kindOnly; })
      .map(function (x) { return esc(x.s) + ' ' + x.a + (x.b !== x.a ? '–' + x.b : ''); }).join(' &middot; ');
  }
  function cellHTML(c, iso, print) {
    var D = day(iso, false); if (!D || !D.cases) return '';
    var r = D.cases[c.id]; if (!r) return '';
    var C = r.ck ? D.courts[r.ck] : null, out = [];
    if (r.leave) out.push('<span class="lv">ON LEAVE</span>' + esc(r.leave.kind || '') + ' ' + esc(dmy(r.leave.from)) + '–' + esc(dmy(r.leave.to)));
    if (r.f === 'dc') {
      var j = [r.judge, r.des].filter(Boolean).join(', ');
      if (j || r.room) out.push(esc(j) + (r.room ? ' &middot; <b>Room ' + esc(r.room) + '</b>' : ''));
      if (r.sr) out.push('<span class="sr">Sr. ' + esc(r.sr) + '</span>' + esc(r.list || '') + (r.stg ? ' &middot; ' + esc(r.stg) : '') + (r.tot ? ' &middot; ' + r.pos + ' of ' + r.tot : ''));
      if (r.sr && C && C.bk && C.bk.length > 1) out.push('<span class="bk">' + bkText(C, r.list) + '</span>');
    } else {
      if (r.sr || r.court || r.stg) out.push((r.sr ? '<span class="sr">Sr. ' + esc(r.sr) + '</span>' : '') + [r.court, r.list].filter(Boolean).map(esc).join(' &middot; ') + (r.stg ? ' &middot; <b>' + esc(r.stg) + '</b>' : ''));
      if (r.coram && !print) out.push(esc(r.coram));
      if (r.remark) out.push(esc(r.remark));
      if (r.with) out.push('Listed with ' + esc(r.with));
      if (r.time) out.push('&#9200; Taken up at ' + esc(r.time));
      if (r.sr && r.tot) out.push('<span class="bk">' + (r.inSec && r.secTot ? r.inSec + ' of ' + r.secTot + ' in ' + esc(r.stg || 'its stage') + '; ' : '') + 'about ' + r.pos + ' of ' + r.tot + ' on the board' + (r.start ? ' (board starts at Sr. ' + r.start + ')' : '') + '</span>');
      if (r.sr && C && C.bk && C.bk.length) out.push('<span class="bk">' + bkText(C) + '</span>');
    }
    (r.rem || []).forEach(function (x) { out.push('<span class="rm">&#9888; ' + esc(x) + '</span>'); });
    if (!out.length) return '';
    return '<div class="lstcell">' + out.join('<br>') + '</div>';
  }
  function notesHTML(iso, print, inWindow) {
    var D = day(iso, false); if (!D || !D.courts) return '';
    var keys = Object.keys(D.courts).filter(function (k) { var C = D.courts[k]; return (C.notes || []).some(function (n) { return !print || !n.x; }) || (C.leave && !print); });
    if (!keys.length) return '';
    var ed = !print && (typeof can !== 'function' || can('edit'));
    return '<div class="lstnotes"><b>Court notes for ' + esc(dmy(iso)) + '</b>' + (ed ? ' <span style="color:#888">(strike out any that do not matter; struck notes are left off the printout)</span>' : '') +
      keys.map(function (k) {
        var C = D.courts[k];
        var ns = (C.notes || []).map(function (n, i) { return { n: n, i: i }; }).filter(function (x) { return !print || !x.n.x; });
        return '<div class="ct">' + esc(C.title || k) + (C.leave ? ' <span style="color:#b3261e">— judge on leave ' + esc(dmy(C.leave.from)) + '–' + esc(dmy(C.leave.to)) + '</span>' : '') + '</div>' +
          ns.map(function (x) {
            return '<div class="nt' + (x.n.x ? ' x' : '') + '">&bull; ' + esc(x.n.t) +
              (ed ? '<button onclick="lstStrike(\'' + iso + '\',\'' + encodeURIComponent(k) + '\',' + x.i + ')">' + (x.n.x ? 'restore' : 'strike out') + '</button>' +
                (x.n.x ? ' <span style="font-size:9.5px;color:#999;text-decoration:none">struck by ' + esc(x.n.x.by) + ', ' + esc(String(x.n.x.at).slice(0, 16).replace('T', ' ')) + '</span>' : '') : '') + '</div>';
          }).join('');
      }).join('') + '</div>';
  }
  window.lstStrike = function (iso, k, i) {
    k = decodeURIComponent(k);
    var D = day(iso, false); if (!D || !D.courts[k]) return;
    var n = D.courts[k].notes[i]; if (!n) return;
    if (typeof guard === 'function' && !guard('edit')) return;
    if (n.x) delete n.x; else n.x = { by: user(), at: new Date().toISOString() };
    try { if (typeof logAct === 'function') logAct((n.x ? 'Struck out' : 'Restored') + ' court note on ' + iso + ': ' + n.t.slice(0, 60)); } catch (e) {}
    save();
    if (W) showResults();
    try { if (typeof refresh === 'function') refresh(); } catch (e) {}
  };
  window.lstCell = cellHTML;
  window.lstNotes = notesHTML;
  window.lstHas = function (iso) { var D = day(iso, false); return !!(D && D.at); };
  window.lstWhen = function (iso) { var D = day(iso, false); return D && D.at ? D.at : ''; };
  /* the judge to print when none was typed on the board */
  window.lstJudge = function (c, iso) { var D = day(iso, false), r = D && D.cases && D.cases[c.id]; return r && r.f === 'dc' ? [r.judge, r.room ? 'Room ' + r.room : ''].filter(Boolean).join(' · ') : ''; };

  try { css(); } catch (e) {}

  /* for testing from the browser console */
  window.__lst = { refs: refs, sameName: sameName, sameDes: sameDes, desKey: desKey, parseHc: parseHc, parseDcList: parseDcList, parseGeneric: parseGeneric,
                   orderHints: orderHints, breakdown: breakdown, position: position, pdfLines: pdfLines, tbls: tbls, parseJudgeRows: parseJudgeRows, nameKey: nameKey, caseRefsOf: caseRefsOf, refHit: refHit };
})();
