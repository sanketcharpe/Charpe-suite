/* ============================================================================
   Charpe Suite — Billing → Case accounts                              Nov 2026
   ----------------------------------------------------------------------------
   One running account per case:
     · fees agreed and expenses agreed (at the start),
     · any further fees or expenses that fall due later, entered on their date,
     · payments received, date-wise, each towards fees or expenses,
   and the balance worked out after every line, with totals on top.

   Lines can be added on any date; they sort into place by date, so an amount
   agreed in between sits between the payments it came between. Every line can
   be edited or deleted, and "＋ below" adds a new line right after any line.

   Data lives in the billing register (db.caseAccounts), so it is saved, backed
   up and synced with everything else in Billing. Hidden from staff logins.
   ========================================================================== */
(function () {
'use strict';
function A() { return window.CBapp; }
function $(s, r) { return (r || document).querySelector(s); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function today() { var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) { return A() ? A().money(n) : r2(n).toFixed(2); }
function fd(iso) { return A() ? A().fmtDate(iso) : iso; }

var KINDS = {
  agreed:  { label: 'Fees agreed',             side: 'due', head: 'fees' },
  addfee:  { label: 'Further fees due',        side: 'due', head: 'fees' },
  exp:     { label: 'Expenses agreed',         side: 'due', head: 'exp'  },
  addexp:  { label: 'Further expenses due',    side: 'due', head: 'exp'  },
  payfee:  { label: 'Payment towards fees',    side: 'paid', head: 'fees' },
  payexp:  { label: 'Payment towards expenses',side: 'paid', head: 'exp'  }
};
var KORDER = ['agreed', 'exp', 'addfee', 'addexp', 'payfee', 'payexp'];

function accs() { var db = A().db; if (!db.caseAccounts) db.caseAccounts = []; return db.caseAccounts; }
function cases() { try { return (JSON.parse(localStorage.getItem('cpm_c') || '[]') || []).filter(function (c) { return c && !c.del; }); } catch (e) { return []; } }
function caseLabel(c) { return [c.cn, [c.pl, c.de].filter(Boolean).join(' v. ')].filter(Boolean).join(' — '); }

/* entries in date order; same date: dues before payments, then in the order entered */
function sorted(a) {
  return (a.entries || []).slice().sort(function (x, y) {
    var d = String(x.date || '').localeCompare(String(y.date || '')); if (d) return d;
    var s = (KINDS[x.kind].side === 'due' ? 0 : 1) - (KINDS[y.kind].side === 'due' ? 0 : 1); if (s) return s;
    return (x.seq || 0) - (y.seq || 0);
  });
}
function totals(a) {
  var t = { feeDue: 0, expDue: 0, feePaid: 0, expPaid: 0 };
  (a.entries || []).forEach(function (e) {
    var k = KINDS[e.kind]; if (!k) return; var v = Number(e.amt) || 0;
    if (k.side === 'due') { if (k.head === 'fees') t.feeDue += v; else t.expDue += v; }
    else { if (k.head === 'fees') t.feePaid += v; else t.expPaid += v; }
  });
  t.due = t.feeDue + t.expDue; t.paid = t.feePaid + t.expPaid;
  t.feeBal = t.feeDue - t.feePaid; t.expBal = t.expDue - t.expPaid; t.bal = t.due - t.paid;
  Object.keys(t).forEach(function (k) { t[k] = r2(t[k]); });
  return t;
}
function lastPay(a) { var p = sorted(a).filter(function (e) { return KINDS[e.kind].side === 'paid'; }); return p.length ? p[p.length - 1].date : ''; }

/* ---------------- styles ---------------- */
function css() {
  if ($('#caCss')) return;
  var st = document.createElement('style'); st.id = 'caCss';
  st.textContent = [
    '.ca-wrap{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:14px;align-items:start}',
    '@media(max-width:900px){.ca-wrap{grid-template-columns:1fr}}',
    '.ca-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}',
    '@media(max-width:700px){.ca-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.ca-kpi{background:var(--panel,#fff);border:1px solid var(--line);border-radius:12px;padding:12px 14px}',
    '.ca-kpi small{display:block;font-size:11px;font-weight:600;color:var(--ink-3,#6b7280);text-transform:uppercase;letter-spacing:.4px}',
    '.ca-kpi b{display:block;font-size:20px;margin-top:4px;font-variant-numeric:tabular-nums}',
    '.ca-kpi.bal b{color:var(--warn,#a35b00)}.ca-kpi.ok b{color:var(--ok,#127a4b)}',
    '.ca-list{display:flex;flex-direction:column;gap:6px;max-height:70vh;overflow:auto;margin-top:10px}',
    '.ca-item{border:1px solid var(--line);border-radius:10px;padding:9px 11px;cursor:pointer;background:#fff;text-align:left;font:inherit;color:inherit}',
    '.ca-item:hover{border-color:var(--accent)}.ca-item.on{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 22%,transparent)}',
    '.ca-item .t{font-weight:600;font-size:13px;line-height:1.3}.ca-item .s{font-size:11.5px;color:var(--ink-3,#6b7280);margin-top:2px}',
    '.ca-item .b{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;font-variant-numeric:tabular-nums}',
    '.ca-item .b .due{color:var(--warn,#a35b00);font-weight:700}.ca-item .b .clr{color:var(--ok,#127a4b);font-weight:700}',
    '.ca-head{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;justify-content:space-between;margin-bottom:10px}',
    '.ca-head h2{margin:0}.ca-head .sub{font-size:12.5px;color:var(--ink-3,#6b7280);margin-top:3px}',
    '.ca-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 14px}',
    '@media(max-width:700px){.ca-sum{grid-template-columns:1fr}}',
    '.ca-sum div{border-radius:10px;padding:9px 11px;background:#f6f7f9;font-size:12px}',
    '.ca-sum b{display:block;font-size:16px;margin-top:2px;font-variant-numeric:tabular-nums}',
    '.ca-sum .bal{background:#fff6e8}.ca-sum .bal b{color:var(--warn,#a35b00)}.ca-sum .clr{background:#eaf6ef}.ca-sum .clr b{color:var(--ok,#127a4b)}',
    '.ca-tbl{width:100%;border-collapse:collapse;font-size:13px}',
    '.ca-tbl th{text-align:right;font-size:11px;font-weight:700;color:var(--ink-2,#374151);background:#f3f4f6;padding:8px 8px;border-bottom:1px solid var(--line);white-space:nowrap}',
    '.ca-tbl th:nth-child(1),.ca-tbl th:nth-child(2){text-align:left}',
    '.ca-tbl td{padding:8px 8px;border-bottom:1px solid var(--line-soft,#eceff3);vertical-align:top}',
    '.ca-tbl td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.ca-tbl tr.due td:nth-child(2) .k{color:#1d4ed8}.ca-tbl tr.paid td:nth-child(2) .k{color:var(--ok,#127a4b)}',
    '.ca-tbl tr.paid{background:#fbfefc}',
    '.ca-tbl td .k{font-weight:600}.ca-tbl td .nt{font-size:11.5px;color:var(--ink-3,#6b7280)}',
    '.ca-tbl td.bal{font-weight:700}.ca-tbl td.bal.neg{color:var(--ok,#127a4b)}',
    '.ca-tbl tfoot td{font-weight:700;background:#f9fafb;border-top:2px solid var(--line)}',
    '.ca-tbl .act{white-space:nowrap;text-align:right}.ca-tbl .act button{border:0;background:transparent;color:var(--ink-3,#6b7280);cursor:pointer;font-size:12px;padding:3px 5px;border-radius:5px}',
    '.ca-tbl .act button:hover{background:#eef0f3;color:var(--ink)}',
    '.ca-tbl tr.ins td{background:#f0f6ff}',
    '.ca-form{display:grid;grid-template-columns:130px minmax(170px,1.2fr) 120px minmax(120px,1fr) auto;gap:8px;align-items:end}',
    '@media(max-width:820px){.ca-form{grid-template-columns:1fr 1fr}}',
    '.ca-scroll{overflow-x:auto}',
    '.ca-empty{padding:26px;text-align:center;color:var(--ink-3,#6b7280);font-size:13px}',
    '.ca-quick{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}',
    '.ca-quick button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer}',
    '.ca-quick button:hover{border-color:var(--accent);color:var(--accent)}',
    '.ca-dlg{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9000;padding:16px}',
    '.ca-dlg .box{background:#fff;border-radius:14px;max-width:520px;width:100%;padding:18px 18px 16px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:90vh;overflow:auto}',
    '.ca-dlg h3{margin:0 0 10px;font-size:16px}.ca-dlg .row{margin-bottom:8px}',
    '.ca-dlg .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}',
    'body.cb-clerk .tab[data-view="accounts"]{display:none!important}'
  ].join('\n');
  document.head.appendChild(st);
}

/* ---------------- view ---------------- */
var cur = null, filter = '', insAfter = null, editId = null;

function build() {
  css();
  var nav = $('nav.tabs'); if (!nav || $('.tab[data-view="accounts"]')) return;
  var tab = document.createElement('button'); tab.className = 'tab'; tab.dataset.view = 'accounts'; tab.textContent = 'Case accounts';
  nav.insertBefore(tab, nav.firstChild);
  tab.addEventListener('click', function () { show(); });
  var first = document.querySelector('section.view'); var sec = document.createElement('section');
  sec.className = 'view'; sec.id = 'view-accounts';
  sec.innerHTML =
    '<div class="ca-kpis" id="caKpis"></div>' +
    '<div class="ca-wrap">' +
      '<div class="card"><div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><h2 style="margin:0">Case accounts</h2>' +
        '<button class="btn primary sm" id="caNew">＋ New account</button></div>' +
        '<input type="text" id="caSearch" placeholder="Search case, party or client…" style="margin-top:10px">' +
        '<div style="display:flex;gap:6px;margin-top:8px;font-size:12px"><label class="chk" style="display:flex;gap:5px;align-items:center;margin:0;font-weight:500"><input type="checkbox" id="caOnlyDue"> Only with balance due</label></div>' +
        '<div class="ca-list" id="caList"></div></div>' +
      '<div class="card" id="caDetail"></div>' +
    '</div>';
  first.parentNode.insertBefore(sec, first);
  $('#caNew').addEventListener('click', function () { accountDialog(null); });
  $('#caSearch').addEventListener('input', function () { filter = this.value.trim().toLowerCase(); renderList(); });
  $('#caOnlyDue').addEventListener('change', renderList);
  /* keep the old tab switcher in step when another tab is clicked */
  document.querySelectorAll('.tab').forEach(function (t) { if (t !== tab) t.addEventListener('click', function () { sec.classList.remove('on'); tab.classList.remove('on'); }); });
}
function show() {
  if (window.CB_CLERK) return;
  document.querySelectorAll('.view').forEach(function (x) { x.classList.toggle('on', x.id === 'view-accounts'); });
  document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.dataset.view === 'accounts'); });
  render(); window.scrollTo(0, 0);
}

