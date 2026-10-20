/* ==================================================================
   CHARPE BILLING — OFFICE ADDITIONS                          Oct 2026
   ------------------------------------------------------------------
   • Sign in to Billing with a Case Manager account too. An ordinary
     user (the clerk) sees only the LAST 5 BILLS and the LAST 5 LETTERS;
     Receipts, Backups and Settings are hidden and nothing can be deleted.
   • Client directory: email addresses, postal address, contact numbers,
     contact person and type (institutional / personal) for every client.
   • Share → "Email to a client": pick the client, the email, postal
     address and phone fill in, the PDF is attached and the mail goes out
     from your own Gmail once you confirm. Hover over (or tap) the postal
     address to print it on the next sticker of the sticker sheet.
   ================================================================== */
(function () {
'use strict';
var LIMIT = 5;
var A = function () { return window.CBapp; };
var $ = function (s, r) { return (r || document).querySelector(s); };
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(m) { if (A() && A().toast) A().toast(m); else alert(m); }
function save() { if (A().saveNow) A().saveNow(); else A().save(); }

/* ---------------- sign-in with a Case Manager account ---------------- */
function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function fallback(s) {
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519); }
  return 'f' + ((h1 >>> 0).toString(16)) + ((h2 >>> 0).toString(16));
}
function caseHash(user, pass) {   /* the same one-way hash the Case Manager uses */
  var s = String(user).toLowerCase() + '␟' + String(pass) + '␟charpe.v5';
  if (window.crypto && crypto.subtle && window.TextEncoder)
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) { return 's' + hex(b); }).catch(function () { return fallback(s); });
  return Promise.resolve(fallback(s));
}
window.CBaltAuth = function (user, pass) {
  var U = []; try { U = JSON.parse(localStorage.getItem('cpm_u') || '[]') || []; } catch (e) {}
  var u = U.filter(function (x) { return String(x.username || '').toLowerCase() === String(user || '').trim().toLowerCase(); })[0];
  if (!u || !pass) return Promise.resolve(false);
  return caseHash(u.username, pass).then(function (h) {
    var ok = u.ph ? u.ph === h : (u.password !== undefined && u.password === pass);
    if (!ok) return false;
    if (u.role !== 'admin' && u.bill === false) { setTimeout(function () { var m = $('#lg-msg'); if (m) m.textContent = 'This account is not allowed into Billing.'; }, 30); return false; }
    window.CB_CLERK = u.role !== 'admin'; window.CB_ALT = true;
    window.CB_USER = u.name || u.username;
    if (window.CB_CLERK) clerkMode();
    return true;
  });
};

/* ---------------- what the clerk may see ---------------- */
function invKey(v) { var m = String(v.number || '').match(/(\d+)\s*$/); return [String(v.date || ''), m ? ('000000' + m[1]).slice(-7) : '', String(v.savedAt || '')].join('|'); }
window.CBvisInv = function (list) {
  if (!window.CB_CLERK) return list;
  return (list || []).slice().sort(function (a, b) { return invKey(b).localeCompare(invKey(a)); }).slice(0, LIMIT);
};
window.CBvisLet = function (list) {
  if (!window.CB_CLERK) return list;
  return (list || []).slice().sort(function (a, b) {
    return String(b.savedAt || b.date || '').localeCompare(String(a.savedAt || a.date || ''));
  }).slice(0, LIMIT);
};
function clerkMode() {
  document.body.classList.add('cb-clerk');
  if (!document.getElementById('cbClerkCss')) {
    var st = document.createElement('style'); st.id = 'cbClerkCss';
    st.textContent = 'body.cb-clerk .tab[data-view="receipts"],body.cb-clerk .tab[data-view="backups"],body.cb-clerk .tab[data-view="settings"],' +
      'body.cb-clerk [data-del],body.cb-clerk [data-ldel],body.cb-clerk .m5-del,body.cb-clerk [data-rcpt],body.cb-clerk [data-pay]{display:none!important}' +
      'body.cb-clerk .cb-clerkbar{display:block}.cb-clerkbar{display:none;background:#fff8e6;border-bottom:1px solid #f0d48a;padding:6px 14px;font-size:12px;color:#6b4e00}';
    document.head.appendChild(st);
  }
  if (!document.querySelector('.cb-clerkbar')) {
    var bar = document.createElement('div'); bar.className = 'cb-clerkbar';
    bar.textContent = 'Signed in as ' + (window.CB_USER || 'staff') + ' — the last ' + LIMIT + ' bills and last ' + LIMIT + ' letters are shown.';
    var nav = document.querySelector('nav.tabs'); if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling); else document.body.prepend(bar);
  }
}

