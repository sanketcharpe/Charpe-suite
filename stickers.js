/* ==================================================================
   CHARPE SUITE — STICKER SHEETS                              Oct 2026
   ------------------------------------------------------------------
   Used by both the case tool and Billing (same storage on a device).

   Settings (per computer, because the sheet sits in that printer):
     sheet height (length) and width (breadth) in mm, columns, rows,
     sticker height and width, top and left margin, gap between
     columns and between rows, inner padding — all in mm.

   Sequence: one counter shared by order sheets and address stickers.
   It runs DOWN column 1 (row 1, 2, 3 …), then column 2 from row 1, and
   so on. After the last sticker it asks for a new sheet and starts
   again at column 1, row 1.

   CharpeStickers.print(items, {title})   items = [{html:'…'}] — each
       item is fitted (shrunk) into one sticker; if it cannot fit at a
       readable size it continues on the next sticker.
   CharpeStickers.settings()              opens the settings box.
   ================================================================== */
(function () {
'use strict';
if (window.CharpeStickers) return;

var CFG = 'cs_sticker_cfg', POS = 'cs_sticker_pos', HIST = 'cs_sticker_hist';
var DEF = { sh: 297, sw: 210, cols: 2, rows: 8, h: 33.9, w: 99.1, top: 12.9, left: 4.65, gx: 2.5, gy: 0, pad: 2, min: 6, max: 11, font: 'Georgia' };

function rd(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function cfg() { var c = Object.assign({}, DEF, rd(CFG, {})); c.cols = Math.max(1, +c.cols || 1); c.rows = Math.max(1, +c.rows || 1); return c; }
function total() { var c = cfg(); return c.cols * c.rows; }
function pos() { var p = +rd(POS, 0) || 0; return p >= total() ? 0 : p; }
function setPos(p) { wr(POS, ((p % total()) + total()) % total()); }
function slot(i) { var c = cfg(); return { col: Math.floor(i / c.rows), row: i % c.rows }; }
function label(i) { var s = slot(i); return 'Column ' + (s.col + 1) + ', Row ' + (s.row + 1); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fits(c) {
  var needW = c.left + c.cols * c.w + (c.cols - 1) * c.gx, needH = c.top + c.rows * c.h + (c.rows - 1) * c.gy;
  return { ok: needW <= c.sw + 0.5 && needH <= c.sh + 0.5, needW: needW, needH: needH };
}
function toast(m, k) {
  if (typeof window.toast === 'function') return window.toast(m, k);
  if (window.CBapp && window.CBapp.toast) return window.CBapp.toast(m);
  try { var h = window.parent && window.parent.charpeToast; if (h) return h(m, k); } catch (e) {}
  alert(m);
}

/* ---------------- shared styles for the boxes ---------------- */
function css() {
  if (document.getElementById('stkcss')) return;
  var st = document.createElement('style'); st.id = 'stkcss';
  st.textContent =
    '.stk-ov{position:fixed;inset:0;background:rgba(10,18,32,.55);z-index:99990;display:flex;align-items:flex-start;justify-content:center;padding:18px 10px;overflow:auto;font:13px/1.45 "Segoe UI",Roboto,Arial,sans-serif;color:#1a2744}' +
    '.stk-p{background:#fff;border-radius:9px;width:min(760px,100%);box-shadow:0 12px 40px rgba(0,0,0,.3)}' +
    '.stk-h{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#1a2744;color:#fff;border-radius:9px 9px 0 0}.stk-h b{flex:1;font-size:13.5px}' +
    '.stk-b{padding:14px}.stk-f{padding:10px 14px;border-top:1px solid #e3e6ea;display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.stk-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 12px}' +
    '.stk-g label{display:block;font-size:10.5px;font-weight:700;color:#5b6474;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px}' +
    '.stk-g input,.stk-g select{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #c9ced6;border-radius:5px;font:inherit}' +
    '.stk-btn{border:1px solid #c9ced6;background:#fff;border-radius:6px;padding:8px 14px;font:600 12.5px inherit;font-family:inherit;cursor:pointer;color:#1a2744}' +
    '.stk-btn.pri{background:#b8932a;border-color:#b8932a}.stk-btn.dk{background:#1a2744;border-color:#1a2744;color:#fff}' +
    '.stk-map{display:inline-grid;gap:3px;padding:6px;background:#f3f1ea;border:1px solid #e0d6b8;border-radius:6px}' +
    '.stk-map i{display:block;border:1px solid #b9bfc9;border-radius:2px;background:#fff;font:600 9px/1 Arial;color:#888;display:flex;align-items:center;justify-content:center;cursor:pointer}' +
    '.stk-map i.used{background:#d9dde3;color:#aaa}.stk-map i.next{background:#b8932a;color:#1a2744;border-color:#8a6d1c}.stk-map i.take{background:#1a2744;color:#fff}' +
    '.stk-note{font-size:11.5px;color:#5b6474;line-height:1.5}';
  document.head.appendChild(st);
}
function box(title, body, foot) {
  css();
  var o = document.createElement('div'); o.className = 'stk-ov';
  o.innerHTML = '<div class="stk-p"><div class="stk-h"><b>' + title + '</b><button class="stk-btn" data-x>&#10005; Close</button></div>' +
    '<div class="stk-b">' + body + '</div><div class="stk-f">' + (foot || '') + '</div></div>';
  document.body.appendChild(o);
  o.querySelector('[data-x]').onclick = function () { o.remove(); };
  o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
  return o;
}

/* small picture of the sheet: used stickers grey, the next one gold */
function mapHTML(from, take) {
  var c = cfg(), cell = Math.max(10, Math.min(34, Math.floor(220 / Math.max(c.rows, c.cols * 1.6))));
  var h = '<div class="stk-map" style="grid-template-columns:repeat(' + c.cols + ',' + Math.round(cell * c.w / c.h * 0.9) + 'px);grid-auto-rows:' + cell + 'px;grid-auto-flow:column;grid-template-rows:repeat(' + c.rows + ',' + cell + 'px)">';
  for (var i = 0; i < total(); i++) {
    var cls = i < from ? 'used' : (i < from + (take || 1) ? (i === from ? 'next' : 'take') : '');
    h += '<i class="' + cls + '" data-i="' + i + '" title="' + label(i) + '">' + (i + 1) + '</i>';
  }
  return h + '</div>';
}

/* ---------------- settings ---------------- */
function settings() {
  var c = cfg();
  var f = function (k, lbl, step) { return '<div><label>' + lbl + '</label><input type="number" step="' + (step || '0.1') + '" min="0" data-k="' + k + '" value="' + esc(c[k]) + '"></div>'; };
  var o = box('Sticker sheet', '<div class="stk-note" style="margin-bottom:10px">Measure one sheet with a ruler (in millimetres). <b>Height</b> is the length of the sheet from top to bottom; <b>width</b> is its breadth. These settings stay on this computer.</div>' +
    '<div class="stk-g">' + f('sh', 'Sheet height (length)') + f('sw', 'Sheet width (breadth)') +
      '<div><label>Columns</label><select data-k="cols">' + [1, 2, 3, 4].map(function (n) { return '<option' + (+c.cols === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
      f('rows', 'Rows (top to bottom)', '1') + f('h', 'Sticker height') + f('w', 'Sticker width') + f('top', 'Top margin') + f('left', 'Left margin') +
      f('gx', 'Gap between columns') + f('gy', 'Gap between rows') + f('pad', 'Blank border inside each sticker') +
      f('max', 'Largest letter size (pt)', '0.5') + f('min', 'Smallest letter size (pt)', '0.5') +
      '<div><label>Font</label><select data-k="font">' + ['Georgia', 'Times New Roman', 'Cambria', 'Arial', 'Calibri', 'Segoe UI', 'Verdana'].map(function (n) { return '<option' + (c.font === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
    '</div><div id="stkChk" class="stk-note" style="margin-top:10px"></div>' +
    '<div style="margin-top:12px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div><div class="stk-note" style="margin-bottom:4px"><b>Where the next print goes</b> &mdash; click a sticker to change it</div><div id="stkMap"></div></div>' +
    '<div class="stk-note" id="stkPos" style="flex:1;min-width:200px"></div></div>',
    '<button class="stk-btn pri" data-save>Save</button><button class="stk-btn" data-test>Test print (outlines on plain paper)</button>' +
    '<button class="stk-btn" data-reset>New sheet &mdash; start at Column 1, Row 1</button>');
  function read() { var n = cfg(); o.querySelectorAll('[data-k]').forEach(function (i) { n[i.dataset.k] = i.tagName === 'SELECT' && i.dataset.k === 'font' ? i.value : +i.value; }); return n; }
  function paint() {
    var n = read(), r = fits(n);
    o.querySelector('#stkChk').innerHTML = r.ok ? '<span style="color:#127a4b">&#10003; The stickers fit inside the sheet (' + r.needW.toFixed(1) + ' &times; ' + r.needH.toFixed(1) + ' mm used of ' + n.sw + ' &times; ' + n.sh + ').</span>'
      : '<span style="color:#b3261e">&#9888; These figures need ' + r.needW.toFixed(1) + ' &times; ' + r.needH.toFixed(1) + ' mm but the sheet is ' + n.sw + ' &times; ' + n.sh + ' mm. Check the measurements.</span>';
    o.querySelector('#stkMap').innerHTML = mapHTML(pos(), 1);
    o.querySelector('#stkPos').innerHTML = 'Next print: <b>' + label(pos()) + '</b> (sticker ' + (pos() + 1) + ' of ' + total() + ').<br>Prints run down the first column, then the next column from the top.';
    o.querySelectorAll('.stk-map i').forEach(function (i) { i.onclick = function () { setPos(+i.dataset.i); paint(); }; });
  }
  o.querySelectorAll('[data-k]').forEach(function (i) { i.addEventListener('input', paint); i.addEventListener('change', paint); });
  o.querySelector('[data-save]').onclick = function () { var n = read(); if (!fits(n).ok && !confirm('The stickers do not fit inside the sheet as measured. Save anyway?')) return; wr(CFG, n); if (pos() >= total()) setPos(0); paint(); toast('Sticker sheet saved.'); };
  o.querySelector('[data-reset]').onclick = function () { setPos(0); paint(); toast('Next print goes to Column 1, Row 1.'); };
  o.querySelector('[data-test]').onclick = function () { wr(CFG, read()); render([], 0, true); };
  paint();
}

/* ---------------- fitting text into one sticker ---------------- */
function measurer(c) {
  var m = document.getElementById('stkMeasure');
  if (!m) { m = document.createElement('div'); m.id = 'stkMeasure'; document.body.appendChild(m); }
  m.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;box-sizing:border-box;overflow:hidden;' +
    'width:' + (c.w - 2 * c.pad) + 'mm;font-family:' + c.font + ',Georgia,serif;line-height:1.18;word-wrap:break-word;overflow-wrap:break-word';
  return m;
}
function maxH(c) { var t = document.createElement('div'); t.style.cssText = 'position:absolute;visibility:hidden;height:' + (c.h - 2 * c.pad) + 'mm'; document.body.appendChild(t); var h = t.offsetHeight; t.remove(); return h; }
/* returns [{html, pt}] — one entry per sticker */
function layout(items) {
  var c = cfg(), m = measurer(c), H = maxH(c), out = [];
  items.forEach(function (it) {
    var html = it.html, pt;
    for (pt = c.max; pt >= c.min; pt = Math.round((pt - 0.25) * 100) / 100) {
      m.style.fontSize = pt + 'pt'; m.innerHTML = html;
      if (m.scrollHeight <= H + 1) { out.push({ html: html, pt: pt }); return; }
    }
    /* too long even at the smallest size: continue on the next sticker(s) */
    m.style.fontSize = c.min + 'pt';
    var head = it.head || '', words = String(it.text || '').split(/(\s+)/), part = 1, buf = '';
    function flush(last) { out.push({ html: (head ? head : '') + '<div>' + esc(buf).replace(/\n/g, '<br>') + '</div>' + (last ? (it.tail || '') : '<div style="text-align:right;font-style:italic">contd&hellip;</div>'), pt: c.min }); buf = ''; part++; head = it.head ? it.head.replace('</b>', ' (contd.)</b>') : ''; }
    if (!it.text) { out.push({ html: html, pt: c.min, over: true }); return; }
    for (var i = 0; i < words.length; i++) {
      var trial = buf + words[i];
      m.innerHTML = head + '<div>' + esc(trial).replace(/\n/g, '<br>') + '</div><div>contd&hellip;</div>';
      if (m.scrollHeight > H + 1 && buf.trim()) { flush(false); buf = words[i].trimStart ? words[i].trimStart() : words[i]; }
      else buf = trial;
    }
    flush(true);
  });
  return out;
}

/* ---------------- the printout ---------------- */
function render(pieces, from, outlines, title) {
  var c = cfg(), html = '', pages = [], cur = [], p = from;
  if (outlines) { for (var k = 0; k < total(); k++) cur.push({ i: k, html: '<div style="font:9pt Arial;color:#888">' + label(k) + '</div>', pt: 9 }); pages.push(cur); }
  else {
    pieces.forEach(function (x) { if (p >= total()) { pages.push(cur); cur = []; p = 0; } cur.push({ i: p, html: x.html, pt: x.pt }); p++; });
    if (cur.length) pages.push(cur);
  }
  pages.forEach(function (pg, pi) {
    html += '<div class="sheet"' + (pi < pages.length - 1 ? ' style="page-break-after:always"' : '') + '>';
    pg.forEach(function (s) {
      var sl = slot(s.i), x = c.left + sl.col * (c.w + c.gx), y = c.top + sl.row * (c.h + c.gy);
      html += '<div class="stk' + (outlines ? ' ol' : '') + '" style="left:' + x + 'mm;top:' + y + 'mm;font-size:' + s.pt + 'pt">' + s.html + '</div>';
    });
    html += '</div>';
  });
  var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title || 'Stickers') + '</title><style>' +
    '@page{size:' + c.sw + 'mm ' + c.sh + 'mm;margin:0}' +
    'html,body{margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.sheet{position:relative;width:' + c.sw + 'mm;height:' + c.sh + 'mm;overflow:hidden}' +
    '.stk{position:absolute;box-sizing:border-box;width:' + c.w + 'mm;height:' + c.h + 'mm;padding:' + c.pad + 'mm;overflow:hidden;' +
    'font-family:' + c.font + ',Georgia,serif;line-height:1.18;color:#000;word-wrap:break-word;overflow-wrap:break-word}' +
    '.stk.ol{outline:.2mm dashed #888;outline-offset:-.1mm}' +
    '@media screen{body{background:#ddd}.sheet{background:#fff;margin:10px auto;box-shadow:0 2px 8px rgba(0,0,0,.25)}.stk{outline:.2mm dotted #bbb}}' +
    '</style></head><body>' + html + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},250);};<\/scr' + 'ipt></body></html>';
  var w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { toast('Allow pop-ups so the stickers can be printed.', 'err'); return false; }
  w.document.write(doc); w.document.close();
  return true;
}

/* ---------------- print, choosing next sticker or a fresh sheet ---------------- */
function print(items, opts) {
  opts = opts || {};
  if (!rd(CFG, null)) { toast('Set up the sticker sheet first (measurements in mm).'); settings(); return; }
  var pieces = layout(items), from = pos(), n = pieces.length;
  var o = box('Print on stickers' + (opts.title ? ' &mdash; ' + esc(opts.title) : ''),
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start"><div id="stkMap2"></div>' +
    '<div style="flex:1;min-width:220px"><div style="font-size:13px">Needs <b>' + n + ' sticker' + (n === 1 ? '' : 's') + '</b>' +
    (pieces.some(function (x) { return x.pt <= cfg().min; }) ? ' <span style="color:#a35b00">(long text &mdash; printed at the smallest size' + (n > items.length ? ' and continued on the next sticker' : '') + ')</span>' : '') + '.</div>' +
    '<label style="display:flex;gap:7px;align-items:flex-start;margin-top:10px;cursor:pointer"><input type="radio" name="stkw" value="next" checked> <span><b>Next sticker on the sheet in the printer</b><br><span class="stk-note">starts at <b>' + label(from) + '</b></span></span></label>' +
    '<label style="display:flex;gap:7px;align-items:flex-start;margin-top:8px;cursor:pointer"><input type="radio" name="stkw" value="fresh"> <span><b>A separate fresh sheet</b><br><span class="stk-note">starts at Column 1, Row 1; the saved position for the other sheet is not changed</span></span></label>' +
    '<div class="stk-note" style="margin-top:10px">Put the sheet in the printer the same way round every time. In the print box choose <b>Scale: 100% / Actual size</b> (not "Fit to page").</div></div></div>',
    '<button class="stk-btn pri" data-go>&#128424; Print</button><button class="stk-btn" data-set>Sheet settings</button><span class="stk-note" style="margin-left:auto">Click any sticker in the picture to start there instead.</span>');
  var start = from;
  function paint() {
    var fresh = o.querySelector('[name=stkw]:checked').value === 'fresh';
    o.querySelector('#stkMap2').innerHTML = mapHTML(fresh ? 0 : start, n);
    o.querySelectorAll('#stkMap2 i').forEach(function (i) { i.onclick = function () { o.querySelector('[value=next]').checked = true; start = +i.dataset.i; paint(); }; });
  }
  o.querySelectorAll('[name=stkw]').forEach(function (r) { r.onchange = paint; });
  o.querySelector('[data-set]').onclick = function () { o.remove(); settings(); };
  o.querySelector('[data-go]').onclick = function () {
    var fresh = o.querySelector('[name=stkw]:checked').value === 'fresh';
    var at = fresh ? 0 : start;
    if (!render(pieces, at, false, opts.title)) return;
    if (!fresh) {
      var hist = rd(HIST, []); hist.unshift({ at: new Date().toISOString(), from: at, n: n, what: opts.title || '' }); wr(HIST, hist.slice(0, 50));
      setPos(at + n);
      toast((at + n >= total() ? 'That used the last sticker — put in a new sheet. ' : 'Printed from ' + label(at) + '. ') + 'Next print: ' + label(pos()) + '.');
    }
    o.remove();
  };
  paint();
}

window.CharpeStickers = { print: print, settings: settings, position: function () { return label(pos()); }, esc: esc };
})();