function render() { renderKpis(); renderList(); renderDetail(); }
function renderKpis() {
  var T = { due: 0, paid: 0, bal: 0, n: 0 };
  accs().forEach(function (a) { var t = totals(a); T.due += t.due; T.paid += t.paid; T.bal += t.bal; if (t.bal > 0.009) T.n++; });
  $('#caKpis').innerHTML =
    '<div class="ca-kpi"><small>Accounts</small><b>' + accs().length + '</b></div>' +
    '<div class="ca-kpi"><small>Total agreed / due</small><b>₹' + money(T.due) + '</b></div>' +
    '<div class="ca-kpi ok"><small>Total received</small><b>₹' + money(T.paid) + '</b></div>' +
    '<div class="ca-kpi bal"><small>Balance to receive' + (T.n ? ' · ' + T.n + (T.n === 1 ? ' case' : ' cases') : '') + '</small><b>₹' + money(T.bal) + '</b></div>';
}
function renderList() {
  var only = $('#caOnlyDue') && $('#caOnlyDue').checked;
  var L = accs().map(function (a) { return { a: a, t: totals(a) }; }).filter(function (x) {
    if (only && x.t.bal <= 0.009) return false;
    if (!filter) return true;
    return [x.a.title, x.a.client, x.a.court, x.a.note].join(' ').toLowerCase().indexOf(filter) >= 0;
  }).sort(function (x, y) { return (y.t.bal - x.t.bal) || String(x.a.title).localeCompare(String(y.a.title)); });
  if (!cur && L.length) cur = L[0].a.id;
  $('#caList').innerHTML = L.length ? L.map(function (x) {
    var a = x.a, t = x.t;
    return '<button class="ca-item' + (a.id === cur ? ' on' : '') + '" data-id="' + a.id + '"><div class="t">' + esc(a.title || 'Untitled') + '</div>' +
      '<div class="s">' + esc([a.client, a.court].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="b"><span>Due ₹' + money(t.due) + ' · Paid ₹' + money(t.paid) + '</span>' +
      (t.bal > 0.009 ? '<span class="due">₹' + money(t.bal) + '</span>' : '<span class="clr">' + (t.bal < -0.009 ? 'Advance ₹' + money(-t.bal) : 'Clear') + '</span>') + '</div></button>';
  }).join('') : '<div class="ca-empty">' + (accs().length ? 'Nothing matches.' : 'No case accounts yet.<br>Press “＋ New account” to open one for a case.') + '</div>';
  $('#caList').querySelectorAll('.ca-item').forEach(function (b) { b.onclick = function () { cur = b.dataset.id; insAfter = null; editId = null; renderList(); renderDetail(); }; });
}

function renderDetail() {
  var box = $('#caDetail'), a = accs().find(function (x) { return x.id === cur; });
  if (!a) { box.innerHTML = '<div class="ca-empty">Choose an account on the left, or open a new one.</div>'; return; }
  var t = totals(a), rows = sorted(a), run = 0, runF = 0, runE = 0;
  var body = rows.map(function (e) {
    var k = KINDS[e.kind], v = Number(e.amt) || 0, isDue = k.side === 'due';
    if (isDue) { run += v; if (k.head === 'fees') runF += v; else runE += v; } else { run -= v; if (k.head === 'fees') runF -= v; else runE -= v; }
    var tr = '<tr class="' + (isDue ? 'due' : 'paid') + '">' +
      '<td style="white-space:nowrap">' + esc(fd(e.date)) + '</td>' +
      '<td><span class="k">' + k.label + '</span>' + (e.note ? '<div class="nt">' + esc(e.note) + '</div>' : '') + '</td>' +
      '<td class="n">' + (isDue && k.head === 'fees' ? money(v) : '') + '</td>' +
      '<td class="n">' + (isDue && k.head === 'exp' ? money(v) : '') + '</td>' +
      '<td class="n">' + (!isDue && k.head === 'fees' ? money(v) : '') + '</td>' +
      '<td class="n">' + (!isDue && k.head === 'exp' ? money(v) : '') + '</td>' +
      '<td class="n bal' + (run < -0.009 ? ' neg' : '') + '">' + money(run) + '</td>' +
      '<td class="act"><button data-ins="' + e.id + '" title="Add a line just after this one">＋ below</button><button data-ed="' + e.id + '" title="Edit">Edit</button><button data-del="' + e.id + '" title="Delete">✕</button></td></tr>';
    if (insAfter === e.id) tr += '<tr class="ins"><td colspan="8">' + formHTML(null, e.date) + '</td></tr>';
    if (editId === e.id) tr = '<tr class="ins"><td colspan="8">' + formHTML(e) + '</td></tr>';
    return tr;
  }).join('');
  box.innerHTML =
    '<div class="ca-head"><div><h2>' + esc(a.title || 'Untitled') + '</h2><div class="sub">' + esc([a.client, a.court].filter(Boolean).join(' · ')) +
      (lastPay(a) ? ' · last payment ' + esc(fd(lastPay(a))) : '') + '</div>' + (a.note ? '<div class="sub">' + esc(a.note) + '</div>' : '') + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="caPrint">⎙ Statement</button><button class="btn sm" id="caEditAcc">Edit account</button><button class="btn ghost sm" id="caDelAcc">Delete</button></div></div>' +
    '<div class="ca-sum">' +
      '<div>Fees: agreed + further<b>₹' + money(t.feeDue) + '</b>paid ₹' + money(t.feePaid) + ' · balance <b style="display:inline;font-size:13px">₹' + money(t.feeBal) + '</b></div>' +
      '<div>Expenses: agreed + further<b>₹' + money(t.expDue) + '</b>paid ₹' + money(t.expPaid) + ' · balance <b style="display:inline;font-size:13px">₹' + money(t.expBal) + '</b></div>' +
      '<div class="' + (t.bal > 0.009 ? 'bal' : 'clr') + '">' + (t.bal < -0.009 ? 'Paid in advance' : 'Balance to receive') + '<b>₹' + money(Math.abs(t.bal)) + '</b>of ₹' + money(t.due) + ' due · ₹' + money(t.paid) + ' received</div>' +
    '</div>' +
    '<div class="ca-quick" id="caQuick">' + KORDER.map(function (k) { return '<button data-q="' + k + '">＋ ' + KINDS[k].label + '</button>'; }).join('') + '</div>' +
    '<div id="caFormTop"></div>' +
    '<div class="ca-scroll"><table class="ca-tbl"><thead><tr><th>Date</th><th>Particulars</th><th>Fees due</th><th>Expenses due</th><th>Paid (fees)</th><th>Paid (expenses)</th><th>Balance</th><th></th></tr></thead>' +
    '<tbody>' + (body || '<tr><td colspan="8"><div class="ca-empty">No entries yet. Start with “＋ Fees agreed”.</div></td></tr>') + '</tbody>' +
    (rows.length ? '<tfoot><tr><td></td><td>Total</td><td class="n">' + money(t.feeDue) + '</td><td class="n">' + money(t.expDue) + '</td><td class="n">' + money(t.feePaid) + '</td><td class="n">' + money(t.expPaid) + '</td><td class="n">' + money(t.bal) + '</td><td></td></tr></tfoot>' : '') +
    '</table></div>';

  box.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { insAfter = null; editId = null; renderDetail(); $('#caFormTop').innerHTML = formHTML({ kind: b.dataset.q, date: today() }, null, true); wire(a); var am = $('#caAmt'); if (am) am.focus(); }; });
  box.querySelectorAll('[data-ins]').forEach(function (b) { b.onclick = function () { insAfter = b.dataset.ins; editId = null; renderDetail(); }; });
  box.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editId = b.dataset.ed; insAfter = null; renderDetail(); }; });
  box.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () {
    var e = a.entries.find(function (x) { return x.id === b.dataset.del; }); if (!e) return;
    if (!confirm('Delete this line?\n\n' + fd(e.date) + ' — ' + KINDS[e.kind].label + ' — ₹' + money(e.amt))) return;
    a.entries = a.entries.filter(function (x) { return x.id !== e.id; }); commit('Line deleted');
  }; });
  $('#caPrint').onclick = function () { statement(a); };
  $('#caEditAcc').onclick = function () { accountDialog(a); };
  $('#caDelAcc').onclick = function () {
    if (!confirm('Delete the whole account for “' + (a.title || '') + '” with all its lines?')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    A().db.caseAccounts = accs().filter(function (x) { return x.id !== a.id; }); cur = null; commit('Account deleted');
  };
  wire(a);
}