/* ==================================================================
   CLIENT DIRECTORY
   ================================================================== */
var F = [
  ['ctype', 'Type', 'select'], ['person', 'Contact person and designation', 'text', 'e.g. Divisional Controller'],
  ['email', 'Email addresses (separate with commas)', 'text', 'dc.nagpur@msrtc.gov.in, legal@msrtc.gov.in'],
  ['postal', 'Postal address (for letters and address stickers)', 'area', 'Leave blank to use the Bill To block'],
  ['phone', 'Contact numbers', 'text', '0712-2726221, 98xxxxxxxx']
];
function clients() { return (A() && A().db && A().db.clients) || []; }
function clientById(id) { return clients().filter(function (c) { return c.id === id; })[0]; }
function postalOf(c) { return String(c.postal || c.address || '').trim(); }
function emailsOf(c) { return String(c.email || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /@/.test(x); }); }

function addFields() {
  var note = $('#c-note'); if (!note || $('#c-x-email')) return;
  var h = '';
  F.forEach(function (f) {
    h += '<label for="c-x-' + f[0] + '" style="margin-top:10px">' + f[1] + '</label>';
    if (f[2] === 'select') h += '<select id="c-x-' + f[0] + '"><option value="institutional">Institutional client</option><option value="personal">Personal client</option></select>';
    else if (f[2] === 'area') h += '<textarea id="c-x-' + f[0] + '" rows="3" placeholder="' + esc(f[3] || '') + '"></textarea>';
    else h += '<input type="text" id="c-x-' + f[0] + '" placeholder="' + esc(f[3] || '') + '">';
  });
  note.insertAdjacentHTML('afterend', h);
  /* remember which client the form is for before the tool's own save runs */
  var pending = null;
  $('#save-client').addEventListener('click', function () {
    var x = {}; F.forEach(function (f) { var el = $('#c-x-' + f[0]); x[f[0]] = el ? el.value.trim() : ''; });
    pending = { id: $('#c-id').value, name: $('#c-name').value.trim(), x: x };
  }, true);
  $('#save-client').addEventListener('click', function () {
    var p = pending; pending = null; if (!p || !p.name) return;
    var c = (p.id && clientById(p.id)) || clients().filter(function (z) { return z.name === p.name; }).slice(-1)[0];
    if (!c) return;
    Object.assign(c, p.x); save(); clearFields(); enhanceList();
  });
  $('#reset-client').addEventListener('click', clearFields);
  $('#client-list').addEventListener('click', function (e) {
    var id = e.target.dataset && e.target.dataset.edit; if (!id) return;
    setTimeout(function () { var c = clientById(id); if (!c) return; F.forEach(function (f) { var el = $('#c-x-' + f[0]); if (el) el.value = c[f[0]] || (f[0] === 'ctype' ? 'institutional' : ''); }); }, 0);
  });
  new MutationObserver(enhanceList).observe($('#client-list'), { childList: true });
  var tab = document.querySelector('.tab[data-view="clients"]');
  if (tab) tab.addEventListener('click', function () { setTimeout(function () { if (A().renderClients) A().renderClients(); }, 0); });
  enhanceList();
}
function clearFields() { F.forEach(function (f) { var el = $('#c-x-' + f[0]); if (el) el.value = f[0] === 'ctype' ? 'institutional' : ''; }); }
var enhancing = false;
function enhanceList() {
  if (enhancing) return; enhancing = true;
  try {
    document.querySelectorAll('#client-list [data-edit]').forEach(function (b) {
      var c = clientById(b.dataset.edit), td = b.closest('tr') && b.closest('tr').children[2];
      if (!c || !td || td.querySelector('.cx')) return;
      var bits = [];
      if (c.ctype === 'personal') bits.push('<span style="font-size:10px;border:1px solid #cdd;border-radius:4px;padding:0 4px">personal</span>');
      if (c.person) bits.push(esc(c.person));
      if (c.email) bits.push('&#9993; ' + esc(c.email));
      if (c.phone) bits.push('&#9742; ' + esc(c.phone));
      if (c.postal) bits.push('&#127968; ' + esc(c.postal).replace(/\n/g, ', '));
      if (bits.length) td.insertAdjacentHTML('beforeend', '<div class="cx" style="font-size:11px;color:#333;margin-top:3px;line-height:1.5">' + bits.join('<br>') + '</div>');
    });
  } finally { enhancing = false; }
}

