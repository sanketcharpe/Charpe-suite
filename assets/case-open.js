/* Click a case name → the case opens (Nov 2026).
   csOpen(id): one sheet with everything about the case — parties, court, dates, what the court site showed
   when last fetched, orders and order sheets — and the actions: Post date, Edit, Fetch now (CAPTCHA right
   here), Orders & order sheets, History, Print, Show in All Cases. */
(function () {
  'use strict';
  var st = document.createElement('style');
  st.textContent =
    '#csp{position:fixed;inset:0;z-index:950;background:rgba(15,22,38,.45);display:flex;align-items:flex-start;justify-content:center;padding:4vh 10px;overflow:auto}' +
    '#csp .cs{background:#fff;color:#1b2433;width:100%;max-width:780px;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden;font-size:12.5px}' +
    '#csp .csh{background:#1a2744;color:#fff;padding:12px 16px;display:flex;gap:10px;align-items:flex-start}' +
    '#csp .csh b{font-size:15px;line-height:1.3;flex:1}#csp .csh small{display:block;font-weight:400;font-size:11.5px;opacity:.8;margin-top:3px}' +
    '#csp .csb{padding:12px 16px}#csp .csg{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px 14px}' +
    '#csp .csg label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#7a8597}#csp .csg span{white-space:pre-wrap;word-break:break-word}' +
    '#csp .csa{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px}#csp .csa .btn{font-size:12px;padding:7px 12px}' +
    '#csp .cst{margin-top:12px;border-top:1px solid #e6e9ef;padding-top:10px}#csp .cst h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7a8597}' +
    '#csp .csw{background:#fff8e6;border:1px solid #f0d48a;border-radius:6px;padding:7px 10px;margin-top:10px}' +
    '#csp .hiitem{padding:5px 0;border-bottom:1px dashed #e3e6ea}' +
    'a.cslink:hover{opacity:.8}';
  document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function f(lbl, v) { return v ? '<div><label>' + lbl + '</label><span>' + v + '</span></div>' : ''; }
  function close() { var o = document.getElementById('csp'); if (o) o.remove(); }
  function stamp(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return esc(iso); return fd(d.toISOString().slice(0, 10)) + ', ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  /* do something that opens another window of the Case Manager: this sheet steps aside */
  function then(fn) { return function () { close(); fn(); }; }

  window.csOpen = function (id) {
    var c = find(id); if (!c) return;
    close();
    var e = c.eco || {}, n = window.ordCounts ? ordCounts(c) : { o: 0, s: 0 };
    var pend = typeof dlPend === 'function' ? dlPend(c) : 0, ln = (c.notes && c.notes.length) ? c.notes[c.notes.length - 1] : null;
    var stl = { active: 'Pending', disposed: 'Disposed' }[c.st || 'active'] || esc(c.st);
    var o = document.createElement('div'); o.id = 'csp';
    var h = '<div class="cs"><div class="csh"><b>' + (window.snH ? snH(c) : '') + esc(ctit(c)) + '<small>' + esc(c.court || '') + (c.cn ? ' &middot; ' + esc(c.cn) : '') + '</small></b>' +
      '<button class="btn bo" data-x style="font-size:11px">&#10005; Close</button></div><div class="csb"><div class="csg">' +
      f('Case no.', esc(c.cn)) + f('CNR', esc(c.cnr)) + f('Court', esc(c.court)) + f('Judge', esc(c.jd || e.judge)) +
      f('Plaintiff / Petitioner', esc(c.pl)) + f('Defendant / Respondent', esc(c.de)) + f('Our client', esc(c.cl)) +
      f('Contact', esc((c.cp || '') + (c.cm ? ' · ' + c.cm : ''))) +
      f('Previous date', c.pd ? fd(c.pd) + (c.ps ? ' — ' + esc(c.ps) : '') : '') +
      '<div><label>Next date</label><span>' + (c.nd ? '<b>' + fd(c.nd) + '</b>' + (c.ns ? ' — ' + esc(c.ns) : '') + (c.nd < td() && isOpen(c) ? ' <span style="color:#b3261e">(passed)</span>' : '') : '<span style="color:#b3261e">none entered</span>') + '</span></div>' +
      f('Status', stl) + f('Office serial no.', c.sn ? esc(c.sn) : '') +
      '<div><label>Fetched from the court</label><span>' + (e.at ? stamp(e.at) + (e.stage ? '<br>Court stage: ' + esc(e.stage) : '') + (e.next ? '<br>Court next date: ' + fd(e.next) : '') : '<span style="color:#b3261e">never</span>') + '</span></div>' +
      '</div>' +
      (e.dispFlag ? '<div class="csw">&#9888; The court site shows this case as <b>disposed</b>' + (e.decision ? ' on ' + fd(e.decision) : '') + (e.disposal ? ' (' + esc(e.disposal) + ')' : '') + '. Mark it disposed in Edit → Status if that is right.</div>' : '') +
      (e.pending ? '<div class="csw">&#9203; When last fetched, the court site had not updated the next date' + (e.next ? ' (still showed ' + fd(e.next) + ')' : '') + '.</div>' : '') +
      (ln ? '<div class="cst"><h4>Latest note</h4>' + esc(ln.text) + ' <span class="mini">' + fd(ln.date) + (ln.by ? ' · ' + esc(ln.by) : '') + '</span></div>' : '') +
      '<div class="csa">' +
      (can('edit') ? '<button class="btn bg" data-a="post">Post next date / note</button><button class="btn bn" data-a="edit">Edit</button>' : '') +
      '<button class="btn bbl" data-a="fetch">&#9878; Fetch now from the court</button>' +
      '<button class="btn bo" data-a="ord">Orders (' + n.o + ') &amp; order sheets (' + n.s + ')' + (pend ? ' &middot; ' + pend + ' to download' : '') + '</button>' +
      (c.hist && c.hist.length ? '<button class="btn bo" data-a="hist">History (' + c.hist.length + ')</button>' : '') +
      '<button class="btn bo" data-a="print">Print</button><button class="btn bo" data-a="all">Show in All Cases</button>' +
      '</div><div id="csfx"></div><div id="cshist" style="display:none" class="cst"><h4>History</h4>' +
      (c.hist || []).slice().reverse().map(function (x) { return '<div class="hiitem"><b>Prev:</b> ' + fd(x.pd) + ' [' + esc(x.ps || '') + '] &rarr; <b>Next:</b> ' + fd(x.nd) + ' [' + esc(x.ns || '') + ']' + (x.note ? '<br><em>' + esc(x.note) + '</em>' : '') + (x.by ? ' <span class="mini">' + esc(x.by) + '</span>' : '') + '</div>'; }).join('') +
      '</div></div></div>';
    o.innerHTML = h;
    document.body.appendChild(o);
    o.addEventListener('click', function (ev) {
      if (ev.target === o || ev.target.closest('[data-x]')) { close(); return; }
      var b = ev.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'post') then(function () { openUpd(id); })();
      else if (a === 'edit') then(function () { editC(id); })();
      else if (a === 'ord') then(function () { ordOpen(id, 'o'); })();
      else if (a === 'print') then(function () { prtC(id); })();
      else if (a === 'hist') { var hh = document.getElementById('cshist'); hh.style.display = hh.style.display === 'none' ? 'block' : 'none'; }
      else if (a === 'all') then(function () {
        go('cases'); var q = document.getElementById('sq'); if (q) { q.value = c.cn || ctit(c); renderC(); }
        setTimeout(function () { var r = [].slice.call(document.querySelectorAll('[id="cr-' + id + '"]')).filter(function (x) { return x.offsetParent; })[0]; if (r) { r.classList.add('open'); r.scrollIntoView({ block: 'center' }); } }, 60);
      })();
      else if (a === 'fetch') fetchHere(id);
    });
  };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && document.getElementById('csp') && !document.querySelector('#csp input:focus')) close(); });

  function fetchHere(id) {
    var c = find(id), box = document.getElementById('csfx'); if (!c || !box) return;
    var cnrOk = typeof ecoOk === 'function' && ecoOk(c), trib = window.trKind && trKind(c);
    if (!cnrOk && !trib) {
      /* no CNR yet: find it first (one CAPTCHA), then come back here and fetch */
      if (isHC(c) && !/supreme/i.test(c.court || '') && window.trHcFind) { close(); trHcFind(id); return; }
      if (window.trDcFind) { close(); window.DC_AFTER = { id: id, fn: function () { setTimeout(function () { csOpen(id); fetchHere(id); }, 200); } }; trDcFind(id); return; }
      box.innerHTML = '<div class="csw">This case has no CNR number — add it in Edit.</div>'; return;
    }
    if (typeof cmUpdateCase !== 'function') { box.innerHTML = '<div class="csw">Reload the page once and try again.</div>'; return; }
    box.style.marginTop = '10px';
    cmUpdateCase(id, box).then(function () {
      setTimeout(function () { try { refresh(); } catch (x) {} var done = box.innerHTML; csOpen(id); var nb = document.getElementById('csfx'); if (nb) { nb.style.marginTop = '10px'; nb.innerHTML = done; } }, 1500);
    }).catch(function () {});
  }
})();