function formHTML(e, afterDate, top) {
  e = e || {}; var kind = e.kind || 'payfee';
  return '<div class="ca-form" style="' + (top ? 'background:#f0f6ff;border-radius:10px;padding:10px;margin-bottom:10px' : '') + '">' +
    '<div><label>Date</label><input type="date" id="caDate" value="' + esc(e.date || afterDate || today()) + '"></div>' +
    '<div><label>What</label><select id="caKind">' + KORDER.map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + KINDS[k].label + '</option>'; }).join('') + '</select></div>' +
    '<div><label>Amount ₹</label><input type="number" id="caAmt" step="0.01" min="0" value="' + (e.amt != null ? esc(e.amt) : '') + '" placeholder="0.00"></div>' +
    '<div><label>Note (stage, mode, cheque no.…)</label><input type="text" id="caNote" value="' + esc(e.note || '') + '"></div>' +
    '<div style="display:flex;gap:6px"><button class="btn primary sm" id="caSave" data-edit="' + esc(e.id || '') + '">' + (e.id ? 'Save' : 'Add') + '</button><button class="btn ghost sm" id="caCancel">Cancel</button></div></div>';
}
function wire(a) {
  var s = $('#caSave'), c = $('#caCancel'); if (!s) return;
  c.onclick = function () { insAfter = null; editId = null; renderDetail(); };
  var go = function () {
    var amt = r2($('#caAmt').value), date = $('#caDate').value || today(), kind = $('#caKind').value, note = $('#caNote').value.trim();
    if (amt <= 0) { A().toast('Enter the amount.'); $('#caAmt').focus(); return; }
    if (!a.entries) a.entries = [];
    var id = s.dataset.edit;
    if (id) { var e = a.entries.find(function (x) { return x.id === id; }); if (e) { e.date = date; e.kind = kind; e.amt = amt; e.note = note; } }
    else a.entries.push({ id: uid(), seq: Date.now(), date: date, kind: kind, amt: amt, note: note });
    insAfter = null; editId = null; commit((id ? 'Line updated' : KINDS[kind].label + ' ₹' + money(amt) + ' added'));
  };
  s.onclick = go;
  ['#caAmt', '#caNote'].forEach(function (q) { var x = $(q); if (x) x.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } }); });
}
function commit(msg) { A().save(); render(); if (msg) A().toast(msg); }

