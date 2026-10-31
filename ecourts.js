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

var ECO_MAX = 60;   /* cases on one CAPTCHA screen (pictures stay valid about 20 minutes) */
var ECO = { rows: [], lanes: {}, active: 0, maxLanes: 3, dir: null, db: null, savePending: null, busyAll: false };
window.ECO = ECO;

/* ---------------- config (kept in Settings, so it syncs to every device) ---------------- */
function cfg() { return (window.S && S.eco) || {}; }
function setCfg(c) { S.eco = c; saveAll(); }
function cleanCnr(x) { return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/* district-court CNRs and, from Oct 2026, High Court CNRs (HCBM…) — the backend picks the right site */
function ecoOk(c) { var n = cleanCnr(c && c.cnr); return n.length === 16 && !/^SCIN/.test(n) && !(window.trKind && trKind(c)); }
/* the Drive folder key for a case: its CNR, or (Supreme Court diary / CAT / MAT) a key made from court + case number */
function fkey(c) {
  var n = cleanCnr(c && c.cnr); if (n) return n;
  var k = String((c && c.court) || '').replace(/[^A-Za-z]/g, '').replace(/[a-z]/g, '').slice(0, 6) + cleanCnr(c && c.cn);
  return (k || 'MANUAL' + (c && c.id || '')).slice(0, 40);
}
window.ecoFkey = fkey;
window.ecoOk = ecoOk;

function gpost(body) {
  var c = cfg();
  if (!c.url || !c.tok) return Promise.reject(new Error('Set up the eCourts backend first: Settings → Official eCourts.'));
  if (!navigator.onLine) return Promise.reject(new Error('No internet connection right now.'));
  body.token = c.tok;
  var ctl = window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, 90000) : 0;
  return fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(tm); return r.text(); }, function (e) {
      clearTimeout(tm);
      throw new Error(e && e.name === 'AbortError' ? 'The Google backend did not answer within 90 seconds (the court site is probably refusing Google just now). Start Charpe Helper on this PC and allow it — see Sync Centre → Check connections.' : 'The Google backend could not be reached (' + (e.message || e) + ').');
    })
    .then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) { throw new Error('The eCourts backend did not answer properly. Check its address in Settings.'); }
      if (!j.ok) throw new Error(j.error || 'The eCourts backend reported a problem');
      return j;
    });
}
/* every call goes through the helper first when it can, else to the Google backend */
/* Court fetching goes ONLY through Charpe Helper on a PC where it is installed (Oct 2026):
   no more silent switching to Google's servers half-way. High Court cases are never sent to Google.
   On a device without the helper (iPad / phone) district courts still go through Google. */
function helperPC() { try { return localStorage.getItem('cs_helper_pc') === '1'; } catch (e) { return false; } }
function isHcCnr(c) { return /^HC[A-Z]{2}\d/.test(String(c || '').toUpperCase()); }
window.ecoHelperPC = helperPC; window.ecoIsHcCnr = isHcCnr;
var NOHELP = 'Charpe Helper on this PC is not answering, so nothing was sent anywhere. Open <b>127.0.0.1:8770</b> in Chrome to check it is running (or restart the PC), then press <b>Try again</b>. <a href="#" onclick="charpeHelperTest();return false">Test the connection</a>';
var NOHELP_TXT = 'Charpe Helper on this PC is not answering, so nothing was sent anywhere. Open 127.0.0.1:8770 in Chrome to check it is running (or restart the PC), then try again.';
var NOHELP_HC = 'High Court cases are fetched only through Charpe Helper on the office PC. Open this on that PC, or start the helper here.';
var COURT_ACT = { start: 1, captcha: 1, biz: 1, search: 1, order: 1, sopen: 1, stypes: 1, ssearch: 1 };
function post(body) {
  var a = body.action;
  return viaHelper(body).then(function (r) {
    if (r) return r;
    if (a === 'start') {
      var cn = body.cnrs || [];
      if (helperPC()) return { ok: true, rows: cn.map(function (c) { return { cnr: c, err: NOHELP }; }) };
      var dc = cn.filter(function (c) { return !isHcCnr(c); });
      var send = dc.length ? gpost({ action: 'start', cnrs: dc }) : Promise.resolve({ rows: [] });
      return send.then(function (g) {
        var i = 0; return { ok: true, rows: cn.map(function (c) { return isHcCnr(c) ? { cnr: c, err: NOHELP_HC } : ((g.rows || [])[i++] || { cnr: c, err: 'No answer' }); }) };
      });
    }
    /* only court-site requests are kept off Google's servers. Opening saved orders from Drive (pdf), saving
       them (upload), CAT, and the connection test always go to the Google backend (fixed 30 Oct 2026). */
    if (COURT_ACT[a] && (isHcCnr(body.cnr) || helperPC())) throw new Error(isHcCnr(body.cnr) && !helperPC() ? NOHELP_HC : NOHELP_TXT);
    return gpost(body);
  }, function (e) {
    if (/Failed to fetch|NetworkError|aborted|AbortError/i.test(e.message || '')) { HLP.ok = null; throw new Error(NOHELP_TXT); }
    throw e;
  });
}

