/* =====================================================================
   CHARPE SUITE — OFFICIAL eCOURTS BACKEND                     Oct 2026
   ---------------------------------------------------------------------
   A separate Apps Script web app. It talks to the official eCourts
   site (services.ecourts.gov.in) on behalf of the Case Manager:

     • opens one eCourts session per case and hands back its CAPTCHA
     • when you type the CAPTCHA, searches the CNR and reads the case:
       next date, stage, status, judge, parties, hearing history, orders
     • downloads every order PDF into your Drive folder
       (Charpe Suite Data / eCourts Orders / <case> [CNR] / ...)
     • reads the "business on date" for each hearing
     • hands a saved PDF back to any of your devices — no CAPTCHA needed

   It never solves a CAPTCHA itself: you type every one.

   SETUP — fill in the two values below, then Deploy → New deployment
   → Web app → Execute as: Me → Who has access: Anyone.
   ===================================================================== */

var SECRET    = 'PUT-YOUR-SYNC-PASSWORD-HERE';   // same password you use for Drive sync is fine
var FOLDER_ID = 'PUT-YOUR-DRIVE-FOLDER-ID-HERE'; // the "Charpe Suite Data" folder ID

var BASE          = 'https://services.ecourts.gov.in/ecourtindia_v6';
var ORDERS_FOLDER = 'eCourts Orders';
var SESSION_SECS  = 1500;                        // keep an eCourts session for 25 minutes