/* ---------------- new / edit account ---------------- */
function accountDialog(a) {
  var cs = cases(), isNew = !a; a = a || { id: uid(), entries: [] };
  var d = document.createElement('div'); d.className = 'ca-dlg';
  d.innerHTML = '<div class="box"><h3>' + (isNew ? 'New case account' : 'Edit account') + '</h3>' +
    '<div class="row wide"><div><label>Case (from the Case Manager, or type)</label><input type="text" id="cdCase" list="cdCases" value="' + esc(a.title || '') + '" placeholder="e.g. RCS 104/2016 — Dhande v. Dhande"><datalist id="cdCases">' +
      cs.map(function (c) { return '<option value="' + esc(caseLabel(c)) + '">'; }).join('') + '</datalist></div></div>' +
    '<div class="row"><div><label>Client</label><input type="text" id="cdClient" value="' + esc(a.client || '') + '"></div>' +
    '<div><label>Court</label><input type="text" id="cdCourt" value="' + esc(a.court || '') + '"></div></div>' +
    '<div class="row wide"><div><label>Note (terms of the fee, e.g. stage-wise)</label><input type="text" id="cdNote" value="' + esc(a.note || '') + '"></div></div>' +
    (isNew ? '<div class="row"><div><label>Fees agreed ₹ (optional)</label><input type="number" id="cdFee" step="0.01" min="0"></div><div><label>Expenses agreed ₹ (optional)</label><input type="number" id="cdExp" step="0.01" min="0"></div></div>' +
      '<div class="row"><div><label>Agreed on</label><input type="date" id="cdDate" value="' + today() + '"></div><div></div></div>' : '') +
    '<div class="bt"><button class="btn ghost" id="cdX">Cancel</button><button class="btn primary" id="cdOk">' + (isNew ? 'Open account' : 'Save') + '</button></div></div>';
  document.body.appendChild(d);
  var cInp = $('#cdCase', d);
  cInp.addEventListener('change', function () {
    var c = cs.find(function (x) { return caseLabel(x) === cInp.value; }); if (!c) return;
    if (!$('#cdClient', d).value) $('#cdClient', d).value = c.cl || '';
    if (!$('#cdCourt', d).value) $('#cdCourt', d).value = c.court || '';
    cInp.dataset.cid = c.id;
  });
  setTimeout(function () { cInp.focus(); }, 50);
  $('#cdX', d).onclick = function () { d.remove(); };
  d.addEventListener('click', function (e) { if (e.target === d) d.remove(); });
  $('#cdOk', d).onclick = function () {
    var title = cInp.value.trim(); if (!title) { A().toast('Name the case.'); cInp.focus(); return; }
    a.title = title; a.client = $('#cdClient', d).value.trim(); a.court = $('#cdCourt', d).value.trim(); a.note = $('#cdNote', d).value.trim();
    if (cInp.dataset.cid) a.caseId = cInp.dataset.cid;
    if (isNew) {
      var dt = $('#cdDate', d).value || today(), f = r2($('#cdFee', d).value), x = r2($('#cdExp', d).value);
      if (f > 0) a.entries.push({ id: uid(), seq: Date.now(), date: dt, kind: 'agreed', amt: f, note: '' });
      if (x > 0) a.entries.push({ id: uid(), seq: Date.now() + 1, date: dt, kind: 'exp', amt: x, note: '' });
      a.created = new Date().toISOString(); accs().push(a);
    }
    cur = a.id; d.remove(); commit(isNew ? 'Account opened' : 'Account saved');
  };
}

