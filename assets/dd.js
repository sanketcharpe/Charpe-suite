/* Grouped buttons (Nov 2026): several related buttons become one button that opens a short
   menu of choices. The original buttons are moved into the menu as they are, so every click
   does exactly what it did before. Used by the Case Manager and Billing. */
(function () {
  'use strict';
  if (window.DD) return;
  var st = document.createElement('style');
  st.textContent =
    '.dd{position:relative;display:inline-flex}.dd>summary{list-style:none;cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:6px}.dd>summary::-webkit-details-marker{display:none}' +
    '.dd>summary .ddc{font-size:.8em;opacity:.75;transition:transform .15s}.dd[open]>summary .ddc{transform:rotate(180deg)}' +
    '.ddm{position:absolute;top:calc(100% + 6px);left:0;z-index:9000;min-width:210px;background:#fff;border:1px solid #d5dbe4;border-radius:10px;box-shadow:0 14px 34px rgba(16,24,40,.2);padding:6px;display:flex;flex-direction:column;gap:2px;animation:ddin .12s ease-out}' +
    '.ddm.r{left:auto;right:0}@keyframes ddin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '.ddm>*{width:100%!important;margin:0!important;text-align:left!important;justify-content:flex-start!important;box-sizing:border-box}' +
    '.ddm>.btn,.ddm>button{background:transparent!important;color:#1b2433!important;border:1px solid transparent!important;box-shadow:none!important;font-weight:500!important;padding:8px 11px!important;border-radius:7px!important;white-space:nowrap}' +
    '.ddm>.btn:hover,.ddm>button:hover{background:#eef3fb!important;border-color:#d7e3f5!important}' +
    '.ddm>button.on{background:#1a2744!important;color:#fff!important}' +
    '.ddm>[hidden]{display:none!important}' +
    '.ddm .ddh{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#7a8597;padding:6px 10px 2px}' +
    '@media print{.dd{display:none!important}}';
  document.head.appendChild(st);

  function closeAll(except) {
    Array.prototype.forEach.call(document.querySelectorAll('details.dd[open]'), function (d) { if (d !== except && !d.contains(except)) d.open = false; });
  }
  document.addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('details.dd');
    closeAll(d);
    if (d && e.target.closest('.ddm') && e.target.closest('button,a,.btn')) setTimeout(function () { d.open = false; }, 0);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
  /* only one menu open at a time */
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!(d.matches && d.matches('details.dd')) || !d.open) return;
    closeAll(d); place(d);
  }, true);
  /* the menu floats above everything (fixed), so a scrolling table or a narrow side panel never cuts it off */
  function place(d) {
    var s = d.querySelector('summary'), m = d.querySelector('.ddm'); if (!s || !m) return;
    var r = s.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    m.style.position = 'fixed'; m.style.top = '0px'; m.style.left = '0px'; m.style.right = 'auto';
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var left = m.classList.contains('r') ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, vw - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > vh - 8 && r.top - mh - 6 > 8) top = r.top - mh - 6;
    m.style.left = left + 'px'; m.style.top = top + 'px';
  }
  window.addEventListener('scroll', function (e) {
    if (e.target && e.target.closest && e.target.closest('.ddm')) return;
    closeAll(null);
  }, true);
  window.addEventListener('resize', function () { closeAll(null); });

  /* group(o): o.items — the buttons (elements) to move into one menu, in order;
     o.label — the text of the new button; o.cls — its class; o.right — open the menu to the left;
     o.before — put the new button here (default: where the first item was). */
  function group(o) {
    var items = (o.items || []).filter(Boolean);
    if (!items.length) return null;
    var first = o.before || items[0];
    var d = document.createElement('details'); d.className = 'dd' + (o.dcls ? ' ' + o.dcls : '');
    if (o.id) d.id = o.id;
    var s = document.createElement('summary'); s.className = o.cls || ''; s.title = o.title || '';
    s.innerHTML = o.label + ' <span class="ddc">▾</span>';
    var m = document.createElement('div'); m.className = 'ddm' + (o.right ? ' r' : '');
    d.appendChild(s); d.appendChild(m);
    first.parentNode.insertBefore(d, first);
    items.forEach(function (b) { m.appendChild(b); });
    return d;
  }
  window.DD = { group: group, closeAll: closeAll };
})();
