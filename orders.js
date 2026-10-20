/* ==================================================================
   CHARPE SUITE — ORDERS & ORDER SHEETS                       Oct 2026
   ------------------------------------------------------------------
   One button on every case: "Orders & order sheets".
     Orders       — the order / judgment PDFs fetched from the court
                    (or added by hand for courts that cannot be fetched)
     Order sheets — the proceedings of each hearing date
                    ("business on date" on eCourts), one per date
   For each list: open one, tick several, download them separately or
   as ONE consolidated PDF in date order, print, send to Excerpt Desk.
   Single order sheets print on the next sticker of the sticker sheet;
   "print all" always prints full A4 pages.
   ================================================================== */
(function () {
'use strict';

var PDFLIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
var libP = null;
function lib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (libP) return libP;
  libP = new Promise(function (res, rej) {
    var s = document.createElement('script'); s.src = PDFLIB;
    s.onload = function () { res(window.PDFLib); };
    s.onerror = function () { libP = null; rej(new Error('The PDF maker could not load. Check the internet connection once; afterwards it works offline.')); };
    document.head.appendChild(s);
  });
  return libP;
}
var A = function () { return (window.ECO && ECO.api) || {}; };

/* ---------------- what a case holds ---------------- */
function orders(c) {
  var o = (c.eco && c.eco.ord) || {};
  return Object.keys(o).map(function (k) { var x = o[k]; return { key: k, d: x.d || '', t: x.t || 'Order', no: x.no || '', ok: !!x.fid, none: x.none, man: !!x.man }; })
    .sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); });
}
function sheets(c) {
  var seen = {}, out = [];
  ((c.eco && c.eco.hh) || []).forEach(function (h) {
    var d = h.bd || h.d; if (!d || d > td()) return;
    var k = d + '|' + (h.biz || '');
    if (seen[k]) return; seen[k] = 1;
    out.push({ key: d + '_' + out.length, d: d, biz: h.biz || '', p: h.p || '', j: h.j || '', next: h.d && h.d !== d ? h.d : '' });
  });
  /* hearings recorded by hand in the case history, with no court entry */
  (c.hist || []).forEach(function (h) {
    var d = h.pd; if (!d || out.some(function (x) { return x.d === d; })) return;
    out.push({ key: 'h' + d, d: d, biz: h.note || (h.ps ? 'Stage: ' + h.ps : ''), p: h.ns || '', j: '', next: h.nd || '', mine: true });
  });
  return out.sort(function (a, b) { return a.d.localeCompare(b.d); });
}
window.ordCounts = function (c) { return { o: orders(c).length, s: sheets(c).length }; };