/* ------------------------------------------------------------------ */
function doGet() { return out({ ok: true, service: 'charpe-ecourts-official', version: 1 }); }

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: 'Bad request' }); }
  if (!b || b.token !== SECRET) return out({ ok: false, error: 'Wrong password for the eCourts backend' });
  try {
    switch (b.action) {
      case 'ping':    return out(ping());
      case 'start':   return out(startSessions(b.cnrs || []));
      case 'captcha': return out(newCaptcha(b.sid, b.cnr));
      case 'search':  return out(search(b));
      case 'order':   return out(getOrder(b));
      case 'biz':     return out(getBiz(b));
      case 'pdf':     return out(readPdf(b.fid));
    }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- HTTP helpers ---------------- */
function rq(url, cookie, payload) {
  var o = {
    url: url, muteHttpExceptions: true, followRedirects: true,
    method: payload === undefined ? 'get' : 'post',
    headers: { 'Referer': BASE + '/', 'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest' }
  };
  if (cookie) o.headers.Cookie = cookie;
  if (payload !== undefined) {
    o.payload = payload;
    o.contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
    o.headers.delimeter = 'erytiu4';
    o.headers.Suyrttry65 = 'erytiu4';
  }
  return o;
}
function fetch1(o) { var u = o.url, p = {}; for (var k in o) if (k !== 'url') p[k] = o[k]; return UrlFetchApp.fetch(u, p); }

function cookieMerge(old, resp) {
  var h = resp.getAllHeaders(), sc = h['Set-Cookie'] || h['set-cookie'];
  if (!sc) return old || '';
  if (!Array.isArray(sc)) sc = [sc];
  var jar = {};
  String(old || '').split(/;\s*/).forEach(function (p) { var i = p.indexOf('='); if (i > 0) jar[p.slice(0, i)] = p.slice(i + 1); });
  sc.forEach(function (line) {
    var kv = String(line).split(';')[0], i = kv.indexOf('=');
    if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
}
function enc(v) { return encodeURIComponent(v === undefined || v === null ? '' : String(v)); }
function imgData(r) {
  var b = r.getBlob();
  return 'data:' + (b.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(b.getBytes());
}
function tokenFrom(html) {
  var m = html.match(/id=["']app_token["'][^>]*value=["']([^"']+)/i) ||
          html.match(/name=["']app_token["'][^>]*value=["']([^"']+)/i) ||
          html.match(/value=["']([0-9a-f]{40,})["'][^>]*id=["']app_token/i);
  return m ? m[1] : '';
}

/* ---------------- sessions ---------------- */
function sGet(sid) { var v = sid && CacheService.getScriptCache().get('s_' + sid); return v ? JSON.parse(v) : null; }
function sPut(sid, s) { CacheService.getScriptCache().put('s_' + sid, JSON.stringify(s), SESSION_SECS); }

function ping() {
  var r = fetch1(rq(BASE + '/')), html = r.getContentText();
  return { ok: true, folder: rootFolder().getName(), site: r.getResponseCode(), reachable: !!tokenFrom(html) };
}

/* One fresh eCourts session (with its own CAPTCHA) per case. */
function startSessions(cnrs) {
  var rows = [];
  for (var i = 0; i < cnrs.length; i += 6) {
    var part = cnrs.slice(i, i + 6);
    var homes = UrlFetchApp.fetchAll(part.map(function () { return rq(BASE + '/'); }));
    var sess = homes.map(function (r) {
      return { cookie: cookieMerge('', r), token: tokenFrom(r.getContentText()), code: r.getResponseCode() };
    });
    var caps = UrlFetchApp.fetchAll(sess.map(function (s) {
      return rq(BASE + '/vendor/securimage/securimage_show.php?' + Math.random(), s.cookie);
    }));
    caps.forEach(function (r, k) {
      var s = sess[k], sid = Utilities.getUuid();
      s.cookie = cookieMerge(s.cookie, r);
      var row = { cnr: part[k], sid: sid };
      if (!s.token) row.err = 'The eCourts site did not open (HTTP ' + s.code + '). Try again in a minute.';
      else { sPut(sid, s); row.img = imgData(r); }
      rows.push(row);
    });
  }
  return { ok: true, rows: rows };
}

/* A new CAPTCHA picture — on the same session if it is still alive, else a fresh one. */
function newCaptcha(sid, cnr) {
  var s = sGet(sid);
  if (!s) { var st = startSessions([cnr]).rows[0]; return { ok: true, sid: st.sid, img: st.img, err: st.err }; }
  var r = fetch1(rq(BASE + '/vendor/securimage/securimage_show.php?' + Math.random(), s.cookie));
  s.cookie = cookieMerge(s.cookie, r); sPut(sid, s);
  return { ok: true, sid: sid, img: imgData(r) };
}

/* POST to one of the site's ajax pages, keeping the rolling app_token. */
function ajax(s, page, data) {
  var r = fetch1(rq(BASE + '/?p=' + page, s.cookie, data + '&ajax_req=true&app_token=' + enc(s.token)));
  s.cookie = cookieMerge(s.cookie, r);
  var t = r.getContentText().replace(/^﻿/, ''), j;
  try { j = JSON.parse(t); }
  catch (e) {
    var parts = t.split('#####');
    if (parts[1]) s.token = parts[1].trim();
    else { var m = t.match(/"app_token":"([^"]+)"/); if (m) s.token = m[1]; }
    var why = strip(parts[0] || t).slice(0, 180);
    var err = new Error(why || ('eCourts did not answer properly (HTTP ' + r.getResponseCode() + ')'));
    err.soft = true; throw err;
  }
  if (j && j.app_token) s.token = j.app_token;
  return j || {};
}

/* ---------------- search by CNR ---------------- */
function search(b) {
  var s = sGet(b.sid);
  if (!s) return { ok: true, expired: true };
  var cnr = String(b.cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var j;
  try { j = ajax(s, 'cnr_status/searchByCNR/', 'cino=' + enc(cnr) + '&fcaptcha_code=' + enc(String(b.captcha || '').trim())); }
  catch (e) { sPut(b.sid, s); if (e.soft) return retry(b.sid, s, e.message); throw e; }
  sPut(b.sid, s);
  var html = j.casetype_list || '';
  if (String(j.status) === '0' || (!html && (j.errormsg || j.div_captcha))) {
    return retry(b.sid, s, strip(j.errormsg || '') || 'Wrong CAPTCHA');
  }
  var dm = html.match(/id=["']sess_dist_code["'][^>]*value=["']([^"']*)/i);
  if (dm) { s.dist = dm[1]; sPut(b.sid, s); }
  var d = parseCase(html);
  if (!d.found) {
    saveDebug(cnr, html || JSON.stringify(j));
    var txt = strip(html).slice(0, 200);
    return { ok: true, notFound: true, msg: txt || 'eCourts returned no details for this CNR.' };
  }
  if (!d.next && !d.hist.length && !d.orders.length) saveDebug(cnr, html);
  return { ok: true, data: d };
}
function retry(sid, s, msg) {
  var r = fetch1(rq(BASE + '/vendor/securimage/securimage_show.php?' + Math.random(), s.cookie));
  s.cookie = cookieMerge(s.cookie, r); sPut(sid, s);
  return { ok: true, bad: true, msg: msg || 'Wrong CAPTCHA', img: imgData(r) };
}
function saveDebug(cnr, text) {
  try {
    var f = rootFolder(), name = '_ecourts_last_response.html', it = f.getFilesByName(name);
    var body = '<!-- ' + cnr + ' ' + new Date().toISOString() + ' -->\n' + text;
    if (it.hasNext()) it.next().setContent(body); else f.createFile(name, body, MimeType.HTML);
  } catch (e) {}
}

/* ---------------- parsing the case page ---------------- */
var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function isoDate(s) {
  s = String(s || '');
  var m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m) { var mi = MON.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return m[3] + '-' + pad(mi + 1) + '-' + pad(m[1]); }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return '';
}
function unent(h) {
  return String(h || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); });
}
function strip(h) {
  return unent(String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

function tables(html) {
  var list = [], re = /<table([^>]*)>([\s\S]*?)<\/table>/gi, m;
  while ((m = re.exec(html))) {
    var cls = ((m[1].match(/class\s*=\s*["']([^"']*)/i) || [])[1] || '') + ' ' + ((m[1].match(/id\s*=\s*["']([^"']*)/i) || [])[1] || '');
    var rows = [], rr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, r;
    while ((r = rr.exec(m[2]))) {
      var cells = [], cr = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi, c;
      while ((c = cr.exec(r[1]))) cells.push({ h: c[1].toLowerCase() === 'h', raw: unent(c[2] + ' ' + c[3]), t: strip(c[3]) });
      if (cells.length) rows.push(cells);
    }
    var before = html.slice(Math.max(0, m.index - 500), m.index), hd = '', hm, hre = /<(h[1-6]|strong|b|label|span)[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((hm = hre.exec(before))) { var tx = strip(hm[2]); if (tx) hd = tx; }
    list.push({ cls: cls.toLowerCase(), rows: rows, heading: hd });
  }
  return list;
}
function jsArgs(raw, fn) {
  var m = String(raw || '').match(new RegExp(fn + '\\s*\\(([^)]*)\\)', 'i'));
  if (!m) return null;
  var args = [], re = /'([^']*)'|"([^"]*)"|([^,\s][^,]*)/g, a;
  while ((a = re.exec(m[1]))) args.push((a[1] !== undefined ? a[1] : a[2] !== undefined ? a[2] : a[3]).trim());
  return args;
}
function headerIndex(row, words) {
  for (var i = 0; i < row.length; i++) { var t = norm(row[i].t); for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) >= 0) return i; }
  return -1;
}

function parseCase(html) {
  var d = { found: false, hist: [], orders: [] }, kv = {};
  var tbs = tables(html);
  tbs.forEach(function (tb) {
    var first = tb.rows[0] || [], ht = norm(first.map(function (c) { return c.t; }).join('|'));
    /* hearing history */
    if (/history_table/.test(tb.cls) || (ht.indexOf('businessondate') >= 0 && ht.indexOf('hearingdate') >= 0)) {
      var iJ = headerIndex(first, ['judge']), iB = headerIndex(first, ['businessondate']),
          iH = headerIndex(first, ['hearingdate']), iP = headerIndex(first, ['purpose']);
      if (iB < 0) { iJ = 0; iB = 1; iH = 2; iP = 3; }
      tb.rows.slice(1).forEach(function (r) {
        if (r.length < 3) return;
        var bd = isoDate(r[iB] && r[iB].t), hd = iH >= 0 ? isoDate(r[iH] && r[iH].t) : '';
        if (!bd && !hd) return;
        d.hist.push({ bd: bd, d: hd, j: iJ >= 0 && r[iJ] ? r[iJ].t : '', p: iP >= 0 && r[iP] ? r[iP].t : '',
                      a: jsArgs(r[iB] && r[iB].raw, 'viewBusiness') });
      });
      d.found = true; return;
    }
    /* orders */
    if (/order_table/.test(tb.cls) || ht.indexOf('orderdate') >= 0) {
      var iN = headerIndex(first, ['ordernumber', 'orderno']), iD = headerIndex(first, ['orderdate']), iT = headerIndex(first, ['orderdetail', 'details']);
      var title = /final/i.test(tb.heading) ? 'Final Order' : (/interim/i.test(tb.heading) ? 'Order' : 'Order');
      tb.rows.forEach(function (r, ri) {
        var raw = r.map(function (c) { return c.raw; }).join(' ');
        var a = jsArgs(raw, 'displayPdf');
        if (!a || a.length < 4) return;
        var od = iD >= 0 && r[iD] ? isoDate(r[iD].t) : isoDate(r.map(function (c) { return c.t; }).join(' '));
        var no = iN >= 0 && r[iN] ? r[iN].t : '';
        var det = iT >= 0 && r[iT] ? r[iT].t : '';
        var t2 = /judg/i.test(det) ? 'Judgment' : (/final/i.test(det) ? 'Final Order' : title);
        d.orders.push({ key: okey(a), no: no, d: od, title: t2, a: a });
      });
      d.found = true; return;
    }
    /* label / value tables */
    tb.rows.forEach(function (r) {
      for (var i = 0; i + 1 < r.length; i += 2) {
        var k = norm(r[i].t); if (k && kv[k] === undefined) kv[k] = r[i + 1].t;
      }
    });
    if (tb.cls.indexOf('petitioner') >= 0) d.pet = strip(tb.rows.map(function (r) { return r.map(function (c) { return c.t; }).join(' '); }).join('\n'));
    if (tb.cls.indexOf('respondent') >= 0) d.res = strip(tb.rows.map(function (r) { return r.map(function (c) { return c.t; }).join(' '); }).join('\n'));
  });
  /* some pages put the parties in <span> blocks rather than tables */
  if (!d.pet) { var pm = html.match(/class=["'][^"']*Petitioner_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (pm) d.pet = strip(pm[1]); }
  if (!d.res) { var rm = html.match(/class=["'][^"']*Respondent_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (rm) d.res = strip(rm[1]); }

  function g() { for (var i = 0; i < arguments.length; i++) { var v = kv[arguments[i]]; if (v) return v; } return ''; }
  d.ctype    = g('casetype');
  d.filing   = g('filingnumber');
  d.reg      = g('registrationnumber');
  d.cnr      = g('cnrnumber');
  d.first    = isoDate(g('firsthearingdate'));
  d.next     = isoDate(g('nexthearingdate', 'nextdate'));
  d.decision = isoDate(g('decisiondate', 'dateofdecision'));
  d.stage    = g('casestage', 'stageofcase');
  d.status   = g('casestatus', 'status');
  d.disposal = g('natureofdisposal');
  d.judge    = g('courtnumberandjudge', 'courtnoandjudge');
  d.disposed = !!(d.decision || d.disposal || /dispos/i.test(d.status + ' ' + d.stage));
  if (d.ctype || d.reg || d.cnr || d.next || d.stage || d.status) d.found = true;
  /* the purpose shown against the next date, if the history has it */
  if (d.next) d.hist.forEach(function (h) { if (h.d === d.next && h.p) d.purpose = h.p; });
  if (!d.purpose && d.hist.length) { var last = d.hist[d.hist.length - 1]; if (last.d === d.next) d.purpose = last.p; }
  d.pet = (d.pet || '').slice(0, 600); d.res = (d.res || '').slice(0, 600);
  return d;
}
function okey(a) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, (a[2] || '') + '|' + (a[3] || ''));
  return raw.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 14);
}

/* ---------------- one order → Drive ---------------- */
function getOrder(b) {
  var s = sGet(b.sid);
  if (!s) return { ok: true, expired: true };
  var a = b.a || [];
  var folder = caseFolder(b.cnr, b.label);
  var name = fileName(b);
  var ex = folder.getFilesByName(name);
  if (ex.hasNext()) { var f0 = ex.next(); return done(f0, b.want); }

  var j = ajax(s, 'home/display_pdf',
    'normal_v=' + enc(a[0]) + '&case_val=' + enc(a[1]) + '&court_code=' + enc(a[2]) + '&filename=' + enc(a[3]) + '&appFlag=' + enc(a[4] || ''));
  sPut(b.sid, s);
  if (!j.order) return { ok: true, missing: true, msg: strip(j.errormsg || '') || 'eCourts has no PDF for this order' };
  var path = String(j.order).replace(/^\.?\//, '');
  var url = /^https?:/i.test(path) ? path : BASE + '/' + path;
  var r = fetch1(rq(url, s.cookie));
  s.cookie = cookieMerge(s.cookie, r); sPut(b.sid, s);
  var bytes = r.getContent();
  if (r.getResponseCode() !== 200 || bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF')
    return { ok: true, missing: true, msg: 'The PDF could not be downloaded (HTTP ' + r.getResponseCode() + ')' };
  var file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  return done(file, b.want, bytes);
}
function done(file, want, bytes) {
  var o = { ok: true, fid: file.getId(), name: file.getName(), folder: file.getParents().next().getName(), size: file.getSize() };
  if (want && o.size < 6 * 1024 * 1024) o.b64 = Utilities.base64Encode(bytes || file.getBlob().getBytes());
  return o;
}
function clean(s) { return String(s || '').replace(/[\\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function fileName(b) {
  return clean((b.d || 'undated') + ' ' + (b.title || 'Order') + (b.no ? ' No ' + b.no : '')).slice(0, 120) + '.pdf';
}

/* ---------------- business on a hearing date ---------------- */
function getBiz(b) {
  var s = sGet(b.sid);
  if (!s) return { ok: true, expired: true };
  var a = b.a || [];
  // viewBusiness(court_code,dist_code,n_dt,case_number,state_code,businessStatus,todays_date1,court_no,national_court_code,caseStatusSearchType,srno)
  var data = 'court_code=' + enc(a[0]) + '&state_code=' + enc(a[4]) + '&dist_code=' + enc(s.dist || a[1]) +
    '&nextdate1=' + enc(a[2]) + '&case_number1=' + enc(a[3]) + '&state_code=' + enc(a[4]) +
    '&disposal_flag=' + enc(a[5]) + '&businessDate=' + enc(a[6]) + '&national_court_code=' + enc(a[8]) +
    '&court_no=' + enc(a[7]) + '&search_by=' + enc(a[9] || 'cnr') + '&srno=' + enc(a[10]);
  var j = ajax(s, 'home/viewBusiness', data);
  sPut(b.sid, s);
  var t = strip(j.data_list || '');
  var m = t.match(/Business\s*:?\s*([\s\S]*?)(?:\n\s*Next Purpose|\n\s*Next Hearing Date|$)/i);
  var txt = (m && m[1] ? m[1] : t).replace(/\s+/g, ' ').trim();
  return { ok: true, text: txt.slice(0, 700) };
}

/* ---------------- Drive ---------------- */
function rootFolder() { return DriveApp.getFolderById(FOLDER_ID); }
function ordersFolder() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('ordersFolder');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var root = rootFolder(), it = root.getFoldersByName(ORDERS_FOLDER);
  var fo = it.hasNext() ? it.next() : root.createFolder(ORDERS_FOLDER);
  p.setProperty('ordersFolder', fo.getId());
  return fo;
}
function caseFolder(cnr, label) {
  cnr = String(cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var p = PropertiesService.getScriptProperties(), key = 'cf_' + cnr, id = p.getProperty(key);
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var of = ordersFolder(), it = of.searchFolders("title contains '" + cnr + "' and trashed = false");
  var fo = it.hasNext() ? it.next() : of.createFolder(clean((label || 'Case').slice(0, 80) + ' [' + cnr + ']'));
  p.setProperty(key, fo.getId());
  return fo;
}
function readPdf(fid) {
  var file = DriveApp.getFileById(fid), ok = false, ofId = ordersFolder().getId();
  var ps = file.getParents();
  while (ps.hasNext() && !ok) { var pp = ps.next().getParents(); while (pp.hasNext()) if (pp.next().getId() === ofId) ok = true; }
  if (!ok) throw new Error('That file is not one of the saved eCourts orders.');
  return { ok: true, name: file.getName(), folder: file.getParents().next().getName(), b64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

/* Run this once from the editor (select "authorise" and press Run) so Google asks for permission. */
function authorise() { rootFolder().getName(); UrlFetchApp.fetch(BASE + '/', { muteHttpExceptions: true }); }