/* ---------------- printable statement ---------------- */
function statement(a) {
  var t = totals(a), run = 0, s = A().db.settings || {};
  var rows = sorted(a).map(function (e) {
    var k = KINDS[e.kind], v = Number(e.amt) || 0, isDue = k.side === 'due'; run += isDue ? v : -v;
    return '<tr><td>' + esc(fd(e.date)) + '</td><td>' + k.label + (e.note ? '<br><small>' + esc(e.note) + '</small>' : '') + '</td><td class="n">' + (isDue ? money(v) : '') + '</td><td class="n">' + (isDue ? '' : money(v)) + '</td><td class="n">' + money(run) + '</td></tr>';
  }).join('');
  var html = '<!doctype html><html><head><meta charset="utf-8"><title>Statement — ' + esc(a.title) + '</title><style>' +
    'body{font:13px/1.45 Georgia,"Times New Roman",serif;margin:28px;color:#111}h1{font-size:17px;margin:0}h2{font-size:14px;margin:14px 0 2px}' +
    '.f{font-size:12px;color:#444}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:5px 7px;vertical-align:top}' +
    'th{background:#eee;text-align:left}.n{text-align:right;white-space:nowrap}tfoot td{font-weight:bold}small{color:#555}' +
    '.s{display:flex;gap:28px;margin-top:12px}.s b{display:block;font-size:15px}@page{size:A4;margin:16mm}</style></head><body>' +
    '<h1>' + esc(s.firm || 'Statement of account') + '</h1><div class="f">' + esc(s.addr || '') + '</div>' +
    '<h2>Statement of fees and expenses</h2><div><b>' + esc(a.title) + '</b></div><div class="f">' + esc([a.client, a.court].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="f">As on ' + esc(fd(today())) + '</div>' +
    '<table><thead><tr><th>Date</th><th>Particulars</th><th class="n">Due (₹)</th><th class="n">Received (₹)</th><th class="n">Balance (₹)</th></tr></thead><tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td></td><td>Total</td><td class="n">' + money(t.due) + '</td><td class="n">' + money(t.paid) + '</td><td class="n">' + money(t.bal) + '</td></tr></tfoot></table>' +
    '<div class="s"><div>Fees balance<b>₹' + money(t.feeBal) + '</b></div><div>Expenses balance<b>₹' + money(t.expBal) + '</b></div><div>' + (t.bal < 0 ? 'Paid in advance' : 'Total balance due') + '<b>₹' + money(Math.abs(t.bal)) + '</b></div></div>' +
    '<script>setTimeout(function(){print()},300)<\/script></body></html>';
  var w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  else A().toast('Allow pop-ups to print the statement.');
}

/* ---------------- start: build the tab, open it after sign-in ---------------- */
function start() {
  if (!A() || !A().db || !$('nav.tabs')) return setTimeout(start, 300);
  build();
  var lock = $('#lock');
  var opened = false, openIt = function () { if (opened || window.CB_CLERK) return; opened = true; setTimeout(show, 150); };
  if (lock) {
    if (lock.classList.contains('off')) openIt();
    else new MutationObserver(function () { if (lock.classList.contains('off')) openIt(); else opened = false; }).observe(lock, { attributes: true, attributeFilter: ['class'] });
  } else openIt();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
window.CBaccounts = { show: show, totals: totals };
})();