/* ==================================================================
   EMAIL TO A CLIENT
   ================================================================== */
function backend() {
  try { var s = JSON.parse(localStorage.getItem('cpm_s') || '{}'); return (s && s.eco) || {}; } catch (e) { return {}; }
}
function b64(blob) {
  return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); });
}
function css() {
  if (document.getElementById('emcss')) return;
  var st = document.createElement('style'); st.id = 'emcss';
  st.textContent =
    '.em-ov{position:fixed;inset:0;background:rgba(10,18,32,.5);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:18px 10px;overflow:auto}' +
    '.em-p{background:#fff;border-radius:10px;width:min(640px,100%);box-shadow:0 14px 40px rgba(0,0,0,.3);font-size:13px}' +
    '.em-h{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e3e6ea}.em-h b{flex:1;font-size:15px}' +
    '.em-b{padding:14px 16px}.em-f{padding:12px 16px;border-top:1px solid #e3e6ea;display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.em-b label{display:block;font-size:11px;font-weight:700;color:#5b6474;text-transform:uppercase;letter-spacing:.4px;margin:10px 0 4px}' +
    '.em-b input,.em-b textarea,.em-b select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #c9ced6;border-radius:6px;font:inherit}' +
    '.em-addr{position:relative;border:1px dashed #c9ced6;border-radius:6px;padding:8px 10px;white-space:pre-wrap;min-height:38px;background:#fafbfc;cursor:default}' +
    '.em-addr .em-stk{display:none;position:absolute;right:6px;top:6px}.em-addr:hover .em-stk,.em-addr:focus-within .em-stk,.em-addr.tap .em-stk{display:inline-flex}' +
    '.em-b label.em-chip{display:inline-flex;gap:6px;align-items:center;border:1px solid #c9ced6;border-radius:999px;padding:4px 10px;margin:0 6px 6px 0;font-size:12.5px;font-weight:500;text-transform:none;letter-spacing:0;color:#1a2744;cursor:pointer}' +
    '.em-b label.em-chip input{width:auto;margin:0;padding:0}' +
    '.em-sum{background:#f4f6f9;border-radius:8px;padding:10px 12px;line-height:1.6}';
  document.head.appendChild(st);
}
function modal(title, body, foot) {
  css();
  var o = document.createElement('div'); o.className = 'em-ov';
  o.innerHTML = '<div class="em-p"><div class="em-h"><b>' + title + '</b><button class="btn ghost sm" data-x>Close</button></div><div class="em-b">' + body + '</div><div class="em-f">' + (foot || '') + '</div></div>';
  document.body.appendChild(o);
  o.querySelector('[data-x]').onclick = function () { o.remove(); };
  return o;
}
function guessClient(ctx) {
  var bt = String(ctx.billTo || ctx.text || '').toLowerCase().replace(/\s+/g, ' ');
  if (ctx.clientId && clientById(ctx.clientId)) return clientById(ctx.clientId);
  var best = null, score = 0;
  clients().forEach(function (c) {
    var a = String(c.address || '').toLowerCase().replace(/\s+/g, ' ').trim(), n = String(c.name || '').toLowerCase();
    var s = a && bt.indexOf(a) >= 0 ? 3 : (n && bt.indexOf(n) >= 0 ? 2 : (a && bt && a.indexOf(bt.split(' ').slice(0, 4).join(' ')) >= 0 ? 1 : 0));
    if (s > score) { score = s; best = c; }
  });
  return best;
}
window.CBemail = function (got, text, subject, ctx) {
  var list = clients().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  var pre = guessClient(ctx || {});
  var o = modal('Email ' + esc(got.name),
    '<label for="emC">Client</label><input id="emC" list="emCL" autocomplete="off" placeholder="Type to search the client list" value="' + esc(pre ? pre.name : '') + '">' +
    '<datalist id="emCL">' + list.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc((c.person ? c.person + ' — ' : '') + (c.email || 'no email saved')) + '</option>'; }).join('') + '</datalist>' +
    '<label>Email address</label><div id="emChips"></div><input id="emTo" placeholder="name@example.com, another@example.com">' +
    '<label>Postal address <span style="font-weight:400;text-transform:none">&mdash; hover (or tap) to print it on a sticker</span></label>' +
    '<div class="em-addr" id="emAddr" tabindex="0"><span id="emAddrT" style="color:#888">Choose a client</span>' +
      '<button class="btn sm em-stk" id="emStk" type="button">&#9635; Print address sticker</button></div>' +
    '<label>Contact number</label><input id="emPh" readonly style="background:#fafbfc">' +
    '<label for="emS">Subject</label><input id="emS" value="' + esc(subject || '') + '">' +
    '<label for="emB">Message</label><textarea id="emB" rows="7">' + esc((ctx && ctx.kind === 'invoice' ? 'Respected Sir/Madam,\n\nPlease find attached ' : 'Respected Sir/Madam,\n\nPlease find attached ') + got.name.replace(/\.pdf$/i, '') + '.\n\n' + (text || '').split('\n').slice(-2).join('\n')) + '</textarea>' +
    '<div style="margin-top:10px;font-size:12px;color:#5b6474">Attached: <b>' + esc(got.name) + '</b> (' + Math.max(1, Math.round(got.blob.size / 1024)) + ' KB)</div>',
    '<button class="btn primary" id="emGo">Send…</button><button class="btn ghost" id="emSave" title="Save these details on the client for next time">Save address on the client</button>' +
    '<span style="margin-left:auto;font-size:11.5px;color:#5b6474">Sent from your own Gmail</span>');
  var cur = null;
  function fill(c) {
    cur = c || null;
    var mails = c ? emailsOf(c) : [];
    $('#emChips', o).innerHTML = mails.length > 1 ? mails.map(function (m) { return '<label class="em-chip"><input type="checkbox" checked data-m="' + esc(m) + '">' + esc(m) + '</label>'; }).join('') : '';
    $('#emTo', o).value = mails.length === 1 ? mails[0] : '';
    var pa = c ? postalOf(c) : '';
    $('#emAddrT', o).textContent = pa || (c ? 'No postal address saved for this client' : 'Choose a client');
    $('#emAddrT', o).style.color = pa ? '#1a2744' : '#888';
    $('#emPh', o).value = c ? (c.phone || '') : '';
    if (c && !mails.length) $('#emTo', o).placeholder = 'No email saved for ' + c.name + ' — type it here';
  }
  function pickByName() { var v = $('#emC', o).value.trim().toLowerCase(); fill(list.filter(function (c) { return String(c.name).toLowerCase() === v; })[0] || null); }
  $('#emC', o).addEventListener('change', pickByName);
  $('#emC', o).addEventListener('input', function () { if (list.some(function (c) { return String(c.name).toLowerCase() === this.value.trim().toLowerCase(); }, this)) pickByName(); });
  fill(pre);
  $('#emAddr', o).addEventListener('click', function () { this.classList.toggle('tap'); });
  $('#emStk', o).onclick = function (e) {
    e.stopPropagation();
    var pa = cur ? postalOf(cur) : ''; if (!pa) { toast('No postal address saved for this client.'); return; }
    var E = window.CharpeStickers.esc, body = '<b>' + E(cur.person || '') + '</b>' + (cur.person ? '<br>' : '') + E(pa).replace(/\n/g, '<br>') + (cur.phone ? '<br>Ph: ' + E(cur.phone) : '');
    window.CharpeStickers.print([{ html: body }], { title: 'Address — ' + cur.name });
  };
  function recipients() {
    var picked = Array.prototype.map.call(o.querySelectorAll('#emChips [data-m]:checked'), function (x) { return x.dataset.m; });
    var typed = $('#emTo', o).value.split(/[,;\s]+/).filter(function (x) { return /@/.test(x); });
    return picked.concat(typed).filter(function (x, i, a) { return a.indexOf(x) === i; });
  }
  $('#emSave', o).onclick = function () {
    if (!cur) { toast('Choose a client first.'); return; }
    var to = recipients(); if (to.length) cur.email = to.join(', ');
    save(); toast('Saved on ' + cur.name + '.');
  };
  $('#emGo', o).onclick = function () {
    var to = recipients(), subj = $('#emS', o).value.trim(), body = $('#emB', o).value;
    if (!to.length) { toast('Give at least one email address.'); return; }
    confirmSend(o, got, to, subj, body, cur);
  };
};
function confirmSend(parent, got, to, subj, body, cur) {
  var cfg = backend();
  var c = modal('Send this email?',
    '<div class="em-sum"><b>To:</b> ' + esc(to.join(', ')) + (cur ? ' <span style="color:#5b6474">(' + esc(cur.name) + ')</span>' : '') +
    '<br><b>Subject:</b> ' + esc(subj) + '<br><b>Attachment:</b> ' + esc(got.name) + '</div>' +
    (cfg.url ? '<p style="margin:10px 0 0;font-size:12px;color:#5b6474">It goes out from your Gmail through your eCourts backend. The first time after the update, Google asks you once to allow “Send email as you”.</p>'
             : '<p style="margin:10px 0 0;font-size:12px;color:#b3261e">The eCourts backend is not set up on this computer (Case Manager → Settings → Official eCourts), so the mail cannot be sent from here. Use “Open in Gmail instead”.</p>'),
    (cfg.url ? '<button class="btn primary" id="emOk">Confirm and send</button>' : '') +
    '<button class="btn ghost" id="emGm">Open in Gmail instead</button><button class="btn ghost" id="emNo">Back</button>');
  $('#emNo', c).onclick = function () { c.remove(); };
  $('#emGm', c).onclick = function () { c.remove(); parent.remove(); gmailFallback(got, to, subj, body); };
  var ok = $('#emOk', c); if (!ok) return;
  ok.onclick = function () {
    ok.disabled = true; ok.textContent = 'Sending…';
    b64(got.blob).then(function (data) {
      return fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
        body: JSON.stringify({ token: cfg.tok, action: 'mail', to: to.join(','), subject: subj, body: body, attachments: [{ name: got.name, b64: data, type: got.blob.type || 'application/pdf' }] }) });
    }).then(function (r) { return r.text(); }).then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) { throw new Error(/<html/i.test(t) ? 'Google is asking for permission. Open the eCourts backend in script.google.com, run "authoriseAll" once, and try again.' : 'The backend did not answer properly.'); }
      if (!j.ok) throw new Error(/permission|authori[sz]|gmail/i.test(j.error || '') ? 'Gmail permission is needed: open the eCourts backend in script.google.com, run "authoriseAll" once and allow it. (' + j.error + ')' : j.error || 'Not sent');
      c.remove(); parent.remove();
      logMail(to, subj, got.name, cur);
      toast('Sent to ' + to.join(', ') + '.');
    }).catch(function (e) {
      ok.disabled = false; ok.textContent = 'Confirm and send';
      var m = c.querySelector('.em-b'); m.insertAdjacentHTML('beforeend', '<p style="color:#b3261e;margin:10px 0 0">' + esc(e.message || e) + '</p>');
    });
  };
}
function logMail(to, subj, file, cur) {
  try { var d = A().db; d.mailLog = d.mailLog || []; d.mailLog.unshift({ at: new Date().toISOString(), to: to.join(', '), subject: subj, file: file, client: cur ? cur.name : '', by: window.CB_USER || '' }); d.mailLog = d.mailLog.slice(0, 500); save(); } catch (e) {}
}
function gmailFallback(got, to, subj, body) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(got.blob); a.download = got.name; document.body.appendChild(a); a.click(); a.remove();
  window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to.join(',')) + '&su=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body), '_blank');
  toast(got.name + ' is in your Downloads — attach it to the email that opened.');
}

/* ---------------- start ---------------- */
function start() {
  if (!A() || !A().db) return setTimeout(start, 300);
  addFields();
  if (window.CB_CLERK) clerkMode();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