/* ==================================================================
   ROUTE: through Charpe Helper on this PC first (Oct 2026)
   Google's servers are often turned away by the court sites, so the
   CAPTCHA, the case page and the order PDFs come through the helper
   (your own connection) whenever it is running; Google then only keeps
   the PDFs in Drive. If the helper is not running, the Google backend
   is used as before — and it now gives up after 90 seconds with a
   clear message instead of waiting for ever.
   ================================================================== */
var HLP = { ok: null, at: 0, v: 0 }, HELPER_URL = 'http://127.0.0.1:8770/';
function hpost(b, ms) {
  var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 120000) : 0;
  return fetch(HELPER_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b), signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(t); return r.json(); })
    .then(function (j) { if (!j.ok) throw new Error(j.error || 'Charpe Helper reported a problem'); return j; });
}
function helperOk() {
  if (HLP.ok === true && Date.now() - HLP.at < 60000) return Promise.resolve(true);
  if (HLP.ok === false && Date.now() - HLP.at < 8000) return Promise.resolve(false);
  var ping = function (ms) { return hpost({ action: 'ping' }, ms).then(function (j) { HLP.v = j.helper || 0; HLP.ok = HLP.v >= 5; HLP.at = Date.now(); if (HLP.ok) { try { localStorage.setItem('cs_helper_pc', '1'); } catch (e) {} } return HLP.ok; }); };
  /* a busy PC can be slow to answer once: ask twice before deciding it is not there */
  return ping(4000).catch(function () { return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return ping(7000); }); })
    .catch(function () { HLP.ok = false; HLP.at = Date.now(); return false; });
}
window.ecoHelperOk = helperOk;
window.charpeHelperPost = hpost;
window.charpeHelperVersion = function () { return HLP.v || 0; };
/* "Test the connection": says plainly whether this page can reach Charpe Helper, and if not, what to do */
window.charpeHelperTest = function () {
  toast('Testing the connection to Charpe Helper…');
  var t0 = Date.now();
  hpost({ action: 'ping' }, 6000).then(function (j) {
    HLP.ok = (j.helper || 0) >= 5; HLP.v = j.helper || 0; HLP.at = Date.now(); if (HLP.ok) { try { localStorage.setItem('cs_helper_pc', '1'); } catch (e) {} }
    alertBox(HLP.ok ? '&#10003; Charpe Helper is reachable (version ' + j.helper + ', ' + (Date.now() - t0) + ' ms). Court fetching goes through your PC.'
      : 'Charpe Helper answered but is an old version (' + j.helper + '). Run the newest "Install Charpe Helper.bat".');
  }).catch(function (e) {
    HLP.ok = false; HLP.at = Date.now();
    alertBox('&#9888; This page cannot reach Charpe Helper (' + he(e.message || String(e)) + ').<br><br>' +
      '1. Check the helper is running: open <b>http://127.0.0.1:8770/</b> in Chrome — it should say "Charpe helper is running".<br>' +
      '2. If it is running, Chrome is blocking this site from it. In Chrome paste <b>chrome://settings/content/siteDetails?site=https%3A%2F%2Fsanketcharpe.github.io</b> and set <b>Local network access</b> (also "Apps on device" / "Local network" if shown) to <b>Allow</b>, then close and reopen Charpe Suite.');
  });
};
function alertBox(html) {
  var o = document.getElementById('chtest'); if (o) o.remove();
  var d = document.createElement('div'); d.id = 'chtest';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(10,18,32,.5);z-index:100001;display:flex;align-items:flex-start;justify-content:center;padding:70px 12px';
  d.innerHTML = '<div style="background:#fff;color:#1a2744;border-radius:10px;max-width:560px;width:100%;padding:16px 18px;font-size:13px;line-height:1.55;box-shadow:0 14px 40px rgba(0,0,0,.35)">' + html +
    '<div style="text-align:right;margin-top:12px"><button class="btn bg" onclick="document.getElementById(\'chtest\').remove()">OK</button></div></div>';
  document.body.appendChild(d);
}
function viaHelper(body) {
  var a = body.action, sid = String(body.sid || '');
  if (a === 'start') {
    return helperOk().then(function (ok) {
      if (!ok) return null;
      return hpost({ action: 'dcstart', cnrs: body.cnrs }).then(function (r) {
        (r.rows || []).forEach(function (x) { if (x.sid) x.sid = 'P:' + x.sid; });
        return r;
      });
    });
  }
  if (sid.indexOf('P:') !== 0) return Promise.resolve(null);
  var hs = sid.slice(2);
  if (a === 'captcha') return hpost({ action: 'dccaptcha', sid: hs, cnr: body.cnr }).then(function (r) { if (r.sid) r.sid = 'P:' + r.sid; return r; });
  if (a === 'biz') return hpost({ action: 'dcbiz', sid: hs, a: body.a });
  if (a === 'search') {
    return hpost({ action: 'dcsearch', sid: hs, cnr: body.cnr, captcha: body.captcha }).then(function (r) {
      if (!r.html) return r;
      var c = null; ECO.rows.forEach(function (x) { if (x.sid === sid) c = find(x.cid); });
      var d = r.kind === 'hc' && window.trHcParse ? trHcParse(r.html, c) : dcParse(r.html);
      if (!d.found) return { ok: true, notFound: true, msg: hStrip0(r.html).slice(0, 200) || 'eCourts returned no details for this CNR.' };
      return { ok: true, data: d };
    });
  }
  if (a === 'order') {
    return hpost({ action: 'dcorder', sid: hs, a: body.a }).then(function (r) {
      if (r.expired || r.missing || !r.b64) return r;
      var name = String((body.d || 'undated') + ' ' + (body.title || 'Order') + (body.no ? ' No ' + body.no : '')).replace(/[\\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pdf';
      return gpost({ action: 'upload', cnr: body.cnr, label: body.label, name: name, b64: r.b64 })
        .then(function (x) { return { ok: true, fid: x.fid, name: x.name, folder: x.folder, b64: r.b64 }; });
    });
  }
  return Promise.resolve(null);
}

/* ---- the district case page, read here in the browser (same rules as the backend's parseCase) ---- */
function md5(str) {
  function rh(n) { var s = '', j; for (j = 0; j <= 3; j++) s += ((n >> (j * 8 + 4)) & 15).toString(16) + ((n >> (j * 8)) & 15).toString(16); return s; }
  function ad(x, y) { var l = (x & 0xFFFF) + (y & 0xFFFF), m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xFFFF); }
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function cm(q, a, b, x, s, t) { return ad(rl(ad(ad(a, q), ad(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cm((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cm((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cm(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cm(c ^ (b | (~d)), a, b, x, s, t); }
  str = unescape(encodeURIComponent(str));
  var nb = ((str.length + 8) >> 6) + 1, x = new Array(nb * 16), i;
  for (i = 0; i < nb * 16; i++) x[i] = 0;
  for (i = 0; i < str.length; i++) x[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
  x[i >> 2] |= 0x80 << ((i % 4) * 8); x[nb * 16 - 2] = str.length * 8;
  var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (i = 0; i < x.length; i += 16) {
    var oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = ad(a, oa); b = ad(b, ob); c = ad(c, oc); d = ad(d, od);
  }
  return rh(a) + rh(b) + rh(c) + rh(d);
}
var DMON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dpad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function dIso(s) {
  s = String(s || ''); var m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + dpad(m[2]) + '-' + dpad(m[1]);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m) { var mi = DMON.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return m[3] + '-' + dpad(mi + 1) + '-' + dpad(m[1]); }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
}
function dUnent(h) { return String(h || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }); }
function hStrip0(h) {
  return dUnent(String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function dNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function dTables(html) {
  var list = [], re = /<table([^>]*)>([\s\S]*?)<\/table>/gi, m;
  while ((m = re.exec(html))) {
    var cls = ((m[1].match(/class\s*=\s*["']([^"']*)/i) || [])[1] || '') + ' ' + ((m[1].match(/id\s*=\s*["']([^"']*)/i) || [])[1] || '');
    var rows = [], rr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, r;
    while ((r = rr.exec(m[2]))) {
      var cells = [], cr = /<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi, c;
      while ((c = cr.exec(r[1]))) cells.push({ raw: dUnent(c[2] + ' ' + c[3]), t: hStrip0(c[3]) });
      if (cells.length) rows.push(cells);
    }
    var before = html.slice(Math.max(0, m.index - 500), m.index), hd = '', hm, hre = /<(h[1-6]|strong|b|label|span)[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((hm = hre.exec(before))) { var tx = hStrip0(hm[2]); if (tx) hd = tx; }
    list.push({ cls: cls.toLowerCase(), rows: rows, heading: hd });
  }
  return list;
}
function dArgs(raw, fn) {
  var m = String(raw || '').match(new RegExp(fn + '\\s*\\(([^)]*)\\)', 'i')); if (!m) return null;
  var args = [], re = /'([^']*)'|"([^"]*)"|([^,\s][^,]*)/g, a;
  while ((a = re.exec(m[1]))) args.push((a[1] !== undefined ? a[1] : a[2] !== undefined ? a[2] : a[3]).trim());
  return args;
}
function dIdx(row, words) { for (var i = 0; i < row.length; i++) { var t = dNorm(row[i].t); for (var w = 0; w < words.length; w++) if (t.indexOf(words[w]) >= 0) return i; } return -1; }
function dcParse(html) {
  var d = { found: false, hist: [], orders: [] }, kv = {};
  dTables(html).forEach(function (tb) {
    var first = tb.rows[0] || [], ht = dNorm(first.map(function (c) { return c.t; }).join('|'));
    if (/history_table/.test(tb.cls) || (ht.indexOf('businessondate') >= 0 && ht.indexOf('hearingdate') >= 0)) {
      var iJ = dIdx(first, ['judge']), iB = dIdx(first, ['businessondate']), iH = dIdx(first, ['hearingdate']), iP = dIdx(first, ['purpose']);
      if (iB < 0) { iJ = 0; iB = 1; iH = 2; iP = 3; }
      tb.rows.slice(1).forEach(function (r) {
        if (r.length < 3) return;
        var bd = dIso(r[iB] && r[iB].t), hd = iH >= 0 ? dIso(r[iH] && r[iH].t) : '';
        if (!bd && !hd) return;
        d.hist.push({ bd: bd, d: hd, j: iJ >= 0 && r[iJ] ? r[iJ].t : '', p: iP >= 0 && r[iP] ? r[iP].t : '', a: dArgs(r[iB] && r[iB].raw, 'viewBusiness') });
      });
      d.found = true; return;
    }
    if (/order_table/.test(tb.cls) || ht.indexOf('orderdate') >= 0) {
      var iN = dIdx(first, ['ordernumber', 'orderno']), iD = dIdx(first, ['orderdate']), iT = dIdx(first, ['orderdetail', 'details']);
      var title = /final/i.test(tb.heading) ? 'Final Order' : 'Order';
      tb.rows.forEach(function (r) {
        var raw = r.map(function (c) { return c.raw; }).join(' '), a = dArgs(raw, 'displayPdf');
        if (!a || a.length < 4) return;
        var od = iD >= 0 && r[iD] ? dIso(r[iD].t) : dIso(r.map(function (c) { return c.t; }).join(' '));
        var det = iT >= 0 && r[iT] ? r[iT].t : '';
        d.orders.push({ key: md5((a[2] || '') + '|' + (a[3] || '')).slice(0, 14), no: iN >= 0 && r[iN] ? r[iN].t : '', d: od,
          title: /judg/i.test(det) ? 'Judgment' : (/final/i.test(det) ? 'Final Order' : title), a: a });
      });
      d.found = true; return;
    }
    tb.rows.forEach(function (r) { for (var i = 0; i + 1 < r.length; i += 2) { var k = dNorm(r[i].t); if (k && kv[k] === undefined) kv[k] = r[i + 1].t; } });
    if (tb.cls.indexOf('petitioner') >= 0) d.pet = hStrip0(tb.rows.map(function (r) { return r.map(function (c) { return c.t; }).join(' '); }).join('\n'));
    if (tb.cls.indexOf('respondent') >= 0) d.res = hStrip0(tb.rows.map(function (r) { return r.map(function (c) { return c.t; }).join(' '); }).join('\n'));
  });
  if (!d.pet) { var pm = html.match(/class=["'][^"']*Petitioner_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (pm) d.pet = hStrip0(pm[1]); }
  if (!d.res) { var rm = html.match(/class=["'][^"']*Respondent_Advocate_table[^"']*["'][^>]*>([\s\S]*?)<\/(?:table|span|div)>/i); if (rm) d.res = hStrip0(rm[1]); }
  function g() { for (var i = 0; i < arguments.length; i++) { var v = kv[arguments[i]]; if (v) return v; } return ''; }
  d.ctype = g('casetype'); d.filing = g('filingnumber'); d.reg = g('registrationnumber'); d.cnr = g('cnrnumber');
  d.first = dIso(g('firsthearingdate')); d.next = dIso(g('nexthearingdate', 'nextdate')); d.decision = dIso(g('decisiondate', 'dateofdecision'));
  d.stage = g('casestage', 'stageofcase'); d.status = g('casestatus', 'status'); d.disposal = g('natureofdisposal'); d.judge = g('courtnumberandjudge', 'courtnoandjudge');
  d.disposed = !!(d.decision || d.disposal || /dispos/i.test(d.status + ' ' + d.stage));
  if (d.ctype || d.reg || d.cnr || d.next || d.stage || d.status) d.found = true;
  if (d.next) d.hist.forEach(function (h) { if (h.d === d.next && h.p) d.purpose = h.p; });
  if (!d.purpose && d.hist.length) { var last = d.hist[d.hist.length - 1]; if (last.d === d.next) d.purpose = last.p; }
  d.pet = (d.pet || '').slice(0, 600); d.res = (d.res || '').slice(0, 600);
  return d;
}
window.ecoDcParse = dcParse;

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
    'District courts come from services.ecourts.gov.in; Bombay High Court matters (CNR beginning HCBM) from hcservices.ecourts.gov.in. Add any other case with the search box.</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;padding:8px;background:#f3f6fb;border:1px solid #dbe3f0;border-radius:6px">' +
      '<b style="font-size:12px">All cases of one court:</b><select id="ecoct" onchange="ecoCourt(this.value)" style="flex:1;min-width:220px;padding:6px;font-size:12px">' + courtOpts() + '</select>' +
      '<label style="font-size:11px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="ecoctdue" onchange="ecoCourt(document.getElementById(\'ecoct\').value)"> only those due</label></div>' +
    '<div id="ecoctnote"></div>' +
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
/* the courts that have open cases, for "All cases of one court" */
function courtKey(c) { return String(c.court || '').replace(/\s+/g, ' ').trim() || '(court not given)'; }
function courtOpts() {
  var m = {}; LC().forEach(function (c) { if (!isOpen(c)) return; var k = courtKey(c); m[k] = m[k] || { n: 0, no: 0 }; if (ecoOk(c)) m[k].n++; else m[k].no++; });
  var ks = Object.keys(m).sort(function (a, b) { return m[b].n - m[a].n || a.localeCompare(b); });
  return '<option value="">— pick a court to list all its open cases —</option>' + ks.map(function (k) {
    return '<option value="' + he(k) + '"' + (m[k].n ? '' : ' disabled') + '>' + he(k) + ' — ' + m[k].n + ' case' + (m[k].n === 1 ? '' : 's') + (m[k].no ? ' (+' + m[k].no + ' without CNR)' : '') + '</option>';
  }).join('');
}
window.ecoCourt = function (k) {
  var note = document.getElementById('ecoctnote'); if (!k) { if (note) note.innerHTML = ''; return; }
  var due = (document.getElementById('ecoctdue') || {}).checked, dueSet = {}; dueCases().forEach(function (x) { dueSet[x.id] = 1; });
  var of = LC().filter(function (c) { return isOpen(c) && courtKey(c) === k; });
  var ok = of.filter(function (c) { return ecoOk(c) && (!due || dueSet[c.id]); }), no = of.filter(function (c) { return !ecoOk(c); });
  ok.sort(function (a, b) { return String(a.nd || '9').localeCompare(String(b.nd || '9')) || ctit(a).localeCompare(ctit(b)); });
  ECO.pick = {}; ok.forEach(function (c) { ECO.pick[c.id] = 1; });
  ECO.allCases = LC().filter(function (x) { return ecoOk(x) && isOpen(x); });
  ECO.courtNoCnr = no;
  var q = document.getElementById('ecoq'); if (q) q.value = '';
  if (note) note.innerHTML = '<div class="note" style="margin:0 0 6px"><b>' + ok.length + '</b> case' + (ok.length === 1 ? '' : 's') + ' of <b>' + he(k) + '</b> ticked' +
    (ok.length > ECO_MAX ? ' — the first ' + ECO_MAX + ' are shown at a time.' : '.') +
    (no.length ? ' ' + no.length + ' other case' + (no.length === 1 ? ' has' : 's have') + ' no CNR: ' + no.slice(0, 8).map(function (c) { return he(label(c)); }).join('; ') + (no.length > 8 ? '…' : '') +
      ' — on that case press <b>&#9878; Find on eCourts</b> (or <b>Fetch from High Court</b>) once; it then gets its CNR and joins this list.' : '') + '</div>';
  ecoPickList();
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
  if (ids.length > ECO_MAX) { toast('Showing the first ' + ECO_MAX + '. Run again for the rest.'); ids = ids.slice(0, ECO_MAX); }
  loadCaptchas(ids);
};

/* step 2 — one CAPTCHA per case */
function loadCaptchas(ids) {
  setTimeout(function () { ECO.skipped = null; }, 0);
  dirReady(true);   /* we are inside a click: ask for the PC folder now, if one is set */
  ECO.rows = ids.map(function (id) { var c = find(id); return { cid: id, cnr: cleanCnr(c && c.cnr), st: 'load', msg: 'Opening eCourts…' }; });
  shell('&#9878; eCourts &mdash; type each CAPTCHA',
    '<div class="note">Type the characters you see for each case, pressing <b>Enter</b> to jump to the next one. ' +
    'Type them all one after another, then press <b>&#9654; Go</b> (or Ctrl+Enter) — or <b>Fetch</b> on any single row. Click a picture for a new one if it is hard to read. ' +
    'Each picture stays valid for about 20 minutes.</div>' +
    (ECO.skipped && ECO.skipped.length ? '<div class="note" style="background:#fff8e6;border:1px solid #f0d48a;border-radius:5px;padding:7px 9px">' +
      ECO.skipped.length + ' matter' + (ECO.skipped.length === 1 ? '' : 's') + ' on this board ' + (ECO.skipped.length === 1 ? 'has' : 'have') + ' no CNR and cannot be fetched: ' +
      ECO.skipped.map(function (c) { return '<b>' + he(label(c)) + '</b>'; }).join('; ') + '. Add the CNR in Edit, or find the case in Search Courts.</div>' : '') +
    '<div id="ecorows"></div>',
    '<button class="btn bg" id="ecoAllBtn" onclick="ecoFetchAll()" title="Fetch every row whose CAPTCHA you have typed, one after another">&#9654; Go &mdash; fetch all typed</button>' +
    '<button class="btn bo" onclick="ecoOpenBatch()">&#8249; Change cases</button>' +
    '<span id="ecoprog" style="font-size:11px;color:#555;margin-left:auto"></span>');
  paintRows();
  /* ask for the pictures a few at a time, so the first rows are ready to type while the rest load */
  var my = ECO.loadTok = (ECO.loadTok || 0) + 1, CH = 6, at = 0, first = true;
  function next() {
    if (my !== ECO.loadTok || at >= ECO.rows.length) return Promise.resolve();
    var from = at, chunk = ECO.rows.slice(at, at + CH); at += CH;
    return post({ action: 'start', cnrs: chunk.map(function (r) { return r.cnr; }) }).then(function (res) {
      if (my !== ECO.loadTok) return;
      (res.rows || []).forEach(function (x, j) {
        var r = ECO.rows[from + j]; if (!r) return;
        r.sid = x.sid; r.img = x.img;
        if (x.err) { r.st = 'bad'; r.msg = x.err; } else { r.st = 'ready'; r.msg = ''; }
        paintRow(from + j);
      });
      if (first) {
        first = false;
        if (HLP.ok === false) {
          var rw = document.getElementById('ecorows'), nt = document.createElement('div');
          nt.className = 'note'; nt.style.cssText = 'background:#fff8e6;border:1px solid #f0d48a;border-radius:5px;padding:7px 9px;margin-bottom:6px';
          nt.innerHTML = '&#9888; <b>Charpe Helper on this PC could not be reached</b>, so these go through Google, which the court sites often refuse. ' +
            '<a href="#" onclick="charpeHelperTest();return false"><b>Test the connection</b></a> to see why and what to do.';
          if (rw && rw.parentNode) rw.parentNode.insertBefore(nt, rw);
        }
        var a = document.activeElement; if (!a || a.tagName !== 'INPUT') { var f = document.querySelector('#ecorows input:not([disabled])'); if (f) f.focus(); }
      }
      /* a row that got no picture: ask once more by itself after a short pause */
      setTimeout(function () { for (var j = from; j < from + chunk.length; j++) { var r = ECO.rows[j]; if (r && r.st === 'bad' && !r.img && !r.auto) { r.auto = 1; ecoNewImg(j); } } }, 2500);
    }).catch(function (e) {
      chunk.forEach(function (r, j) { r.st = 'bad'; r.msg = he(e.message); paintRow(from + j); });
    }).then(next);
  }
  next();
}
function rowHTML(r, i) {
  var c = find(r.cid) || {};
  var cls = r.st === 'done' ? 'done' : (r.st === 'bad' || r.st === 'retype') ? 'bad' : (r.st === 'busy' || r.st === 'load') ? 'busy' : '';
  var img = r.img ? '<img src="' + r.img + '" title="Click for a new picture" onclick="ecoNewImg(' + i + ')">' :
    '<span style="font-size:11px;color:#888">' + (r.st === 'load' ? 'loading…' : '') + '</span>';
  var inp = r.st === 'done' ? '<span style="font-size:20px;color:#127a4b">&#10003;</span>' :
    (r.st === 'bad' && !r.img) ? '' :
    '<input id="ecoin' + i + '" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8" ' +
    'value="' + he(r.cap || '') + '" oninput="ECO.rows[' + i + '].cap=this.value;ecoProg()" onkeydown="ecoKey(event,' + i + ')"' +
    (r.st === 'busy' || r.st === 'load' ? ' disabled' : '') + '>';
  var btn = r.st === 'done' ? '<button class="btn bo" onclick="ecoAgain(' + i + ')" style="font-size:10px">Again</button>' :
    (r.st === 'bad' && !r.img) ? '<button class="btn bg" onclick="ecoNewImg(' + i + ')" title="Ask eCourts for a CAPTCHA again">&#8635; Try again</button>' :
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
window.ecoProg = function () { progress(); };
function progress() {
  var el = document.getElementById('ecoprog'); if (!el) return;
  var d = ECO.rows.filter(function (r) { return r.st === 'done'; }).length;
  var q = 0; Object.keys(ECO.lanes).forEach(function (k) { q += ECO.lanes[k].items.length; });
  var typed = ECO.rows.filter(function (r) { return r.st !== 'done' && (r.cap || '').trim(); }).length,
      loading = ECO.rows.filter(function (r) { return r.st === 'load'; }).length;
  el.innerHTML = d + ' of ' + ECO.rows.length + ' fetched' + (typed ? ' &middot; <b>' + typed + ' typed, ready to Go</b>' : '') + (loading ? ' &middot; ' + loading + ' pictures loading' : '') +
    (q || ECO.active ? ' &middot; downloading orders (' + q + ' left)' : '');
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
  /* no helper session yet (the helper was not answering before): start afresh through the helper */
  var fresh = !r.sid || (String(r.sid).indexOf('P:') !== 0 && (helperPC() || isHcCnr(r.cnr)));
  (fresh ? post({ action: 'start', cnrs: [r.cnr] }).then(function (x) { return (x.rows || [])[0] || { err: 'No answer' }; })
         : post({ action: 'captcha', sid: r.sid, cnr: r.cnr })).then(function (x) {
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
    else { x.a = o.a; x.d = x.d || o.d; x.no = x.no || o.no; if (!x.fid) delete x.none; }   /* not got yet: try it again this time */
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
  /* every date's proceedings (Oct 2026: no longer only the latest 25); a date the site answered blank
     is asked again, up to 3 fetches, instead of being left with only its stage */
  (e.hh || []).filter(function (h) { return h.a && (h.biz === undefined || (h.biz === '' && (h.bt || 0) < 3)); })
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
    var ob = { action: 'order', sid: L.sid, cnr: fkey(c), label: label(c), a: o.a, d: o.d, no: o.no, title: o.t, want: true };
    return ((window.trOrderPost && trOrderPost(c, o, ob)) || post(ob))
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
    if (h2) { var tx = String(r.text || '').trim(); h2.biz = tx; if (!tx) h2.bt = (h2.bt || 0) + 1; else delete h2.bt; touch(c2); later(); }
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
  else if (e.src === 'mat') h = '<span style="color:#555">no judgment on the MAT Nagpur list yet</span>';
  else h = '<span style="color:#2e7d32">&#10003; matches the court record</span>';
  if (e.stage) h += ' &middot; stage: ' + he(e.stage);

  var ord = e.ord || {}, keys = Object.keys(ord).sort(function (a, b) { return String(ord[b].d || '') < String(ord[a].d || '') ? -1 : 1; }), ox = '';
  if (keys.length) {
    h += ' &middot; <a href="#" onclick="event.stopPropagation();togEl(\'eoo_' + id + '\');return false"><b>Orders (' + keys.length + ')</b></a>';
    ox = '<div id="eoo_' + id + '" style="display:none;margin-top:5px;border-top:1px solid #eee;padding-top:5px;max-height:280px;overflow:auto">' +
      keys.map(function (k) {
        var o = ord[k];
        var btn = o.fid ? '<button class="btn bg" style="font-size:9px;padding:2px 8px" onclick="event.stopPropagation();ecoOpenOrder(\'' + id + '\',\'' + k + '\')">Open</button>' :
          '<span style="font-size:9.5px;color:#a35b00">' + (o.none ? 'not available on the court site' : (e.src ? 'will download at the next fetch' : 'will download at the next CAPTCHA')) + '</span>';
        return '<div class="ecoord"><b>' + (o.d ? fd(o.d) : '(no date)') + '</b> ' + he(o.t || 'Order') + (o.no ? ' <span style="color:#888">No. ' + he(o.no) + '</span>' : '') + ' ' + btn + '</div>';
      }).join('') + '</div>';
  } else h += ' &middot; <span style="color:#888">no orders uploaded yet</span>';

  var hh = e.hh || [], hx = '';
  if (hh.length) {
    h += ' &middot; <a href="#" onclick="event.stopPropagation();togEl(\'eoh_' + id + '\');return false">Court history (' + hh.length + ')</a>';
    hx = '<div id="eoh_' + id + '" style="display:none;margin-top:5px;border-top:1px solid #eee;padding-top:5px;max-height:280px;overflow:auto">' +
      hh.slice().reverse().map(function (x) {
        return '<div class="hiitem"><b>' + fd(x.bd || x.d) + '</b>' + (x.p ? ' &mdash; ' + he(x.p) : '') + (x.d && x.d !== x.bd ? ' &rarr; next ' + fd(x.d) : '') +
          (x.biz ? '<div style="color:#333;margin-top:2px">' + he(x.biz) + '</div>' : '') + (x.j ? '<div class="nby">' + he(x.j) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }
  var srcName = { sci: 'Supreme Court site', cat: 'CAT site', mat: 'MAT Nagpur site' }[e.src] || 'Official eCourts';
  return '<div style="font-size:10px;margin-top:3px;font-weight:400">' + srcName + ' ' + (typeof cs2Fmt === 'function' ? cs2Fmt(e.at) : '') + ': ' + h + ox + hx + '</div>';
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

/* ---------------- shared with orders.js / courts.js ---------------- */
function orderBlob(c, key) {
  var o = c && c.eco && c.eco.ord && c.eco.ord[key];
  if (!o || !o.fid) return Promise.reject(new Error('This order has not been downloaded yet.'));
  return pdfGet(o.fid).then(function (blob) {
    if (blob) return blob;
    return dirReady(false).then(function (h) { return h && o.fo && o.nm ? localRead(h, o.fo, o.nm) : null; }).then(function (file) {
      if (file) { pdfPut(o.fid, file); return file; }
      return post({ action: 'pdf', fid: o.fid }).then(function (r) {
        var b = b64Blob(r.b64); o.fo = o.fo || r.folder; o.nm = o.nm || r.name; pdfPut(o.fid, b); return b;
      });
    });
  });
}
ECO.api = { fkey: fkey, later: later, saveNow: saveNow, post: post, pdfGet: pdfGet, pdfPut: pdfPut, b64Blob: b64Blob, dirReady: dirReady, localWrite: localWrite, orderBlob: orderBlob, cfg: cfg, cleanCnr: cleanCnr, queueCase: queueCase, apply: apply };

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
