/* ==================================================================
   CHARPE SUITE — BOMBAY HIGH COURT WEBSITE (no CAPTCHA)     31 Oct 2026
   An ALTERNATE route for High Court cases. The existing eCourts CAPTCHA
   route ("Fetch from High Court", "Official eCourts") is not changed.

   bombayhighcourt.gov.in/bhc answers a search by case type / number / year
   without a CAPTCHA. Through Charpe Helper (v13) on this PC this file:
     • reads the case details: next listing date, status, stage, last coram
     • adds every order as a PDF and downloads it into Drive as usual
     • puts each listing date's remark ("S.O. two weeks", "Issue notice…")
       into the case's order sheets
   Next dates follow the same safety rules as every other fetch.
   ================================================================== */
(function () {
  var BASE = 'https://bombayhighcourt.gov.in';
  var TYPES = {};                       /* case types per bench, from the site */

  function q(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function iso(s) { var m = String(s || '').match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); return m ? m[3] + '-' + pad(m[2]) + '-' + pad(m[1]) : ''; }
  function h5(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function hp(body) {
    if (typeof window.charpeHelperPost !== 'function') return Promise.reject(new Error('Charpe Helper is not available on this page.'));
    return window.charpeHelperPost(body, 120000).catch(function (e) {
      if (/Failed to fetch|NetworkError|aborted/i.test(e.message || '')) throw new Error('Charpe Helper on this PC is not answering. Open 127.0.0.1:8770 in Chrome to check it is running.');
      if (/Unknown action/i.test(e.message || '')) throw new Error('Charpe Helper on this PC is an older version. Install Charpe Helper version 13 ("Install Charpe Helper.bat").');
      throw e;
    });
  }

  function isHC(c) { var t = String(c && c.court || ''); return /high\s*court|\bH\.?\s*C\b/i.test(t) && !/supreme/i.test(t); }
  function bench(c) {
    var t = String(c && c.court || '');
    if (/aurangabad|sambhaji/i.test(t)) return 'aurangabad';
    if (/\bgoa\b/i.test(t)) return 'goa';
    if (/principal|mumbai/i.test(t) && !/nagpur/i.test(t)) return 'principal';
    return 'nagpur';
  }
  function caseNo(text) {
    var t = q(text).replace(/[ ]/g, ' ');
    var m = t.match(/^\s*([A-Za-z][A-Za-z.()\s\/-]*?)\s*(?:No\.?\s*)?(\d{1,6})\s*(?:\/|of)\s*(\d{4})/i);
    return m ? { abbr: m[1].replace(/[^A-Za-z]/g, '').toUpperCase(), no: String(+m[2]), year: m[3] } : null;
  }
  /* the site's case types for this abbreviation, best first: "CRWP" / "Cri WP" → the criminal type first */
  function candidates(types, abbr) {
    var lead = function (t) { return String(t || '').split(/\s+-\s+/)[0].replace(/[^A-Za-z]/g, '').toUpperCase(); };
    var crimT = function (t) { return /crim|\bcr\b|cr\./i.test(t); };
    var crim = /^CRI?/.test(abbr) && abbr.length > 3, core = abbr.replace(/^CRI?/, '');
    var same = types.filter(function (x) { return lead(x.t) === abbr; });
    if (!same.length && crim) same = types.filter(function (x) { return lead(x.t) === core; });
    same.sort(function (a, b) { return (crimT(a.t) === crim ? 0 : 1) - (crimT(b.t) === crim ? 0 : 1); });
    return same;
  }

  /* ---------------- reading the answer ---------------- */
  function parse(page) {
    var dom = new DOMParser().parseFromString('<div>' + String(page || '') + '</div>', 'text/html');
    var d = { found: false, hist: [], orders: [], listing: [] };
    var up = dom.getElementById('cn_CaseNoUpdates');
    if (!up) return d;
    d.found = true;
    var kv = {};
    Array.prototype.forEach.call(up.querySelectorAll('b, strong, th'), function (b) {
      var k = q(b.textContent).toLowerCase(); if (!k || kv[k] !== undefined) return;
      var v = b.nextElementSibling || (b.parentElement && b.parentElement.nextElementSibling);
      if (v && !/^(b|strong|th)$/i.test(v.tagName)) kv[k] = q(v.textContent);
    });
    var lead = q(up.textContent);
    var lm = lead.match(/Case No\.?\s*(\S+)\s+with CNR No\.?\s*([A-Z0-9]{16})/i);
    d.cnr = lm ? lm[2] : '';
    d.ctype = lm ? lm[1].split('/')[0] : '';
    /* a value next to its label, or failing that the date that follows the label in the text */
    var after = function (label) { var m = lead.match(new RegExp(label + '\\s*(\\d{1,2}/\\d{1,2}/\\d{4})', 'i')); return m ? iso(m[1]) : ''; };
    d.filing = kv['filing number'] || '';
    d.reg = iso(kv['registration date']) || after('Registration Date');
    d.next = iso(kv['next listing date']) || after('Next Listing Date');
    d.status = kv['status'] || '';
    d.stage = (kv['stage'] || '').replace(/\s*\(\d+\)\s*$/, '');
    d.judge = kv['last coram'] || '';
    d.last = iso(kv['last date']) || after('Last Date');
    var pm = lead.match(/filed on [\d\/]+ at .*? by (.*?) against (.*?) Filing Number/i);
    d.pet = pm ? pm[1] : ''; d.res = pm ? pm[2] : '';
    d.disposed = /dispos/i.test(d.status + ' ' + d.stage);
    d.purpose = d.stage;

    var od = dom.getElementById('cn_CaseNoOrders');
    if (od) Array.prototype.forEach.call(od.querySelectorAll('tr'), function (tr) {
      var a = tr.querySelector('a[href*="/casestatus/order-pdf/"]'); if (!a) return;
      var cells = Array.prototype.map.call(tr.cells, function (x) { return q(x.textContent); });
      var url = a.getAttribute('href'); if (!/^https?:/.test(url)) url = BASE + (url.charAt(0) === '/' ? '' : '/') + url;
      var path = url.replace(/\?.*$/, ''), pp = path.split('/');      /* …/order-pdf/<CNR>/<yyyy-mm-dd>/<no> */
      d.orders.push({ path: path, url: url, no: pp[pp.length - 1] || cells[0] || '', d: /^\d{4}-\d{2}-\d{2}$/.test(pp[pp.length - 2]) ? pp[pp.length - 2] : iso(cells[2]),
        title: (cells[3] || 'Order').replace(/\s*\(\d+\)\s*$/, '') || 'Order', j: cells[1] || '' });
    });

    var ld = dom.getElementById('cn_CaseNoListing');
    if (ld) Array.prototype.forEach.call(ld.querySelectorAll('tr'), function (tr) {
      var c = Array.prototype.map.call(tr.cells, function (x) { return q(x.textContent); });
      if (c.length < 4 || !iso(c[1])) return;
      d.listing.push({ d: iso(c[1]), j: c[2], remark: c[3].replace(/\\'/g, "'") });
    });

    /* applications filed in this matter (e.g. CAF 668/2021 in FA 544/2021): their numbers, fetched next */
    d.apps = [];
    var ap = dom.getElementById('cn_CaseNoApplCases');
    if (ap) Array.prototype.forEach.call(ap.querySelectorAll('tr'), function (tr) {
      var c = Array.prototype.map.call(tr.cells, function (x) { return q(x.textContent); });
      if (c.length < 4) return;
      var no = c[c.length - 1], cnr = (c.join(' ').match(/\b[A-Z]{4}\d{12}\b/) || [''])[0];
      if (/^[A-Za-z][A-Za-z.]*\/\d+\/\d{4}$/.test(no)) d.apps.push({ no: no, cnr: cnr });
    });
    return d;
  }
  window.bhcParse = parse;

  /* ---------------- putting it on the case ---------------- */
  function save(c, d, bn) {
    var e = c.eco = c.eco || {}; e.ord = e.ord || {};
    /* an order already listed from eCourts (same date and number) keeps its place and gets this link */
    var known = {};
    Object.keys(e.ord).forEach(function (k) { var o = e.ord[k]; if (o && o.d) known[o.d + '|' + String(o.no || '')] = k; });
    var orders = d.orders.map(function (o) {
      return { key: known[o.d + '|' + o.no] || ('b' + h5(o.path)), no: o.no, d: o.d, title: o.title, a: ['BHC', o.url, bn] };
    });
    /* orders in applications: their own entries, labelled with the application; the orders list and the
       one-PDF join already run in date order, so they fall in between the main case's orders by date */
    (d.appData || []).forEach(function (x) {
      x.d.orders.forEach(function (o) {
        orders.push({ key: 'b' + h5(o.path), no: o.no, d: o.d, title: o.title + ' — in ' + x.label, a: ['BHC', o.url, bn] });
      });
    });
    var res = ECO.api.apply(c.id, { found: true, ctype: d.ctype, filing: d.filing, reg: d.reg, status: d.status, stage: d.stage, judge: d.judge,
      pet: d.pet, res: d.res, next: d.next, purpose: d.purpose, disposed: d.disposed, hist: [], orders: orders });
    if (d.cnr && !c.cnr) c.cnr = d.cnr;
    /* listing remarks → order sheets (the text of what happened on each date) */
    e = c.eco; e.hh = e.hh || [];
    var added = 0;
    d.listing.forEach(function (l) {
      var h = e.hh.filter(function (x) { return x.bd === l.d; })[0];
      if (!h) { h = { d: '', bd: l.d, p: '', j: l.j, a: null }; e.hh.push(h); added++; }
      if (!h.biz) h.biz = l.remark;
      if (!h.j) h.j = l.j;
    });
    /* listing remarks in applications go on the same date's order sheet, marked with the application */
    (d.appData || []).forEach(function (x) {
      x.d.listing.forEach(function (l) {
        var t = '[' + x.label + '] ' + l.remark, h = e.hh.filter(function (y) { return y.bd === l.d; })[0];
        if (!h) { e.hh.push({ d: '', bd: l.d, p: '', j: l.j, a: null, biz: t }); return; }
        if (String(h.biz || '').indexOf(t) < 0) h.biz = h.biz ? h.biz + '\n' + t : t;
      });
    });
    e.hh.sort(function (a, b) { return String(a.bd || a.d) < String(b.bd || b.d) ? -1 : 1; });
    e.bhcAt = new Date().toISOString();
    if (typeof touch === 'function') touch(c);
    if (typeof saveAll === 'function') saveAll();
    var nPend = Object.keys(e.ord).filter(function (k) { return !e.ord[k].fid && e.ord[k].a && e.ord[k].a[0] === 'BHC'; }).length;
    if (nPend) ECO.api.queueCase(c.id, 'B:' + c.id, -1);
    var apNote = (d.appData || []).length ? ' &middot; applications: ' + d.appData.map(function (x) { return esc(x.label) + ' (' + x.d.orders.length + ' order' + (x.d.orders.length === 1 ? '' : 's') + ')'; }).join(', ') : '';
    var apMiss = (d.appMiss || []).length ? ' &middot; <span style="color:#a35b00">not found on the site: ' + esc(d.appMiss.join(', ')) + '</span>' : '';
    return res.html + ' &middot; ' + d.listing.length + ' listing remark' + (d.listing.length === 1 ? '' : 's') + ' in the order sheets' + apNote + apMiss + '.';
  }

  /* order PDFs from the Bombay High Court site: fetched by the helper, then kept in Drive as usual */
  var prevTOP = window.trOrderPost;
  window.trOrderPost = function (c, o, b) {
    if (!(o && o.a && o.a[0] === 'BHC')) return prevTOP ? prevTOP(c, o, b) : null;
    return hp({ action: 'bhcpdf', url: o.a[1], bench: o.a[2] || 'nagpur' }).then(function (r) {
      if (r.missing || !r.b64) return { ok: true, missing: true, msg: r.msg || 'not available' };
      var nm = ((b.d || 'undated') + ' ' + (b.title || 'Order') + (b.no ? ' No ' + b.no : '')).replace(/[\\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
      return ECO.api.post({ action: 'upload', cnr: b.cnr, label: b.label, name: nm, b64: r.b64 })
        .then(function (x) { x.b64 = r.b64; return x; });
    }).catch(function (e) { return { ok: true, missing: true, msg: e.message || 'could not be fetched' }; });
  };

  /* ---------------- the fetch ---------------- */
  function types(bn) {
    if (TYPES[bn]) return Promise.resolve(TYPES[bn]);
    return hp({ action: 'bhctypes', bench: bn }).then(function (r) { TYPES[bn] = r.types || []; return TYPES[bn]; });
  }
  /* one search by number: tries each matching case type (e.g. civil WP, then criminal WP) */
  function findOne(bn, ts, n) {
    var cand = candidates(ts, n.abbr);
    if (!cand.length) return Promise.resolve({ none: 'no case type "' + n.abbr + '"' });
    var i = 0;
    function next() {
      if (i >= cand.length) return Promise.resolve({ none: cand[0].t + ' ' + n.no + '/' + n.year + ' not found' });
      var t = cand[i++];
      return hp({ action: 'bhcfind', bench: bn, type: t.v, no: n.no, year: n.year }).then(function (r) { return r.found ? { r: r, t: t } : next(); });
    }
    return next();
  }
  function fetchCase(c, say) {
    var n = caseNo(c.cn || ''), bn = bench(c);
    if (!n) return Promise.reject(new Error('The case number "' + (c.cn || '') + '" could not be read. Write it like "WP 3692/2026".'));
    return types(bn).then(function (ts) {
      return findOne(bn, ts, n).then(function (hit) {
        if (!hit.r) throw new Error('No ' + (hit.none || 'such case') + ' on the Bombay High Court site (' + bn + ' bench).');
        var d = parse(hit.r.page);
        if (!d.found) throw new Error('The Bombay High Court page could not be read.');
        /* then each application filed in the matter, one after another */
        d.appData = []; d.appMiss = [];
        var p = Promise.resolve();
        d.apps.forEach(function (a, k) {
          p = p.then(function () {
            if (say) say('Main case read. Application ' + (k + 1) + ' of ' + d.apps.length + ': ' + a.no + '…');
            var an = caseNo(a.no);
            if (!an) { d.appMiss.push(a.no); return; }
            return findOne(bn, ts, an).then(function (h2) {
              var x = h2.r ? parse(h2.r.page) : null;
              if (x && x.found) d.appData.push({ label: a.no.replace(/\//, ' ').replace(/\s+/, ' '), d: x }); else d.appMiss.push(a.no);
            }).catch(function () { d.appMiss.push(a.no); });
          });
        });
        return p.then(function () { return { d: d, html: save(c, d, bn), type: hit.t.t }; });
      });
    });
  }

  function box(title, html) {
    var o = document.getElementById('bhcbox'); if (o) o.remove();
    o = document.createElement('div'); o.id = 'bhcbox';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(10,18,32,.5);z-index:99990;display:flex;align-items:flex-start;justify-content:center;padding:70px 12px';
    o.innerHTML = '<div style="background:#fff;color:#1a2744;border-radius:10px;max-width:620px;width:100%;box-shadow:0 14px 40px rgba(0,0,0,.35)">' +
      '<div style="padding:10px 16px;background:#1b2a4a;color:#fff;border-radius:10px 10px 0 0;font-weight:700;font-size:13px">' + esc(title) + '</div>' +
      '<div id="bhcmsg" style="padding:14px 16px;font-size:13px;line-height:1.55">' + html + '</div>' +
      '<div style="text-align:right;padding:0 16px 14px"><button class="btn bg" onclick="document.getElementById(\'bhcbox\').remove()">Close</button></div></div>';
    o.addEventListener('click', function (ev) { if (ev.target === o) o.remove(); });
    document.body.appendChild(o);
  }
  window.bhcFetch = function (id) {
    var c = find(id); if (!c) return;
    box('Bombay High Court website — ' + (c.cn || ''), 'Fetching from bombayhighcourt.gov.in through Charpe Helper (no CAPTCHA)…');
    fetchCase(c, function (t) { var m = document.getElementById('bhcmsg'); if (m) m.textContent = t; }).then(function (x) {
      if (typeof logAct === 'function') logAct('Bombay HC site fetched for ' + (typeof ctit === 'function' ? ctit(c) : c.cn));
      try { refresh(); } catch (e) {}
      var m = document.getElementById('bhcmsg');
      if (m) m.innerHTML = '<div style="color:#127a4b;font-weight:600;margin-bottom:6px">&#10003; Found as ' + esc(x.type) + (x.d.cnr ? ' &middot; CNR ' + esc(x.d.cnr) : '') + '</div>' + x.html +
        '<div style="margin-top:8px;font-size:12px;color:#555">Order PDFs download in the background into Drive — see <b>Orders &amp; order sheets</b> on the case.</div>';
    }).catch(function (e) {
      var m = document.getElementById('bhcmsg');
      if (m) m.innerHTML = '<span style="color:#b3261e">' + esc(e.message || String(e)) + '</span>';
    });
  };

  /* ---------------- one extra button on High Court cases ---------------- */
  if (typeof window.bldRow === 'function') {
    var _b = window.bldRow;
    window.bldRow = bldRow = function (c) {
      var h = _b.apply(this, arguments);
      if (!isHC(c)) return h;
      var btn = '<button class="btn bg" onclick="event.stopPropagation();bhcFetch(\'' + c.id + '\')" title="Next date, orders and listing remarks from the Bombay High Court\'s own website (bombayhighcourt.gov.in) — no CAPTCHA. Needs Charpe Helper version 13 on this PC.">&#9878; Bombay HC site (no CAPTCHA)</button>';
      var at = '<button class="btn bo" onclick="event.stopPropagation();prtC(';
      return h.indexOf(at) >= 0 ? h.replace(at, btn + at) : h;
    };
  }
})();
