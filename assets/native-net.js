/* ============================================================================
   Charpe Suite — the phone's own fetching engine                      Nov 2026
   ----------------------------------------------------------------------------
   On the office PCs, Charpe Helper (charpe-helper.pyw, v13) fetches the court
   sites from the office's own connection. On the Android app there is no
   Python, so this file does the same job inside the app, from the PHONE's own
   connection (Jio / Airtel / Wi-Fi) — which the court sites treat like any
   person visiting them in Chrome.

   It is a line-by-line port of the helper: the same actions, the same answers,
   so cases.html, ecourts.js, tribunals.js, bhc.js and orders.js work unchanged.
   The app sends every request the page makes to http://127.0.0.1:8770/ here
   instead (see android/.../charpe-wrap.js).

   The actual network calls go through the app (window.CharpeNet), which keeps a
   separate set of cookies for every CAPTCHA search, exactly like the helper's
   separate sessions. In an ordinary browser this file does nothing.

   When a court changes its website, fix it here (and in the helper): the app
   loads this file from the site, so the phone picks up the fix without a
   reinstall.
   ========================================================================== */
(function () {
  'use strict';
  if (window.CharpeEngine) return;
  var NET = window.CharpeNet;
  if (!NET || typeof NET.postMessage !== 'function') return;

  var VERSION = 13;
  var ENGINE = 'android';

  /* ------------------------------------------------------------ the app link */
  var seq = 0, pending = {};
  NET.addEventListener('message', function (ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    var p = pending[m.id];
    if (!p) return;
    delete pending[m.id];
    p(m);
  });
  function native(msg) {
    return new Promise(function (resolve) {
      msg.id = 'n' + (++seq) + '_' + Date.now();
      pending[msg.id] = resolve;
      NET.postMessage(JSON.stringify(msg));
    });
  }

  /* a "session" = one cookie jar inside the app, like requests.Session() */
  function newSession() { return { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) }; }
  function dropSession(s) { if (s && s.id) native({ op: 'drop', sess: s.id }); }

  /* one request. opt: {headers, body (string), form (object), bin (true = bytes back), timeout} */
  function request(s, method, url, opt) {
    opt = opt || {};
    var headers = Object.assign({}, opt.headers || {});
    var body = opt.body;
    if (opt.form) {
      body = formEncode(opt.form);
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return native({ op: 'req', sess: s.id, method: method, url: url, headers: headers, body: body == null ? null : String(body),
                    bin: !!opt.bin, timeout: opt.timeout || 60 }).then(function (r) {
      if (!r.ok) throw new Error(r.err || 'network error');
      return new Resp(r);
    });
  }
  function hasHeader(h, name) { for (var k in h) if (k.toLowerCase() === name) return true; return false; }
  function formEncode(o) {
    var out = [];
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (v === undefined) return;
      out.push(qp(k) + '=' + qp(v == null ? '' : String(v)));
    });
    return out.join('&');
  }
  function qp(s) { return encodeURIComponent(s).replace(/%20/g, '+'); }   /* like requests: spaces as + */
  function quote(s) { return encodeURIComponent(String(s == null ? '' : s)); }

  function Resp(r) {
    this.status = r.status;
    this.ctype = r.ctype || '';
    this._text = r.text;
    this.b64 = r.b64 || '';
  }
  Resp.prototype = {
    get text() {
      if (this._text != null) return this._text;
      this._text = new TextDecoder('utf-8').decode(this.bytes());
      return this._text;
    },
    bytes: function () {
      if (this._bytes) return this._bytes;
      var b = atob(this.b64 || ''), u = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      return (this._bytes = u);
    },
    json: function () { return JSON.parse(stripBom(this.text)); },
    /* where "%PDF" starts in the first 64 bytes, or -1 */
    pdfAt: function () {
      var u = this.bytes(), n = Math.min(u.length - 3, 64);
      for (var i = 0; i < n; i++) if (u[i] === 37 && u[i + 1] === 80 && u[i + 2] === 68 && u[i + 3] === 70) return i;
      return -1;
    },
    pdfB64From: function (k) {
      if (!k) return this.b64;
      var u = this.bytes().subarray(k), s = '', CH = 0x8000;
      for (var i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
      return btoa(s);
    },
    dataUrl: function () { return 'data:' + ((this.ctype || 'image/png').split(';')[0]) + ';base64,' + this.b64; }
  };
  function stripBom(t) { return String(t || '').replace(/^﻿/, ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function get(s, url, referer, xhr, bin) {
    var h = { Referer: referer || url };
    if (xhr) { h.Accept = 'application/json, text/javascript, */*; q=0.01'; h['X-Requested-With'] = 'XMLHttpRequest'; }
    var last = null, attempt = 0;
    function go() {
      return request(s, 'GET', url, { headers: h, bin: bin }).catch(function (e) {
        last = e;
        if (++attempt >= 3) throw new Error('The site could not be reached just now (' + String(last && last.message || last).slice(0, 80) + '). Please try again.');
        return sleep(1000 * attempt).then(go);
      });
    }
    return go();
  }
  function post(s, url, opt) { return request(s, 'POST', url, opt); }

  /* ------------------------------------------------------------ text helpers (same as the helper) */
  var TA = null;
  function unent(h) {
    var s = String(h == null ? '' : h).replace(/&nbsp/g, ' ').replace(/ /g, ' ');
    if (s.indexOf('&') < 0) return s;
    TA = TA || document.createElement('textarea');
    TA.innerHTML = s;
    return TA.value.replace(/ /g, ' ');
  }
  function strip(h) {
    h = String(h == null ? '' : h);
    h = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
    h = h.replace(/<br\s*\/?>/gi, '\n');
    h = h.replace(/<\/(p|div|tr|li|h\d)>/gi, '\n');
    h = unent(h.replace(/<[^>]+>/g, ' '));
    h = h.replace(/[ \t\r\f\v]+/g, ' ');
    h = h.replace(/ *\n */g, '\n');
    return h.replace(/\n{2,}/g, '\n').trim();
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, ''); }
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function p2(n) { n = parseInt(n, 10); return (n < 10 ? '0' : '') + n; }
  function iso(s) {
    s = String(s == null ? '' : s);
    var m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]);
    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,})\.?,?[\s-]+(\d{4})/);
    if (m && MON.indexOf(m[2].slice(0, 3).toLowerCase()) >= 0) return m[3] + '-' + p2(MON.indexOf(m[2].slice(0, 3).toLowerCase()) + 1) + '-' + p2(m[1]);
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  }
  function tables(h) {
    var out = [], m, rx = /<table([^>]*)>([\s\S]*?)<\/table>/gi;
    while ((m = rx.exec(h))) {
      var rows = [], r, rr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      while ((r = rr.exec(m[2]))) {
        var cells = [], c, rc = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
        while ((c = rc.exec(r[1]))) cells.push({ raw: unent(c[2] + ' ' + c[3]), t: strip(c[3]) });
        if (cells.length) rows.push(cells);
      }
      out.push(rows);
    }
    return out;
  }
  function headerIndex(row, words) {
    for (var i = 0; i < row.length; i++) {
      var t = norm(row[i].t);
      for (var j = 0; j < words.length; j++) if (t.indexOf(words[j]) >= 0) return i;
    }
    return -1;
  }
  /* md5 of the URL, first 14 hex — the same key the helper gives an order (so nothing is fetched twice) */
  function md5k(t) { return md5(unescape(encodeURIComponent(String(t)))).slice(0, 14); }
  function uid() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function now() { return Date.now() / 1000; }
  function str(x) { return x == null ? '' : String(x); }

  var SESS = {};          /* CAPTCHA searches in progress, by sid */
  function sweep() {      /* forget searches older than 30 minutes, and their cookies */
    var t = now();
    Object.keys(SESS).forEach(function (k) { if (t - SESS[k].at > 1800) { dropSession(SESS[k].s); delete SESS[k]; } });
  }

  /* ================================================================ SUPREME COURT */
  var SCI_BASE = 'https://www.sci.gov.in';
  var SCI_AJAX = SCI_BASE + '/wp-admin/admin-ajax.php';
  var SCI_S = { s: null, at: 0, p: null };

  function sciSession(force) {
    if (!force && SCI_S.s && now() - SCI_S.at <= 900) return Promise.resolve(SCI_S.s);
    if (!force && SCI_S.p) return SCI_S.p;
    var s = newSession();
    SCI_S.p = get(s, SCI_BASE + '/case-status-diary-no/').catch(function () {}).then(function () {
      if (SCI_S.s) dropSession(SCI_S.s);
      SCI_S.s = s; SCI_S.at = now(); SCI_S.p = null;
      return s;
    });
    return SCI_S.p;
  }

  function sciGet(dn, dy, tab) {
    var q = formEncode({ diary_no: dn, diary_year: dy, tab_name: tab || '', action: 'get_case_details', es_ajax_request: 1, language: 'en' });
    var ref = SCI_BASE + '/case-status-diary-no/';
    return sciSession().then(function (s) {
      return get(s, SCI_AJAX + '?' + q, ref, true);
    }).then(function (r) {
      if (r.status !== 403) return r;
      return sciSession(true).then(function (s) { return get(s, SCI_AJAX + '?' + q, ref, true); });
    }).then(function (r) {
      var j;
      try { j = r.json(); } catch (e) { throw new Error('The Supreme Court site did not answer properly (HTTP ' + r.status + ').'); }
      if (!j.success) {
        var msg;
        try { msg = JSON.parse(j.data || '{}').message; } catch (e) { msg = strip(j.data); }
        return { none: msg || 'Nothing found' };
      }
      return { html: str(j.data) };
    });
  }

  function sciDiary(b) {
    var m = str(b.diary).replace(/\s/g, '').match(/^(\d{1,7})\/(\d{4})$/);
    if (m) return [String(parseInt(m[1], 10)), m[2]];
    var c = str(b.cnr).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var n = c.match(/^SCIN\d{2}(\d{6})(\d{4})$/);
    if (n) return [String(parseInt(n[1], 10)), n[2]];
    if (b.no && b.year) return [String(parseInt(b.no, 10)), String(b.year)];
    return null;
  }

  async function sci_case(b) {
    var di = sciDiary(b);
    if (!di) throw new Error('Give the Supreme Court diary number as 12345/2025 (or the CNR beginning SCIN).');
    var dn = di[0], dy = di[1];
    var main = await sciGet(dn, dy);
    if ('none' in main) return { ok: true, notFound: true, msg: 'Supreme Court: ' + main.none };
    var h = main.html, kv = {}, kord = [];
    tables(h).forEach(function (tb) {
      tb.forEach(function (r) {
        if (r.length >= 2) { var k = norm(r[0].t); if (k && !(k in kv)) { kv[k] = r[1].t; kord.push(k); } }
      });
    });
    function g(rx) { for (var i = 0; i < kord.length; i++) if (rx.test(kord[i])) return kv[kord[i]]; return ''; }
    var tm = h.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    var title = tm ? strip(tm[1]) : '';
    var pp = title.split(/\s+vs\.?\s+/i);
    var status = g(/^statusstage/), last = g(/^presentlastlistedon/), tent = g(/^tentatively/);
    var d = { found: true, court: 'Supreme Court of India', hist: [], orders: [] };
    var cm = g(/^cnrnumber/).match(/SCIN\d{12}/);
    d.cnr = cm ? cm[0] : '';
    d.diary = dn + '/' + dy;
    d.reg = g(/^casenumber/).replace(/\s+/g, ' ').slice(0, 200);
    var ct = d.reg.match(/^([A-Za-z.() ]+?)\s*No/);
    d.ctype = ct ? ct[1] : '';
    d.pet = (g(/^petitioners?$/) || (pp[0] || '')).replace(/^\d+\s+/, '').slice(0, 600);
    d.res = (g(/^respondents?$/) || (pp.length > 1 ? pp[1] : '')).replace(/^\d+\s+/, '').slice(0, 600);
    d.status = status.slice(0, 300);
    var st = status.match(/\(([^()]*(?:\([^()]*\))?[^()]*)\)/);
    d.stage = st ? st[1] : '';
    var jm = last.match(/\[([^\]]+)\]/);
    d.judge = jm ? jm[1].replace(/([A-Z.])and /g, '$1 and ').trim() : '';
    d.lastListed = iso(last);
    d.next = iso(tent);
    if (d.next) d.purpose = 'Tentatively listed (computer generated)';
    var fx = status.match(/List On \(Date\)\s*\((\d{2}-\d{2}-\d{4})\)/i);
    if (fx && iso(fx[1]) >= (d.next || '')) { d.next = iso(fx[1]); d.purpose = 'List on (date) fixed by the Court'; }
    d.disposed = /^\s*disposed/i.test(status);
    if (d.disposed) {
      var dm = status.match(/Disposal Date:\s*([\d-]+)/i);
      d.decision = dm ? iso(dm[1]) : '';
      d.disposal = g(/^disptype/);
      d.next = '';
    }
    try {
      var ld = await sciGet(dn, dy, 'listing_dates');
      tables(ld.html || '').forEach(function (tb) {
        var head = tb.length ? tb[0] : [];
        var iD = headerIndex(head, ['cldate']), iS = headerIndex(head, ['stage']), iJ = headerIndex(head, ['judges']), iR = headerIndex(head, ['remarks']);
        if (iD < 0) return;
        tb.slice(1).forEach(function (r) {
          var dd = r.length > iD ? iso(r[iD].t) : '';
          if (!dd) return;
          var p = [iS >= 0 && iS < r.length ? r[iS].t : '', iR >= 0 && iR < r.length ? r[iR].t : ''].filter(Boolean).join(' — ');
          d.hist.push({ d: dd, bd: dd, p: p, j: iJ >= 0 && iJ < r.length ? r[iJ].t : '', a: null });
        });
      });
      d.hist.sort(function (x, y) { return x.d < y.d ? -1 : x.d > y.d ? 1 : 0; });
    } catch (e) {}
    var jo = await sciGet(dn, dy, 'judgement_orders');
    var seen = {}, m, rx = /<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a|<\/td>)/gi, jh = jo.html || '';
    while ((m = rx.exec(jh))) {
      var url = unent(m[1]);
      if (seen[url]) continue;
      seen[url] = 1;
      var lab = strip(m[3]).replace(/^[ \[\]&;]+|[ \[\]&;]+$/g, '');
      var fm = url.match(/_(\d{2}-[A-Za-z]{3}-\d{4})\.pdf$/);
      var od = iso(strip(m[2])) || (fm ? iso(fm[1]) : '');
      var kind = /judg/i.test(url + ' ' + lab) ? 'Judgment' : 'Order';
      d.orders.push({ key: md5k(url), no: '', d: od, title: kind + (lab.indexOf('ROP') >= 0 ? ' (ROP)' : ''), a: ['SCI', url] });
    }
    return { ok: true, data: d };
  }

  async function sciForm(sess) {
    var r = await get(sess.s, SCI_BASE + '/case-status-case-no/', SCI_BASE + '/');
    var h = r.text;
    var fm = h.match(/<form[^>]*id=["']sciapi-services-case-status-case-no["'][\s\S]*?<\/form>/i);
    if (!fm) throw new Error('The Supreme Court search form could not be read.');
    var f = fm[0], fields = {};
    (f.match(/<input[^>]*>/gi) || []).forEach(function (t) {
      var n = t.match(/name=["']([^"']+)["']/i), v = t.match(/value=["']([^"']*)["']/i), ty = t.match(/type=["']([^"']+)["']/i);
      if (n && v && /hidden|submit/i.test(ty ? ty[1] : 'text')) fields[n[1]] = unent(v[1]);
    });
    sess.fields = fields;
    var im = f.match(/<img[^>]*id=["']siwp_captcha_image_0["'][^>]*src=["']([^"']+)["']/i) || f.match(/src=["']([^"']*_siwp_captcha[^"']*)["']/i);
    var img = im ? unent(im[1]) : SCI_BASE + '/?_siwp_captcha&id=' + (fields.scid || '');
    if (img.indexOf('http') !== 0) img = SCI_BASE + (img.charAt(0) === '/' ? '' : '/') + img;
    var p = await get(sess.s, img, SCI_BASE + '/case-status-case-no/', false, true);
    return p.dataUrl();
  }

  async function sci_open() {
    sweep();
    var sid = uid(), sess = { s: newSession(), at: now() };
    var img = await sciForm(sess);
    SESS[sid] = sess;
    return { ok: true, sid: sid, img: img };
  }

  async function sci_search(b) {
    var sess = SESS[b.sid || ''];
    if (!sess || now() - sess.at > 1500) return { ok: true, expired: true };
    var data = Object.assign({}, sess.fields || {});
    Object.assign(data, { case_type: b.type, case_no: b.no, year: b.year, siwp_captcha_value: str(b.captcha).trim(),
                          action: 'get_case_status_case_no', language: 'en' });
    var r = await post(sess.s, SCI_AJAX, { form: data, headers: { Referer: SCI_BASE + '/case-status-case-no/', 'X-Requested-With': 'XMLHttpRequest',
                                                                   Accept: 'application/json, text/javascript, */*; q=0.01' } });
    var j;
    try { j = r.json(); } catch (e) { throw new Error('The Supreme Court site did not answer properly (HTTP ' + r.status + ').'); }
    if (!j.success) {
      var msg;
      try { msg = JSON.parse(j.data || '{}').message; } catch (e) { msg = strip(j.data); }
      var img = await sciForm(sess);
      return { ok: true, bad: /captcha/i.test(msg || ''), msg: msg || 'Nothing found', img: img };
    }
    var dat = j.data;
    var h = str(dat && typeof dat === 'object' && 'resultsHtml' in dat ? dat.resultsHtml : (dat || ''));
    var rows = [], seen = {};
    h.split(/<tr\b/i).forEach(function (part) {
      var a = part.match(/data-diary-no=["'](\d+)["']/i), y = part.match(/data-diary-year=["'](\d+)["']/i);
      if (!a || !y) return;
      var k = a[1] + '/' + y[1];
      if (seen[k]) return;
      seen[k] = 1;
      var cells = [], c, rc = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((c = rc.exec(part))) cells.push(strip(c[1]).replace(/\s+/g, ' '));
      rows.push({ diary: k, text: cells.filter(Boolean).join(' · ').slice(0, 400) });
    });
    if (!rows.length) {
      var m = h.match(/Diary No\.?\s*-?\s*(\d+)\s*\/\s*(\d{4})/i);
      if (m) rows.push({ diary: m[1] + '/' + m[2], text: strip(h).slice(0, 300) });
    }
    return { ok: true, rows: rows, msg: rows.length ? '' : 'No case found with that number.' };
  }

  /* ================================================================ MAT NAGPUR */
  var MAT_FEED = 'https://uatmat.mahaitgov.in/api/final-judgments/2';
  var MAT_PAGE = 'https://mat.maharashtra.gov.in/nagpur';
  var MAT_FILES = 'https://uatmat.mahaitgov.in/storage/finalord/';
  var MAT_DAYS = 'https://uatmat.mahaitgov.in/api/day-status/2';
  var MAT_ORDERS = 'https://uatmat.mahaitgov.in/storage/orders/';
  var MAT_S = { s: null };
  function matSession() { return MAT_S.s || (MAT_S.s = newSession()); }

  async function mat_list(b) {
    var out = [], why = [];
    try {
      var j = (await get(matSession(), MAT_FEED, MAT_PAGE, true)).json();
      (Array.isArray(j) ? j : (j.data || [])).forEach(function (x) {
        out.push({ c: str(x.oa_num), ap: str(x.applicant_name), di: (x.districts || {}).name || '', adv: str(x.applicants_adv),
                   rs: str(x.respondents_details).slice(0, 160), sj: (x.bsubjects || {}).board_subject || '',
                   dt: str(x.decision_date), dc: str(x.decision).slice(0, 160), u: x.file_name ? MAT_FILES + str(x.file_name) : '' });
      });
    } catch (e) { why.push('feed: ' + e.message); }
    if (b.old) {
      try {
        var h = (await get(matSession(), MAT_PAGE)).text;
        tables(h).forEach(function (tb) {
          tb.forEach(function (r) {
            if (r.length < 10) return;
            var um = r.map(function (c) { return c.raw; }).join(' ').match(/href=["']([^"']+)["']/i);
            var u = um ? um[1] : '';
            if (u && u.indexOf('http') !== 0) u = 'https://mat.maharashtra.gov.in/' + u.replace(/^[./]+/, '');
            out.push({ c: r[0].t, ap: r[1].t, di: r[2].t, adv: r[3].t, rs: r[4].t.slice(0, 160), sj: r[6].t, dt: r[7].t, dc: r[8].t.slice(0, 160), u: unent(u) });
          });
        });
      } catch (e) { why.push('page: ' + e.message); }
    }
    return { ok: true, rows: out, note: why.join('; ') };
  }

  async function mat_days() {
    var j = (await get(matSession(), MAT_DAYS, 'https://mat.maharashtra.gov.in/nagpur_calendar_2026.html', true)).json();
    var days = [], hol = [];
    (j || []).forEach(function (x) {
      var d = str(x.order_date).slice(0, 10);
      if (x.order_file_name) days.push({ d: d, f: str(x.order_file_name) });
      else if (x.is_holiday) hol.push({ d: d, t: str(x.holiday_title) });
    });
    return { ok: true, days: days, holidays: hol };
  }

  async function fetchPdf(url, referer) {
    var s = url.indexOf('sci.gov.in') >= 0 ? await sciSession() : matSession();
    var r = await get(s, url, referer, false, true);
    if (r.pdfAt() !== 0) return { ok: true, missing: true, msg: 'The PDF could not be downloaded (HTTP ' + r.status + ').' };
    return { ok: true, b64: r.b64, size: r.bytes().length };
  }

  function mat_pdf(b) {
    var f = str(b.f);
    if (!f || f.indexOf('/') >= 0 || f.indexOf('\\') >= 0 || f.indexOf('..') >= 0) throw new Error('Bad file name');
    return fetchPdf(MAT_ORDERS + quote(f), 'https://mat.maharashtra.gov.in/');
  }

  var PDF_HOSTS = ['api.sci.gov.in', 'www.sci.gov.in', 'sci.gov.in', 'uatmat.mahaitgov.in', 'mat.maharashtra.gov.in'];
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function any_pdf(b) {
    var url = str(b.url), host = hostOf(url);
    if (url.indexOf('https://') !== 0 || PDF_HOSTS.indexOf(host) < 0) throw new Error('That address is not one the helper fetches.');
    return fetchPdf(url, host.indexOf('sci.gov.in') >= 0 ? SCI_BASE + '/' : 'https://mat.maharashtra.gov.in/');
  }

  /* ================================================================ BOMBAY HIGH COURT (eCourts, CAPTCHA) */
  var HC_BASE = 'https://hcservices.ecourts.gov.in/hcservices/';
  var HC_QRY = HC_BASE + 'cases_qry/index_qry.php?action_code=';
  var HC_BENCH = { principal: /appellate side|principal/i, original: /original side/i, aurangabad: /aurangabad/i,
                   nagpur: /nagpur/i, goa: /goa/i, kolhapur: /kolhapur/i };
  var FORM_XHR = { Referer: HC_BASE + 'main.php', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  async function hcPost(s, action, data) {
    var r = await post(s, HC_QRY + action, { form: data, headers: Object.assign({ Accept: 'application/json, text/javascript, */*; q=0.01' }, FORM_XHR) });
    return stripBom(r.text);
  }
  function tilde(t) {
    var out = [];
    str(t).split('#').forEach(function (p) {
      var a = p.split('~');
      if (a.length > 1 && a[0].trim() && a[0].trim() !== '0') out.push({ v: a[0].trim(), t: strip(a[1]) });
    });
    return out;
  }
  async function hcPic(sess) {
    var p = await get(sess.s, HC_BASE + 'securimage/securimage_show.php?' + now(), HC_BASE + 'main.php', false, true);
    return p.dataUrl();
  }

  async function hc_open(b) {
    sweep();
    var s = newSession();
    await get(s, HC_BASE + 'main.php');
    var benches = tilde(await hcPost(s, 'fillHCBench', { state_code: '1', appFlag: 'web' }));
    var rx = HC_BENCH[b.bench || 'nagpur'] || HC_BENCH.nagpur;
    var bc = benches.filter(function (x) { return rx.test(x.t); })[0];
    if (!bc) throw new Error('Could not read the list of High Court benches.');
    var types = tilde(await hcPost(s, 'fillCaseType', { state_code: '1', court_code: bc.v, appFlag: 'web' }));
    var sid = uid(), sess = { s: s, at: now(), bench: bc.v };
    SESS[sid] = sess;
    return { ok: true, sid: sid, img: await hcPic(sess), types: types, bench: bc.t };
  }
  function hcSess(b) {
    var sess = SESS[b.sid || ''];
    if (!sess || now() - sess.at > 1500 || !('bench' in sess)) return null;
    return sess;
  }
  async function hc_newpic(b) {
    var sess = hcSess(b);
    if (!sess) return { ok: true, expired: true };
    return { ok: true, sid: b.sid, img: await hcPic(sess) };
  }

  function hcRows(t) {
    var out = [], seen = {};
    function add(o) {
      var cn = str(o.cino || o.cnr).toUpperCase();
      if (!/^HC[A-Z]{2}\d{12}$/.test(cn) || seen[cn]) return;
      seen[cn] = 1;
      var no = str(o.case_no2 || o.reg_no || o.case_no), yr = str(o.reg_year || o.case_year);
      out.push({ cnr: cn, case_no: str(o.case_no), court_code: str(o._court),
                 no: strip([str(o.type_name || o.case_type), no + (yr ? '/' + yr : '')].join(' ')).trim(),
                 pet: strip(str(o.pet_name || o.petparty_name)), res: strip(str(o.res_name || o.resparty_name)), court: 'Bombay High Court' });
    }
    function walk(x) {
      if (typeof x === 'string') {
        if (/^\s*[\[{]/.test(x)) { try { walk(JSON.parse(x)); } catch (e) {} }
        return;
      }
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (x && typeof x === 'object') {
        if (x.cino || x.cnr) add(x);
        Object.keys(x).forEach(function (k) { walk(x[k]); });
      }
    }
    var j;
    try { j = JSON.parse(t); } catch (e) { j = t; }
    if (j && typeof j === 'object' && Array.isArray(j.con)) {
      var codes = j.court_code || [];
      j.con.forEach(function (part, m) {
        var lst;
        try { lst = typeof part === 'string' ? JSON.parse(part) : part; } catch (e) { return; }
        (Array.isArray(lst) ? lst : [lst]).forEach(function (o) {
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            o = Object.assign({}, o);
            o._court = Array.isArray(codes) && m < codes.length ? codes[m] : '';
            add(o);
          }
        });
      });
    }
    walk(j);
    if (!out.length) {
      var m, rx = /\b(HC[A-Z]{2}\d{12})\b/g;
      while ((m = rx.exec(t))) {
        var cn = m[1];
        if (seen[cn]) continue;
        seen[cn] = 1;
        var a = t.lastIndexOf('<tr', m.index), z = t.indexOf('</tr>', m.index + cn.length);
        var row = strip(t.slice(a >= 0 ? a : Math.max(0, m.index - 600), z > 0 ? z : m.index + cn.length + 600));
        var pp = splitOnce(row, /\s+(?:vs\.?|versus|v\/s)\s+/i);
        var no = (row.match(/[A-Z][A-Za-z.()]*\s*\/\s*\d+\s*\/\s*\d{4}/) || row.match(/\d+\s*\/\s*\d{4}/) || [''])[0];
        out.push({ cnr: cn, no: no, pet: pp.length > 1 ? pp[0].slice(-80).trim() : row.slice(0, 80), res: pp.length > 1 ? pp[1].slice(0, 80).trim() : '', court: 'Bombay High Court' });
      }
    }
    return out;
  }
  function splitOnce(s, rx) {
    var m = s.match(rx);
    if (!m) return [s];
    return [s.slice(0, m.index), s.slice(m.index + m[0].length)];
  }

  async function hcHistory(sess, row) {
    var r = await post(sess.s, HC_BASE + 'cases_qry/o_civil_case_history.php', {
      form: { court_code: row.court_code || sess.bench, state_code: '1', court_complex_code: sess.bench, case_no: row.case_no || '', cino: row.cnr || '', appFlag: '' },
      headers: FORM_XHR });
    return stripBom(r.text);
  }
  async function hc_hist(b) {
    var sess = hcSess(b);
    if (!sess) return { ok: true, expired: true };
    sess.at = now();
    var row = { cnr: b.cnr, case_no: b.case_no, court_code: b.court_code };
    return { ok: true, sid: b.sid, cnr: row.cnr, html: await hcHistory(sess, row) };
  }
  async function hc_cnr(b) {
    var sess = hcSess(b);
    if (!sess) return { ok: true, expired: true };
    sess.at = now();
    var cnr = str(b.cnr).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var r = await post(sess.s, HC_BASE + 'cases_qry/index_qry.php', {
      form: { captcha: str(b.captcha).trim(), cino: cnr, appFlag: 'web', action_code: 'fetchStateDistCourtNew', caseStatusSearchType: 'CNRNumber' },
      headers: FORM_XHR });
    var t = stripBom(r.text);
    if (/invalid captcha|ERROR_Captcha/i.test(t.slice(0, 600))) return { ok: true, bad: true, sid: b.sid, img: await hcPic(sess) };
    if (!t.trim() || /^\s*(THERE IS AN ERROR|\{?\s*"?Error)/.test(t))
      return { ok: true, sid: b.sid, notFound: true, msg: 'The High Court site has no record for CNR ' + cnr + ' (' + strip(t).slice(0, 60) + ')' };
    return { ok: true, sid: b.sid, cnr: cnr, html: t };
  }
  async function hc_pdf(b) {
    var sess = hcSess(b), url = str(b.url);
    if (!sess) return { ok: true, missing: true, msg: 'The High Court session ended; fetch the case again' };
    if (url.indexOf('http') !== 0) url = HC_BASE + url.replace(/^[./]+/, '');
    if (hostOf(url) !== 'hcservices.ecourts.gov.in') throw new Error('That address is not one the helper fetches.');
    var r = await get(sess.s, url, HC_BASE + 'main.php', false, true);
    var k = r.pdfAt();
    if (r.status === 200 && k >= 0) return { ok: true, b64: r.pdfB64From(k) };
    var txt = strip(new TextDecoder('utf-8').decode(r.bytes().subarray(0, 2000)));
    if (/not uploaded/i.test(txt)) return { ok: true, missing: true, msg: 'not uploaded on eCourts (the Bombay High Court publishes its orders on its own website)' };
    return { ok: true, missing: true, msg: 'The High Court PDF could not be downloaded (HTTP ' + r.status + ')' };
  }
  async function hc_search(b) {
    var sess = hcSess(b);
    if (!sess) return { ok: true, expired: true };
    sess.at = now();
    var q = str(b.q).trim(), st = str(b.status || 'Both'), mode = str(b.mode || 'cno');
    var data = { court_code: sess.bench, state_code: '1', court_complex_code: sess.bench, captcha: str(b.captcha).trim(), appFlag: 'web' };
    if (mode === 'party') Object.assign(data, { caseStatusSearchType: 'CSpartyName', f: st, petres_name: q, rgyear: str(b.year) });
    else if (mode === 'adv') Object.assign(data, { caseStatusSearchType: 'CSAdvName', advocate_name: q, search_type: '1', f: st });
    else Object.assign(data, { caseStatusSearchType: 'CScaseNumber', case_type: str(b.type), case_no: str(b.no), rgyear: str(b.year), caseNoType: 'new', displayOldCaseNo: 'NO' });
    var t = await hcPost(sess.s, 'showRecords', data);
    if (/invalid captcha|ERROR_Captcha|captcha.*(wrong|invalid|mismatch)|enter.*captcha/i.test(t.slice(0, 600))) return { ok: true, bad: true, sid: b.sid, img: await hcPic(sess) };
    var rows = hcRows(t);
    var out = { ok: true, sid: b.sid, rows: rows.slice(0, 200),
                msg: rows.length ? '' : (/"con"\s*:\s*(""|\[\s*\])|totRecords"\s*:\s*"?0/.test(t) ? 'Record not found' : (strip(t).slice(0, 160) || 'Nothing found')) };
    if (rows.length === 1 && mode === 'cno') { out.cnr = rows[0].cnr; out.html = await hcHistory(sess, rows[0]); }
    else out.img = await hcPic(sess);
    return out;
  }

  /* ================================================================ DISTRICT COURTS (eCourts) */
  var EC_BASE = 'https://services.ecourts.gov.in/ecourtindia_v6';
  var EC_HOST = 'https://services.ecourts.gov.in';

  function ecToken(html) {
    var tags = String(html || '').match(/<input[^>]*app_token[^>]*>/gi) || [];
    for (var i = 0; i < tags.length; i++) {
      var m = tags[i].match(/value\s*=\s*["']?([^"'\s>]+)/i);
      if (m && m[1].length >= 16) return m[1];
    }
    var n = String(html || '').match(/app_token["']?\s*[:=,]\s*["']([0-9A-Za-z]{16,})["']/);
    return n ? n[1] : '';
  }
  function ecAbs(u) {
    u = unent(u).trim();
    if (u.indexOf('http') === 0) return u;
    if (u.charAt(0) === '/') return EC_HOST + u;
    return EC_BASE + '/' + u.replace(/^[./]+/, '');
  }
  async function ecAjax(sess, page, data) {
    var h = { Referer: EC_BASE + '/', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01',
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    if (sess.hv) { h.delimeter = sess.hv; if (sess.hk) h[sess.hk] = sess.hv; }
    var body = (data ? data + '&' : '') + 'ajax_req=true&app_token=' + quote(sess.token || '');
    var r = await post(sess.s, EC_BASE + '/?p=' + page, { body: body, headers: h });
    var t = stripBom(r.text), j;
    try { j = JSON.parse(t); } catch (e) {
      var parts = t.split('#####');
      if (parts.length > 1 && parts[1].trim()) sess.token = parts[1].trim();
      else { var m = t.match(/"app_token":"([^"]+)"/); if (m) sess.token = m[1]; }
      throw new Error(strip(parts[0]).slice(0, 180) || 'eCourts did not answer properly (HTTP ' + r.status + ')');
    }
    if (j && typeof j === 'object' && !Array.isArray(j) && j.app_token) sess.token = j.app_token;
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  }
  async function ecPic(sess) {
    var src = EC_BASE + '/vendor/securimage/securimage_show.php?' + now();
    var j = await ecAjax(sess, 'casestatus/getCaptcha', '');
    if (j.errormsg && !j.div_captcha) j = await ecAjax(sess, 'casestatus/getCaptcha', '');
    var m = str(j.div_captcha).match(/src=["']([^"']*securimage_show\.php[^"']*)["']/i);
    if (m) src = ecAbs(m[1]);
    else if (j.errormsg) throw new Error(strip(j.errormsg).slice(0, 160));
    var p = await get(sess.s, src, EC_BASE + '/', false, true);
    var ctype = (p.ctype || 'image/png').split(';')[0];
    if (p.status !== 200 || ctype.indexOf('image') < 0) throw new Error('eCourts did not give a CAPTCHA picture (HTTP ' + p.status + ')');
    return p.dataUrl();
  }
  async function ecOpen() {
    var s = newSession();
    var home = await get(s, EC_BASE + '/');
    var html = home.text;
    var sess = { s: s, at: now(), token: ecToken(html), dc: true };
    var m = html.match(/src=["']([^"']*js\/components\.js[^"']*)["']/i);
    var js = (await get(s, m ? ecAbs(m[1]) : EC_BASE + '/js/components.js', EC_BASE + '/')).text;
    var v = js.match(/var\s+delimeter\s*=\s*["']([^"']+)["']/);
    var k = js.match(/["']?delimeter["']?\s*:\s*delimeter\s*,\s*["']?([A-Za-z0-9_\-]+)["']?\s*:\s*delimeter/);
    sess.hv = v ? v[1] : '';
    sess.hk = k ? k[1] : '';
    return sess;
  }

  async function dc_start(b) {
    sweep();
    var rows = [], list = b.cnrs || [];
    for (var i = 0; i < list.length; i++) {
      var cnr = str(list[i]).toUpperCase().replace(/[^A-Z0-9]/g, ''), row = { cnr: cnr }, sess;
      try {
        if (cnr.indexOf('HC') === 0) {      /* High Court CNR: bench code is in the CNR (HCBM04… = 4) */
          var s = newSession();
          await get(s, HC_BASE + 'main.php');
          sess = { s: s, at: now(), bench: String(parseInt(cnr.slice(4, 6) || '0', 10) || 4) };
          row.img = await hcPic(sess);
        } else {
          sess = await ecOpen();
          row.img = await ecPic(sess);
        }
        var sid = uid();
        SESS[sid] = sess;
        row.sid = sid;
      } catch (e) {
        row.sid = '';
        row.err = 'The court site did not give a CAPTCHA (' + String(e.message || e).slice(0, 120) + '). Press Try again.';
      }
      rows.push(row);
    }
    return { ok: true, rows: rows };
  }
  function dcSess(b) {
    var sess = SESS[b.sid || ''];
    if (!sess || now() - sess.at > 1500) return null;
    sess.at = now();
    return sess;
  }
  async function dc_captcha(b) {
    var sess = dcSess(b);
    if (!sess) {
      var r = (await dc_start({ cnrs: [b.cnr] })).rows[0];
      return { ok: true, sid: r.sid, img: r.img, err: r.err };
    }
    return { ok: true, sid: b.sid, img: 'bench' in sess ? await hcPic(sess) : await ecPic(sess) };
  }
  async function dc_search(b) {
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    var cnr = str(b.cnr).toUpperCase().replace(/[^A-Z0-9]/g, ''), cap = str(b.captcha).trim();
    if ('bench' in sess) {
      var hr = await hc_cnr({ sid: b.sid, cnr: cnr, captcha: cap });
      if (hr.html) hr.kind = 'hc';
      return hr;
    }
    var j;
    try { j = await ecAjax(sess, 'cnr_status/searchByCNR/', 'cino=' + quote(cnr) + '&fcaptcha_code=' + quote(cap)); }
    catch (e) {
      if (/captcha/i.test(e.message)) return { ok: true, bad: true, msg: e.message, img: await ecPic(sess) };
      throw e;
    }
    var html = j.casetype_list || '';
    if (str(j.status) === '0' || (!html && (j.errormsg || j.div_captcha)))
      return { ok: true, bad: true, msg: strip(j.errormsg || '').slice(0, 120) || 'Wrong CAPTCHA', img: await ecPic(sess) };
    var m = html.match(/id=["']sess_dist_code["'][^>]*value=["']([^"']*)/i);
    if (m) sess.dist = m[1];
    return { ok: true, sid: b.sid, kind: 'dc', html: html };
  }
  async function dc_order(b) {
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    var a = b.a || [];
    if (a.length && a[0] === 'HC') return hc_pdf({ sid: b.sid, url: a[1] });
    var g = function (i) { return a.length > i && a[i] != null ? String(a[i]) : ''; };
    var j = await ecAjax(sess, 'home/display_pdf', 'normal_v=' + quote(g(0)) + '&case_val=' + quote(g(1)) + '&court_code=' + quote(g(2)) +
                         '&filename=' + quote(g(3)) + '&appFlag=' + quote(g(4)));
    if (!j.order) return { ok: true, missing: true, msg: strip(j.errormsg || '').slice(0, 120) || 'eCourts has no PDF for this order' };
    var r = await get(sess.s, ecAbs(str(j.order)), EC_BASE + '/', false, true);
    var k = r.pdfAt();
    if (r.status !== 200 || k < 0) return { ok: true, missing: true, msg: 'The PDF could not be downloaded (HTTP ' + r.status + ')' };
    return { ok: true, b64: r.pdfB64From(k) };
  }
  async function dc_biz(b) {
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    if ('bench' in sess) return { ok: true, text: '' };
    var a = b.a || [];
    var g = function (i) { return a.length > i && a[i] != null ? String(a[i]) : ''; };
    var data = 'court_code=' + quote(g(0)) + '&state_code=' + quote(g(4)) + '&dist_code=' + quote(sess.dist || g(1)) +
      '&nextdate1=' + quote(g(2)) + '&case_number1=' + quote(g(3)) + '&state_code=' + quote(g(4)) +
      '&disposal_flag=' + quote(g(5)) + '&businessDate=' + quote(g(6)) + '&national_court_code=' + quote(g(8)) +
      '&court_no=' + quote(g(7)) + '&search_by=' + quote(g(9) || 'cnr') + '&srno=' + quote(g(10));
    var j = await ecAjax(sess, 'home/viewBusiness', data);
    var t = strip(j.data_list || '');
    var m = t.match(/Business\s*:?\s*([\s\S]*?)(?:\n\s*Next Purpose|\n\s*Next Hearing Date|$)/i);
    var txt = ((m && m[1]) ? m[1] : t).replace(/\s+/g, ' ').trim();
    return { ok: true, text: txt.slice(0, 700) };
  }

  /* ---- find a district case by its type, number and year (one CAPTCHA) ---- */
  function ecOpts(h) {
    var out = [], m, rx = /<option[^>]*?value\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/option>/gi, s = str(h);
    while ((m = rx.exec(s))) {
      var v = m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]), t = strip(m[4]);
      if (v && v !== '0' && t && !/^select/i.test(t)) out.push({ v: v, t: t });
    }
    return out;
  }
  function firstStr(x, rx) {
    if (typeof x === 'string') return rx.test(x) ? x : '';
    if (x && typeof x === 'object') {
      var vals = Array.isArray(x) ? x : Object.keys(x).map(function (k) { return x[k]; });
      for (var i = 0; i < vals.length; i++) { var r = firstStr(vals[i], rx); if (r) return r; }
    }
    return '';
  }
  async function dc_open(b) {
    sweep();
    var sess = await ecOpen();
    var img = await ecPic(sess);
    var lists = { est: [] }, note = '';
    try {
      var dj = await ecAjax(sess, 'casestatus/fillDistrict', 'state_code=1');
      var want = new RegExp(str(b.district || 'Nagpur'), 'i');
      var dists = ecOpts(firstStr(dj, /<option/i));
      var dn = dists.filter(function (x) { return want.test(x.t); })[0] || null;
      /* Industrial & Labour, Family, School Tribunal, Co-op Appellate courts are listed under their own
         state-wide "districts" on eCourts: take the courts of this city from each of them too */
      var special = dists.filter(function (x) { return /industrial|labou?r|family|school|co.?op/i.test(x.t); });
      var all = (dn ? [dn] : []).concat(special);
      for (var i = 0; i < all.length; i++) {
        var dd = all[i];
        var cj = await ecAjax(sess, 'casestatus/fillcomplex', 'state_code=1&dist_code=' + quote(dd.v));
        var opts = ecOpts(firstStr(cj, /<option/i));
        for (var k = 0; k < opts.length; k++) {
          var o = opts[k];
          if (!(dd === dn || want.test(o.t))) continue;
          var parts = o.v.split('@');
          var ests = (parts.length > 1 ? parts[1] : '').split(',');
          var flag = parts.length > 2 ? parts[2] : 'N';
          if (ests.length > 1) {
            /* one complex, several courts (e.g. 9 = Industrial Court, 10 = Labour Court): list each court */
            var named = [];
            try {
              var ej = await ecAjax(sess, 'casestatus/fillCourtEstablishment', 'state_code=1&dist_code=' + quote(dd.v) + '&court_complex_code=' + quote(parts[0]));
              named = ecOpts(firstStr(ej, /<option/i));
            } catch (e) { named = []; }
            if (named.length) {
              named.forEach(function (e) { lists.est.push({ v: dd.v + '|' + parts[0] + '@' + e.v + '@' + flag, t: e.t }); });
              continue;
            }
            ests.forEach(function (e) { lists.est.push({ v: dd.v + '|' + parts[0] + '@' + e + '@' + flag, t: o.t + ' (court ' + e + ')' }); });
            continue;
          }
          lists.est.push({ v: dd.v + '|' + o.v, t: o.t });
        }
      }
    } catch (e) { note = 'Could not read the list of courts: ' + String(e.message || e).slice(0, 120); }
    var sid = uid();
    SESS[sid] = sess;
    return { ok: true, sid: sid, img: img, lists: lists, note: lists.est.length ? '' : (note || 'Could not read the list of courts') };
  }
  function splitEst(v, sess) {
    v = str(v);
    var i = v.indexOf('|');
    if (i >= 0) { var d = v.slice(0, i); v = v.slice(i + 1); if (sess) sess.dist = d; }
    var p = v.split('@');
    return [p[0] || '', p.length > 1 ? p[1] : ''];
  }
  async function dc_types(b) {
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    var ce = splitEst(b.est, sess);
    var j = await ecAjax(sess, 'casestatus/fillCaseType', 'state_code=1&dist_code=' + quote(sess.dist || '') +
                         '&court_complex_code=' + quote(ce[0]) + '&est_code=' + quote(ce[1]) + '&search_type=c_no');
    return { ok: true, types: ecOpts(firstStr(j, /<option/i)) };
  }
  function dcRows(h) {
    var out = [], seen = {}, court = '';
    tables(str(h)).forEach(function (rows) {
      rows.forEach(function (r) {
        var raw = r.map(function (c) { return c.raw; }).join(' ');
        var txt = r.map(function (c) { return c.t; });
        if (r.length === 1 && raw.indexOf('viewHistory') < 0) { court = txt[0]; return; }
        var m = raw.match(/\b([A-Z]{4}\d{12})\b/);
        if (!m || seen[m[1]]) return;
        var cn = m[1];
        seen[cn] = 1;
        var par = txt.filter(function (t) { return /\b(vs\.?|versus|v\/s)\b/i.test(t); })[0] || '';
        var pp = splitOnce(par, /\s+(?:vs\.?|versus|v\/s)\s+/i);
        var no = txt.filter(function (t) { return /\/\s*\d{4}/.test(t) && t !== par; })[0] || '';
        out.push({ cnr: cn, no: no.replace(/\s+/g, ' '), pet: (pp[0] || '').trim(), res: (pp.length > 1 ? pp[1] : '').trim(), court: court });
      });
    });
    return out;
  }
  function withoutCaptcha(j) { var o = {}; Object.keys(j).forEach(function (k) { if (k !== 'div_captcha') o[k] = j[k]; }); return o; }
  var BADCAP = /captcha|invalid\s*code|code\s*mismatch/i;

  async function dc_find(b) {
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    var ce = splitEst(b.est, sess);
    var base = '&state_code=1&dist_code=' + quote(sess.dist || '') + '&court_complex_code=' + quote(ce[0]) + '&est_code=' + quote(ce[1]);
    var j;
    try {
      j = await ecAjax(sess, 'casestatus/submitCaseNo', 'case_type=' + quote(str(b.type)) + '&search_case_no=' + quote(str(b.no)) + '&case_no=' + quote(str(b.no)) +
                       '&rgyear=' + quote(str(b.year)) + '&case_captcha_code=' + quote(str(b.captcha).trim()) + base);
    } catch (e) {
      if (/captcha/i.test(e.message)) return { ok: true, bad: true, sid: b.sid, img: await ecPic(sess) };
      throw e;
    }
    /* every answer carries the next CAPTCHA picture, so only the site's own error text decides "wrong CAPTCHA" */
    var err = strip(j.errormsg || '');
    if (BADCAP.test(err)) return { ok: true, bad: true, sid: b.sid, img: await ecPic(sess) };
    var h = str(j.case_data) || firstStr(withoutCaptcha(j), /viewHistory|<table|<tr/i);
    var rows = dcRows(h);
    var msg = rows.length ? '' : (err || strip(h).slice(0, 160) || 'No case with this type, number and year in this court');
    return { ok: true, sid: b.sid, rows: rows.slice(0, 200), img: await ecPic(sess), msg: msg };
  }
  async function dc_srch(b) {
    var mode = str(b.mode || 'cno');
    if (mode === 'cno') return dc_find(b);
    var sess = dcSess(b);
    if (!sess) return { ok: true, expired: true };
    var ce = splitEst(b.est, sess);
    var base = '&state_code=1&dist_code=' + quote(sess.dist || '') + '&court_complex_code=' + quote(ce[0]) + '&est_code=' + quote(ce[1]);
    var st = str(b.status || 'Pending'), cap = str(b.captcha).trim(), q = str(b.q).trim(), page, data;
    if (mode === 'adv') {
      page = 'casestatus/submitAdvName';
      data = 'radAdvt=1&advocate_name=' + quote(q) + '&adv_bar_state=&adv_bar_code=&adv_bar_year=&case_status=' + quote(st) + '&caselist_date=&adv_captcha_code=' + quote(cap) + base;
    } else {
      page = 'casestatus/submitPartyName';
      data = 'petres_name=' + quote(q) + '&rgyearP=' + quote(str(b.year)) + '&case_status=' + quote(st) + '&fcaptcha_code=' + quote(cap) + base;
    }
    var j;
    try { j = await ecAjax(sess, page, data); }
    catch (e) {
      if (/captcha/i.test(e.message)) return { ok: true, bad: true, sid: b.sid, img: await ecPic(sess) };
      throw e;
    }
    var err = strip(j.errormsg || '');
    if (BADCAP.test(err)) return { ok: true, bad: true, sid: b.sid, img: await ecPic(sess) };
    var h = '', keys = ['case_data', 'party_data', 'adv_data', 'con', 'case_list'];
    for (var i = 0; i < keys.length; i++) if (j[keys[i]]) { h = str(j[keys[i]]); break; }
    if (!h) h = firstStr(withoutCaptcha(j), /viewHistory|<table|<tr/i);
    var rows = dcRows(h);
    return { ok: true, sid: b.sid, rows: rows.slice(0, 200), more: rows.length > 200, img: await ecPic(sess),
             msg: rows.length ? '' : (err || strip(h).slice(0, 160) || 'Nothing found') };
  }

  /* ================================================================ hand-over to Excerpt Desk
     The helper keeps these in a folder on the PC. Here they go into this phone's own storage for
     sanketcharpe.github.io, which Excerpt Desk (same address) can read when it is opened in the app. */
  var XDB = null;
  function xdb() {
    if (XDB) return XDB;
    XDB = new Promise(function (res, rej) {
      var q = indexedDB.open('charpe-xbox', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('items', { keyPath: 'id' }); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { XDB = null; rej(q.error); };
    });
    return XDB;
  }
  function xtx(mode, fn) {
    return xdb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('items', mode), st = t.objectStore('items'), out = fn(st);
        t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function xsafe(i) {
    i = str(i).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!i) throw new Error('Bad id');
    return i;
  }
  function x_put(b) {
    var it = b.item || {};
    it.id = xsafe(it.id);
    return xtx('readwrite', function (st) { st.put(it); }).then(function () { return { ok: true, id: it.id }; });
  }
  function x_list() {
    return xtx('readonly', function (st) { return st.getAll(); }).then(function (all) {
      all = (all || []).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      return { ok: true, items: all.map(function (it) {
        return { id: it.id, title: it.title, cn: it.cn, court: it.court, at: it.at,
                 files: (it.files || []).map(function (x) { return { name: x.name, slot: x.slot }; }) };
      }) };
    });
  }
  function x_get(b) {
    var id = xsafe(b.id);
    return xtx('readonly', function (st) { return st.get(id); }).then(function (it) { return it ? { ok: true, item: it } : { ok: true, missing: true }; });
  }
  function x_del(b) {
    var id = xsafe(b.id);
    return xtx('readwrite', function (st) { st.delete(id); }).then(function () { return { ok: true }; });
  }

  /* ================================================================ Bombay High Court's own website (no CAPTCHA) */
  var BHC_BASE = 'https://bombayhighcourt.gov.in/bhc/';
  var BHC_BENCH = { nagpur: 'N', aurangabad: 'A', goa: 'G', principal: 'B' };
  var BHC_S = {};
  async function bhcSession(bench) {
    var code = BHC_BENCH[str(bench || 'nagpur').toLowerCase()] || 'N';
    var e = BHC_S[code];
    if (e && now() - e.at < 1200) return e.s;
    var s = newSession();
    await get(s, BHC_BASE + 'bench/change?bench=' + code, BHC_BASE);
    if (e) dropSession(e.s);
    BHC_S[code] = { s: s, at: now() };
    return s;
  }
  async function bhcForm(s) {
    var h = (await get(s, BHC_BASE + 'casestatus/casenumber', BHC_BASE)).text;
    var i = h.indexOf('id="getCaseByCaseNo"');
    if (i < 0) throw new Error('The Bombay High Court site did not show its case-status form.');
    var end = h.indexOf('</form>', i), f = h.slice(i, end < 0 ? undefined : end);
    function val(name) {
      var m = f.match(new RegExp('name="' + name + '"[^>]*value="([^"]*)"')) || f.match(new RegExp('value="([^"]*)"[^>]*name="' + name + '"'));
      return m ? m[1] : '';
    }
    var sel = f.match(/name="case_type"[\s\S]*?<\/select>/), types = [], m, rx = /<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/g, sh = sel ? sel[0] : '';
    while ((m = rx.exec(sh))) types.push({ v: m[1], t: strip(m[2]) });
    var bm = h.match(/>\s*(NAGPUR|AURANGABAD|GOA|BOMBAY)\s*</);
    var names = [], n, rn = /name="(\w+)"/g;
    while ((n = rn.exec(f))) names.push(n[1]);
    return { token: val('_token'), secret: val('form_secret'), types: types, bench: bm ? bm[1] : '', side: names.indexOf('side') >= 0 };
  }
  async function bhc_types(b) {
    var f = await bhcForm(await bhcSession(b.bench));
    return { ok: true, types: f.types, bench: f.bench };
  }
  async function bhc_find(b) {
    var s = await bhcSession(b.bench), f = await bhcForm(s);
    var data = { _token: f.token, form_secret: f.secret, stampreg: b.stampreg || 'R', case_type: str(b.type), case_no: str(b.no), year: str(b.year) };
    if (f.side) data.side = b.side || 'AS';
    var url = BHC_BASE + 'casestatus/casenumber', r = null, last = null;
    for (var attempt = 0; attempt < 2 && !r; attempt++) {
      try { r = await post(s, url, { form: data, headers: { Referer: url, Origin: 'https://bombayhighcourt.gov.in' } }); }
      catch (e) { last = e; await sleep(1000 * (1 + attempt)); }
    }
    if (!r) throw new Error('The Bombay High Court site could not be reached just now (' + String(last && last.message || last).slice(0, 80) + '). Please try again.');
    var j;
    try { j = r.json(); } catch (e) { return { ok: true, found: false, msg: 'The site did not answer as expected (HTTP ' + r.status + ').', bench: f.bench }; }
    var page = j.page || '';
    var found = page.indexOf('id="cn_CaseNoUpdates"') >= 0;
    return { ok: true, found: found, page: found ? page : '', bench: f.bench,
             msg: found ? '' : strip(j.message || j.msg || 'No case with that number on the Bombay High Court site.').slice(0, 200) };
  }
  async function bhc_pdf(b) {
    var url = str(b.url), u;
    try { u = new URL(url); } catch (e) { u = null; }
    if (!u || u.protocol !== 'https:' || u.hostname !== 'bombayhighcourt.gov.in' || u.pathname.indexOf('/bhc/casestatus/order-pdf/') !== 0)
      throw new Error('That address is not one the helper fetches.');
    var s = await bhcSession(b.bench);
    var r = await get(s, url, BHC_BASE + 'casestatus/casenumber', false, true);
    var k = r.pdfAt();
    if (r.status === 200 && k >= 0) return { ok: true, b64: r.pdfB64From(k) };
    return { ok: true, missing: true, msg: 'The Bombay High Court site did not give the PDF (HTTP ' + r.status + ')' };
  }

  /* ================================================================ the actions, as the helper names them */
  var ACTIONS = {
    sci: sci_case, scopen: sci_open, scsearch: sci_search, mat: mat_list, matdays: mat_days,
    matpdf: mat_pdf, pdf: any_pdf, hcopen: hc_open, hcpic: hc_newpic, hcsearch: hc_search, hchist: hc_hist, hccnr: hc_cnr, hcpdf: hc_pdf,
    xput: x_put, xlist: x_list, xget: x_get, xdel: x_del,
    dcstart: dc_start, dccaptcha: dc_captcha, dcsearch: dc_search, dcorder: dc_order, dcbiz: dc_biz,
    bhctypes: bhc_types, bhcfind: bhc_find, bhcpdf: bhc_pdf, dcopen: dc_open, dctypes: dc_types, dcfind: dc_find, dcsrch: dc_srch,
    ping: function () { return { ok: true, helper: VERSION, engine: ENGINE, phone: true }; }
  };

  window.CharpeEngine = {
    version: VERSION,
    handle: function (b) {
      b = b || {};
      var fn = ACTIONS[b.action];
      if (!fn) return Promise.resolve({ ok: false, error: 'Unknown action' });
      return Promise.resolve().then(function () { return fn(b); }).catch(function (e) {
        return { ok: false, error: String(e && e.message || e).slice(0, 300) };
      });
    }
  };

  /* ================================================================ md5 (for order keys, same as the helper's) */
  function md5(s) {
    function add(x, y) { var l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    var n = s.length, w = [], i;
    for (i = 0; i < n; i++) w[i >> 2] |= (s.charCodeAt(i) & 0xff) << ((i % 4) * 8);
    w[n >> 2] |= 0x80 << ((n % 4) * 8);
    w[(((n + 8) >> 6) + 1) * 16 - 2] = n * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (i = 0; i < w.length; i += 16) {
      var oa = a, ob = b, oc = c, od = d, X = function (k) { return w[i + k] | 0; };
      a = ff(a, b, c, d, X(0), 7, -680876936); d = ff(d, a, b, c, X(1), 12, -389564586); c = ff(c, d, a, b, X(2), 17, 606105819); b = ff(b, c, d, a, X(3), 22, -1044525330);
      a = ff(a, b, c, d, X(4), 7, -176418897); d = ff(d, a, b, c, X(5), 12, 1200080426); c = ff(c, d, a, b, X(6), 17, -1473231341); b = ff(b, c, d, a, X(7), 22, -45705983);
      a = ff(a, b, c, d, X(8), 7, 1770035416); d = ff(d, a, b, c, X(9), 12, -1958414417); c = ff(c, d, a, b, X(10), 17, -42063); b = ff(b, c, d, a, X(11), 22, -1990404162);
      a = ff(a, b, c, d, X(12), 7, 1804603682); d = ff(d, a, b, c, X(13), 12, -40341101); c = ff(c, d, a, b, X(14), 17, -1502002290); b = ff(b, c, d, a, X(15), 22, 1236535329);
      a = gg(a, b, c, d, X(1), 5, -165796510); d = gg(d, a, b, c, X(6), 9, -1069501632); c = gg(c, d, a, b, X(11), 14, 643717713); b = gg(b, c, d, a, X(0), 20, -373897302);
      a = gg(a, b, c, d, X(5), 5, -701558691); d = gg(d, a, b, c, X(10), 9, 38016083); c = gg(c, d, a, b, X(15), 14, -660478335); b = gg(b, c, d, a, X(4), 20, -405537848);
      a = gg(a, b, c, d, X(9), 5, 568446438); d = gg(d, a, b, c, X(14), 9, -1019803690); c = gg(c, d, a, b, X(3), 14, -187363961); b = gg(b, c, d, a, X(8), 20, 1163531501);
      a = gg(a, b, c, d, X(13), 5, -1444681467); d = gg(d, a, b, c, X(2), 9, -51403784); c = gg(c, d, a, b, X(7), 14, 1735328473); b = gg(b, c, d, a, X(12), 20, -1926607734);
      a = hh(a, b, c, d, X(5), 4, -378558); d = hh(d, a, b, c, X(8), 11, -2022574463); c = hh(c, d, a, b, X(11), 16, 1839030562); b = hh(b, c, d, a, X(14), 23, -35309556);
      a = hh(a, b, c, d, X(1), 4, -1530992060); d = hh(d, a, b, c, X(4), 11, 1272893353); c = hh(c, d, a, b, X(7), 16, -155497632); b = hh(b, c, d, a, X(10), 23, -1094730640);
      a = hh(a, b, c, d, X(13), 4, 681279174); d = hh(d, a, b, c, X(0), 11, -358537222); c = hh(c, d, a, b, X(3), 16, -722521979); b = hh(b, c, d, a, X(6), 23, 76029189);
      a = hh(a, b, c, d, X(9), 4, -640364487); d = hh(d, a, b, c, X(12), 11, -421815835); c = hh(c, d, a, b, X(15), 16, 530742520); b = hh(b, c, d, a, X(2), 23, -995338651);
      a = ii(a, b, c, d, X(0), 6, -198630844); d = ii(d, a, b, c, X(7), 10, 1126891415); c = ii(c, d, a, b, X(14), 15, -1416354905); b = ii(b, c, d, a, X(5), 21, -57434055);
      a = ii(a, b, c, d, X(12), 6, 1700485571); d = ii(d, a, b, c, X(3), 10, -1894986606); c = ii(c, d, a, b, X(10), 15, -1051523); b = ii(b, c, d, a, X(1), 21, -2054922799);
      a = ii(a, b, c, d, X(8), 6, 1873313359); d = ii(d, a, b, c, X(15), 10, -30611744); c = ii(c, d, a, b, X(6), 15, -1560198380); b = ii(b, c, d, a, X(13), 21, 1309151649);
      a = ii(a, b, c, d, X(4), 6, -145523070); d = ii(d, a, b, c, X(11), 10, -1120210379); c = ii(c, d, a, b, X(2), 15, 718787259); b = ii(b, c, d, a, X(9), 21, -343485551);
      a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
    }
    var hex = '', v = [a, b, c, d];
    for (i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var byte = (v[i] >>> (j * 8)) & 0xff; hex += (byte < 16 ? '0' : '') + byte.toString(16); }
    return hex;
  }
  window.__charpeMd5 = md5;
})();