/* ---------------- making PDFs ---------------- */
function wrap(font, text, size, width) {
  var lines = [];
  String(text || '').split(/\n/).forEach(function (para) {
    var words = para.split(/\s+/), line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { lines.push(line); line = w; } else line = t;
    });
    lines.push(line);
  });
  return lines;
}
function safe(s) { return String(s || '').replace(/[^\x20-\x7E -ÿ]/g, ' '); }
/* order sheets as A4 pages of text — one block per date, flowing on */
function sheetsPdf(c, list) {
  return lib().then(function (L) {
    return L.PDFDocument.create().then(function (doc) {
      return Promise.all([doc.embedFont(L.StandardFonts.TimesRoman), doc.embedFont(L.StandardFonts.TimesRomanBold)]).then(function (f) {
        var R = f[0], B = f[1], W = 595.28, H = 841.89, M = 56, pg = null, y = 0;
        function page() { pg = doc.addPage([W, H]); y = H - M; }
        function line(t, font, size, gap) { if (y - size < M) page(); pg.drawText(safe(t), { x: M, y: y - size, size: size, font: font }); y -= size + (gap || 3); }
        page();
        line(ctit(c), B, 13, 2);
        line((c.court || '') + (c.cn ? '  ·  ' + c.cn : '') + (c.cnr ? '  ·  CNR ' + c.cnr : ''), R, 10.5, 12);
        list.forEach(function (s) {
          if (y - 60 < M) page();
          line('Date: ' + fd(s.d) + (s.j ? '     ' + s.j : ''), B, 11.5, 4);
          wrap(R, s.biz || (s.p ? 'Purpose: ' + s.p : '(no proceedings text on record)'), 11, W - 2 * M).forEach(function (l) { line(l, R, 11, 2.5); });
          if (s.next) line('Next date: ' + fd(s.next) + (s.p && s.biz ? ' — ' + s.p : ''), R, 10.5, 2);
          y -= 10;
          if (y > M) pg.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: .4, color: L.rgb(.6, .6, .6) });
        });
        return doc.save();
      });
    });
  }).then(function (bytes) { return new Blob([bytes], { type: 'application/pdf' }); });
}
/* many order PDFs into one, oldest first */
function mergeOrders(c, keys) {
  return lib().then(function (L) {
    return L.PDFDocument.create().then(function (out) {
      var p = Promise.resolve(), miss = [];
      keys.forEach(function (k) {
        p = p.then(function () { return A().orderBlob(c, k); })
          .then(function (b) { return b.arrayBuffer(); })
          .then(function (buf) { return L.PDFDocument.load(buf, { ignoreEncryption: true }); })
          .then(function (src) { return out.copyPages(src, src.getPageIndices()).then(function (pp) { pp.forEach(function (x) { out.addPage(x); }); }); })
          .catch(function () { miss.push(k); });
      });
      return p.then(function () {
        if (!out.getPageCount()) throw new Error('None of these orders could be opened.');
        return out.save().then(function (b) { return { blob: new Blob([b], { type: 'application/pdf' }), miss: miss }; });
      });
    });
  });
}
function fname(c, what) { return (String(c.cn || ctit(c)).replace(/[\\\/:*?"<>|#%]+/g, '-').slice(0, 60) + ' - ' + what).replace(/\s+/g, ' ').trim() + '.pdf'; }
function save(blob, name) { dl(blob, name); }
function openPdf(blob, title, printIt) {
  var u = URL.createObjectURL(blob);
  cs2Viewer(he(title), '<iframe data-url="' + u + '" src="' + u + '" style="width:100%;height:100%;border:0"></iframe>');
  var acts = document.getElementById('cs2vacts');
  if (acts) acts.innerHTML = '<a class="btn bg" style="font-size:11px" href="' + u + '" download="' + he(title.replace(/[\\\/:*?"<>|]+/g, '-')) + '.pdf">&#8595; Download</a> ' +
    '<button class="btn bo" style="font-size:11px" onclick="ordPrintFrame()">&#128424; Print</button>';
  if (printIt) setTimeout(ordPrintFrame, 900);
}
window.ordPrintFrame = function () {
  var f = document.querySelector('#cs2view iframe');
  try { f.contentWindow.focus(); f.contentWindow.print(); }
  catch (e) { window.open(f.src, '_blank'); toast('Print from the PDF that opened. For orders choose "Print on both sides" in the print box.'); }
};

/* ---------------- the panel ---------------- */
var P = { id: null, tab: 'o', pick: {} };
function css() {
  if (document.getElementById('ordcss')) return;
  var st = document.createElement('style'); st.id = 'ordcss';
  st.textContent =
    '#ordp{position:fixed;inset:0;background:rgba(10,18,32,.55);z-index:9980;display:flex;align-items:flex-start;justify-content:center;padding:18px 10px;overflow:auto}' +
    '#ordp .op{background:#fff;border-radius:9px;width:min(980px,100%);box-shadow:0 12px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;max-height:calc(100vh - 36px)}' +
    '#ordp .oh{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1b2a4a;color:#fff;border-radius:9px 9px 0 0}#ordp .oh b{flex:1;font-size:13px}' +
    '#ordp .ot{display:flex;gap:4px;padding:8px 14px 0;border-bottom:2px solid #d4c9a8}' +
    '#ordp .ot button{border:0;background:none;padding:7px 12px;font:600 12px inherit;font-family:inherit;color:#666;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}' +
    '#ordp .ot button.on{color:#b8932a;border-bottom-color:#b8932a}' +
    '#ordp .ob{padding:10px 14px;overflow:auto;flex:1}#ordp .of{padding:10px 14px;border-top:1px solid #e3e6ea;display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
    '#ordp .orow{display:flex;gap:8px;align-items:flex-start;padding:7px 4px;border-bottom:1px solid #eef0f2;font-size:12px}' +
    '#ordp .orow .d{font-weight:700;min-width:82px}#ordp .orow .tx{flex:1;line-height:1.45}#ordp .orow .tx small{color:#777}' +
    '#ordp .orow .bt{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}#ordp .orow .btn{font-size:10px;padding:3px 8px}' +
    '#ordp .grp{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888;margin:8px 0 2px}';
  document.head.appendChild(st);
}
window.ordOpen = function (id, tab) {
  var c = find(id); if (!c) return;
  css(); P.id = id; P.tab = tab || P.tab || 'o'; P.pick = {};
  var o = document.getElementById('ordp'); if (o) o.remove();
  o = document.createElement('div'); o.id = 'ordp';
  o.innerHTML = '<div class="op"><div class="oh"><b>' + he(ctit(c)) + '<br><span style="font-weight:400;font-size:11px;opacity:.8">' + he(c.court || '') + (c.cn ? ' &middot; ' + he(c.cn) : '') + '</span></b>' +
    '<button class="btn bo" style="font-size:11px" onclick="document.getElementById(\'ordp\').remove()">&#10005; Close</button></div>' +
    '<div class="ot"><button data-t="o">Orders</button><button data-t="s">Order sheets</button></div>' +
    '<div class="ob" id="ordb"></div><div class="of" id="ordf"></div></div>';
  document.body.appendChild(o);
  o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
  o.querySelectorAll('.ot button').forEach(function (b) { b.onclick = function () { P.tab = b.dataset.t; P.pick = {}; paint(); }; });
  paint();
};
function paint() {
  var c = find(P.id); if (!c) return;
  document.querySelectorAll('#ordp .ot button').forEach(function (b) {
    var n = window.ordCounts(c); b.classList.toggle('on', b.dataset.t === P.tab);
    b.textContent = (b.dataset.t === 'o' ? 'Orders (' + n.o + ')' : 'Order sheets (' + n.s + ')');
  });
  var body = document.getElementById('ordb'), foot = document.getElementById('ordf'), h = '';
  if (P.tab === 'o') {
    var L = orders(c);
    h = L.length ? L.map(function (x) {
      return '<div class="orow"><input type="checkbox" ' + (x.ok ? '' : 'disabled ') + (P.pick[x.key] ? 'checked ' : '') + 'onchange="ordPick(\'' + x.key + '\',this.checked)">' +
        '<span class="d">' + (x.d ? fd(x.d) : '(no date)') + '</span><span class="tx">' + he(x.t) + (x.no ? ' <small>No. ' + he(x.no) + '</small>' : '') + (x.man ? ' <small>(added by hand)</small>' : '') +
        (x.ok ? '' : '<br><small style="color:#a35b00">' + (x.none ? 'not available on the court site' : 'will download at the next CAPTCHA fetch') + '</small>') + '</span>' +
        (x.ok ? '<span class="bt"><button class="btn bg" onclick="ordOne(\'' + x.key + '\',\'open\')">Open</button>' +
          '<button class="btn bo" onclick="ordOne(\'' + x.key + '\',\'dl\')">Download</button><button class="btn bo" onclick="ordOne(\'' + x.key + '\',\'print\')">Print</button></span>' : '') + '</div>';
    }).join('') : '<div style="color:#888;font-size:12px;padding:18px 4px">No orders yet. Fetch the case with its CAPTCHA (Update status / Sync Centre), or add an order PDF by hand below.</div>';
    foot.innerHTML = selBtns(L.filter(function (x) { return x.ok; }).length) +
      '<span style="flex-basis:100%;height:0"></span>' +
      '<button class="btn bo" onclick="ordMany(\'o\',\'sep\')">&#8595; Selected &mdash; separate PDFs</button>' +
      '<button class="btn bo" onclick="ordMany(\'o\',\'one\')">&#8595; Selected &mdash; one PDF</button>' +
      '<button class="btn bo" onclick="ordMany(\'o\',\'print\')">&#128424; Print selected</button>' +
      '<button class="btn bbl" onclick="ordAll(\'o\',\'sep\')">&#8595; All &mdash; separate PDFs</button>' +
      '<button class="btn bbl" onclick="ordAll(\'o\',\'one\')">&#8595; All &mdash; one PDF (date order)</button>' +
      '<button class="btn bn" onclick="ordAll(\'o\',\'print\')">&#128424; Print all (one file)</button>' +
      '<span style="flex-basis:100%;height:0"></span>' +
      '<button class="btn bor" onclick="ordToX(\'o\')">&#10148; Orders to Excerpt Desk</button>' +
      '<button class="btn bor" onclick="ordToX(\'both\')">&#10148; Orders + order sheets to Excerpt Desk</button>' +
      '<label class="btn bo" style="cursor:pointer">+ Add an order PDF by hand<input type="file" accept="application/pdf" multiple hidden onchange="ordUpload(this)"></label>';
  } else {
    var S2 = sheets(c);
    h = S2.length ? S2.map(function (x) {
      return '<div class="orow"><input type="checkbox" ' + (P.pick[x.key] ? 'checked ' : '') + 'onchange="ordPick(\'' + x.key + '\',this.checked)">' +
        '<span class="d">' + fd(x.d) + '</span><span class="tx">' + (x.biz ? he(x.biz) : '<small>' + (x.p ? 'Purpose: ' + he(x.p) : 'no proceedings text on record') + '</small>') +
        (x.next ? '<br><small>Next date ' + fd(x.next) + (x.p && x.biz ? ' &mdash; ' + he(x.p) : '') + '</small>' : '') + (x.mine ? ' <small>(from your own entries)</small>' : '') + '</span>' +
        '<span class="bt"><button class="btn bg" onclick="ordSheet(\'' + x.key + '\',\'sticker\')" title="Print on the next sticker of the sticker sheet">&#9635; Sticker</button>' +
        '<button class="btn bo" onclick="ordSheet(\'' + x.key + '\',\'open\')">Open</button><button class="btn bo" onclick="ordSheet(\'' + x.key + '\',\'dl\')">Download</button></span></div>';
    }).join('') : '<div style="color:#888;font-size:12px;padding:18px 4px">No order sheets yet. They arrive with the CAPTCHA fetch (the court\'s "business on date" for each hearing).</div>';
    foot.innerHTML = selBtns(S2.length) +
      '<span style="flex-basis:100%;height:0"></span>' +
      '<button class="btn bg" onclick="ordMany(\'s\',\'sticker\')">&#9635; Selected on stickers (one each)</button>' +
      '<button class="btn bo" onclick="ordMany(\'s\',\'sep\')">&#8595; Selected &mdash; separate PDFs</button>' +
      '<button class="btn bo" onclick="ordMany(\'s\',\'one\')">&#8595; Selected &mdash; one PDF</button>' +
      '<button class="btn bbl" onclick="ordAll(\'s\',\'sep\')">&#8595; All &mdash; separate PDFs</button>' +
      '<button class="btn bbl" onclick="ordAll(\'s\',\'one\')">&#8595; All &mdash; one PDF</button>' +
      '<button class="btn bn" onclick="ordAll(\'s\',\'print\')">&#128424; Print all (full A4 pages)</button>' +
      '<button class="btn bo" onclick="CharpeStickers.settings()">Sticker sheet settings</button>' +
      '<span style="flex-basis:100%;height:0"></span>' +
      '<button class="btn bor" onclick="ordToX(\'s\')">&#10148; Order sheets to Excerpt Desk</button>' +
      '<button class="btn bor" onclick="ordToX(\'both\')">&#10148; Orders + order sheets to Excerpt Desk</button>';
  }
  body.innerHTML = h;
}
function selBtns(n) {
  var k = Object.keys(P.pick).filter(function (x) { return P.pick[x]; }).length;
  return '<button class="btn bo" onclick="ordSelAll(1)">Tick all</button><button class="btn bo" onclick="ordSelAll(0)">Untick all</button>' +
    '<span style="font-size:11px;color:#555;margin-left:6px">' + k + ' of ' + n + ' ticked</span>';
}
window.ordPick = function (k, on) { if (on) P.pick[k] = 1; else delete P.pick[k]; paint(); };
window.ordSelAll = function (on) {
  var c = find(P.id); P.pick = {};
  if (on) (P.tab === 'o' ? orders(c).filter(function (x) { return x.ok; }) : sheets(c)).forEach(function (x) { P.pick[x.key] = 1; });
  paint();
};
function picked(tab, all) {
  var c = find(P.id);
  var list = tab === 'o' ? orders(c).filter(function (x) { return x.ok; }) : sheets(c);
  return all ? list : list.filter(function (x) { return P.pick[x.key]; });
}
function wait(msg) { toast(msg); }

window.ordOne = function (key, how) {
  var c = find(P.id), o = orders(c).filter(function (x) { return x.key === key; })[0]; if (!o) return;
  var title = ctit(c) + ' - ' + (o.d ? fd(o.d) : '') + ' ' + o.t;
  wait('Opening the order…');
  A().orderBlob(c, key).then(function (b) {
    if (how === 'dl') save(b, fname(c, (o.d || 'undated') + ' ' + o.t + (o.no ? ' No ' + o.no : '')));
    else openPdf(b, title, how === 'print');
  }).catch(function (e) { toast(e.message || String(e), 'err'); });
};
window.ordSheet = function (key, how) {
  var c = find(P.id), s = sheets(c).filter(function (x) { return x.key === key; })[0]; if (!s) return;
  if (how === 'sticker') { CharpeStickers.print([stickerItem(c, s)], { title: 'Order sheet ' + fd(s.d) }); return; }
  sheetsPdf(c, [s]).then(function (b) {
    if (how === 'dl') save(b, fname(c, 'Order sheet ' + s.d)); else openPdf(b, ctit(c) + ' - order sheet ' + fd(s.d));
  }).catch(function (e) { toast(e.message, 'err'); });
};
function stickerItem(c, s) {
  var E = CharpeStickers.esc;
  var head = '<b>' + E((c.cn || '') + (c.cn && c.court ? ' — ' : '') + (c.court || '')) + '</b><br><b>Dt. ' + fd(s.d) + '</b>' + (s.j ? ' <span style="font-size:.85em">' + E(s.j) + '</span>' : '') + '<br>';
  var text = s.biz || (s.p ? 'Purpose: ' + s.p : '');
  var tail = s.next ? '<div><b>Next: ' + fd(s.next) + '</b>' + (s.p && s.biz ? ' — ' + E(s.p) : '') + '</div>' : '';
  return { html: head + '<div>' + E(text).replace(/\n/g, '<br>') + '</div>' + tail, head: head, text: text, tail: tail };
}
window.ordStickerItem = stickerItem;

function seq(arr, fn) { var p = Promise.resolve(); arr.forEach(function (x, i) { p = p.then(function () { return fn(x, i); }).then(function () { return new Promise(function (r) { setTimeout(r, 350); }); }); }); return p; }
function many(tab, how, list) {
  var c = find(P.id);
  if (!list.length) { toast(P.tab === tab ? 'Tick at least one first.' : 'Nothing to do.', 'err'); return; }
  if (tab === 's') {
    if (how === 'sticker') { CharpeStickers.print(list.map(function (s) { return stickerItem(c, s); }), { title: list.length + ' order sheet' + (list.length === 1 ? '' : 's') }); return; }
    if (how === 'sep') { wait('Downloading ' + list.length + ' order sheet' + (list.length === 1 ? '' : 's') + '…'); seq(list, function (s) { return sheetsPdf(c, [s]).then(function (b) { save(b, fname(c, 'Order sheet ' + s.d)); }); }); return; }
    wait('Making one PDF…');
    sheetsPdf(c, list).then(function (b) {
      if (how === 'one') save(b, fname(c, 'Order sheets ' + list[0].d + ' to ' + list[list.length - 1].d));
      else openPdf(b, ctit(c) + ' - order sheets', true);
    }).catch(function (e) { toast(e.message, 'err'); });
    return;
  }
  if (how === 'sep') {
    wait('Downloading ' + list.length + ' order' + (list.length === 1 ? '' : 's') + '… (allow multiple downloads if the browser asks)');
    seq(list, function (o) { return A().orderBlob(c, o.key).then(function (b) { save(b, fname(c, (o.d || 'undated') + ' ' + o.t + (o.no ? ' No ' + o.no : ''))); }).catch(function () {}); });
    return;
  }
  wait('Joining ' + list.length + ' order' + (list.length === 1 ? '' : 's') + ' in date order…');
  mergeOrders(c, list.map(function (o) { return o.key; })).then(function (r) {
    if (r.miss.length) toast(r.miss.length + ' order(s) could not be opened and were left out.', 'err');
    if (how === 'one') save(r.blob, fname(c, 'Orders ' + (list[0].d || '') + ' to ' + (list[list.length - 1].d || '')));
    else openPdf(r.blob, ctit(c) + ' - orders', true);
  }).catch(function (e) { toast(e.message, 'err'); });
}
window.ordMany = function (tab, how) { many(tab, how, picked(tab, false)); };
window.ordAll = function (tab, how) { many(tab, how, picked(tab, true)); };

/* orders added by hand (Supreme Court, CAT, MAT, certified copies…) */
window.ordUpload = function (inp) {
  var c = find(P.id), files = Array.prototype.slice.call(inp.files || []); inp.value = '';
  if (!c || !files.length) return;
  var d = prompt('Date of the order (DD/MM/YYYY)', fd(td()));
  if (d === null) return;
  var m = String(d).match(/(\d{1,2})\D(\d{1,2})\D(\d{4})/), iso = m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : td();
  var t = prompt('What is it? (e.g. Order, Judgment, Interim order)', 'Order') || 'Order';
  c.eco = c.eco || {}; c.eco.ord = c.eco.ord || {};
  var p = Promise.resolve();
  files.forEach(function (f) {
    p = p.then(function () {
      var key = 'm' + uid(), local = 'local:' + key;
      return A().pdfPut(local, f).then(function () {
        c.eco.ord[key] = { d: iso, t: t, no: '', fid: local, nm: f.name, man: true };
        touch(c); saveAll(); paint();
        /* a copy goes to Drive (eCourts Orders/<case>) so every computer can open it */
        var r = new FileReader();
        return new Promise(function (res) {
          r.onload = function () {
            A().post({ action: 'upload', cnr: A().cleanCnr(c.cnr) || ('CASE' + c.id), label: ctit(c).slice(0, 70), name: (iso + ' ' + t + ' ' + f.name).slice(0, 120), b64: String(r.result).split(',')[1] })
              .then(function (x) { var o = c.eco.ord[key]; A().pdfPut(x.fid, f); o.fid = x.fid; o.nm = x.name; o.fo = x.folder; touch(c); saveAll(); })
              .catch(function (e) { toast('Kept on this computer only (Drive copy failed: ' + e.message + ')', 'err'); })
              .then(res);
          };
          r.readAsDataURL(f);
        });
      });
    });
  });
  p.then(function () { toast(files.length + ' order PDF' + (files.length === 1 ? '' : 's') + ' added.'); paint(); });
};

/* ---------------- Excerpt Desk hand-over ----------------
   Both apps live on sanketcharpe.github.io, so they share this browser's
   storage. The PDFs are placed in a small "inbox"; Excerpt Desk opens,
   asks which matter (or a new one) and adds them there. */
function inbox() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('charpe-xdesk-inbox', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('items', { keyPath: 'id' }); };
    r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
  });
}
window.ordToX = function (what) {
  var c = find(P.id); if (!c) return;
  var useO = what === 'o' || what === 'both', useS = what === 's' || what === 'both';
  var tickedO = P.tab === 'o' ? picked('o', false) : [], tickedS = P.tab === 's' ? picked('s', false) : [];
  var oList = useO ? (tickedO.length ? tickedO : picked('o', true)) : [];
  var sList = useS ? (tickedS.length ? tickedS : picked('s', true)) : [];
  if (!oList.length && !sList.length) { toast('Nothing to send yet.', 'err'); return; }
  var win = window.open('about:blank', 'excerptdesk');   /* opened inside the click so it is not blocked */
  toast('Preparing ' + (oList.length ? oList.length + ' order' + (oList.length === 1 ? '' : 's') : '') + (oList.length && sList.length ? ' and ' : '') + (sList.length ? 'the order sheets' : '') + ' for Excerpt Desk…');
  var files = [], failed = 0;
  var p = Promise.resolve();
  oList.forEach(function (o) {
    p = p.then(function () { return A().orderBlob(c, o.key); }).then(function (b) { files.push({ name: ((o.d || 'undated') + ' ' + o.t + (o.no ? ' No ' + o.no : '')).replace(/[\\\/:*?"<>|]+/g, '-') + '.pdf', blob: b }); }).catch(function () { failed++; });
  });
  if (sList.length) p = p.then(function () { return sheetsPdf(c, sList); }).then(function (b) { files.push({ name: 'Order sheets ' + fd(sList[0].d).replace(/\//g, '-') + ' to ' + fd(sList[sList.length - 1].d).replace(/\//g, '-') + '.pdf', blob: b }); });
  p.then(function () {
    if (!files.length) throw new Error('None of the PDFs could be opened.');
    var item = { id: 'x' + Date.now().toString(36), at: new Date().toISOString(), title: ctit(c), cn: c.cn || '', court: c.court || '', cnr: c.cnr || '', client: c.cl || '', files: files };
    return inbox().then(function (db) {
      return new Promise(function (res, rej) { var t = db.transaction('items', 'readwrite'); t.objectStore('items').put(item); t.oncomplete = function () { res(item); }; t.onerror = function () { rej(t.error); }; });
    });
  }).then(function (item) {
    var url = location.origin + '/excerpt-desk/?inbox=' + item.id;
    if (win && !win.closed) win.location.href = url; else window.open(url, 'excerptdesk');
    toast(item.files.length + ' PDF' + (item.files.length === 1 ? '' : 's') + ' handed to Excerpt Desk — choose the matter there.' + (failed ? ' ' + failed + ' order(s) could not be opened (not downloaded yet, or offline) and were left out.' : ''), failed ? 'err' : undefined);
  }).catch(function (e) { if (win) try { win.close(); } catch (x) {} toast(e.message || String(e), 'err'); });
};

/* ---------------- the button on every case ---------------- */
var _bld = window.bldRow;
window.bldRow = bldRow = function (c) {
  var h = _bld.apply(this, arguments), n = window.ordCounts(c);
  var b = '<button class="btn bbl" onclick="event.stopPropagation();ordOpen(\'' + c.id + '\',\'o\')" title="Open, download, print or send the orders and order sheets">&#128462; Orders (' + n.o + ') &amp; order sheets (' + n.s + ')</button>';
  return h.replace('<div class="arow">', '<div class="arow">' + b);
};
})();
