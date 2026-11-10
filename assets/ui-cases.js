/* Case Manager — a calmer top bar (Nov 2026).
   Dashboard · All Cases · Unupdated · Calendar · Tasks stay in view; the court pages and the
   occasional pages open from two menus. Every page and every button works as before. */
(function () {
  'use strict';
  var st = document.createElement('style');
  st.textContent =
    'nav .dd>summary{background:#2b3d68;border:1px solid #42568c;color:#fff;padding:7px 15px;border-radius:7px;font-size:12px;font-weight:600;box-shadow:0 2px 0 #0d1630;transition:background .12s}' +
    'nav .dd>summary:hover{background:#3a5089;border-color:#5a70a8}' +
    'nav .dd:has(.ddm button.on)>summary{background:#b8932a;color:#1a2744;border-color:#e8c96a;box-shadow:0 2px 0 #7a5f14}' +
    'nav .dd:has(.navbdg[style*="inline"])>summary::after{content:"";width:7px;height:7px;border-radius:50%;background:#e05a4a;margin-left:2px}' +
    '.ddm>.btn,.ddm>button{font-size:12.5px!important}nav .ddm>button{font-size:12.5px!important}nav .ddm>button.on{background:#b8932a!important;color:#1a2744!important}' +
    'nav .ddm .navbdg{float:right}' +
    'nav button,nav .dd>summary{transition:background .15s,border-color .15s,transform .05s}' +
    '#todacts .dd>summary,#casesacts .dd>summary{display:inline-flex}' +
    'table.board td.act .dd{display:block}table.board td.act .dd>summary{display:block;text-align:center;width:100%;margin:0;font-size:13px;line-height:1;padding:3px 5px;box-sizing:border-box}' +
    'table.board td.act:has(details[open]){z-index:30}' +
    '.card{transition:box-shadow .2s}.card:hover{box-shadow:0 2px 10px rgba(26,39,68,.08)}';
  document.head.appendChild(st);

  function page(p) { return document.querySelector('#nav > button[data-page="' + p + '"]'); }
  function build() {
    var nav = document.getElementById('nav');
    if (!nav || !window.DD) return false;
    if (!page('sync') && !document.getElementById('ddCourts')) return false;   /* court pages not added yet */
    if (!document.getElementById('ddCourts')) {
      DD.group({ id: 'ddCourts', label: '&#9878; Courts', title: 'Sync Centre, Search Courts', items: [page('sync'), page('search')], before: page('cal') || page('sync') });
    }
    if (!document.getElementById('ddMore')) {
      var more = DD.group({ id: 'ddMore', label: 'More', title: 'Planner, Reports, Deleted, Settings', right: true, items: [page('plan'), page('reports'), page('deleted'), page('sett')] });
      if (more) nav.appendChild(more);
    }
    /* Calendar, Tasks before the menus */
    var cal = page('cal'), tasks = page('tasks'), courts = document.getElementById('ddCourts');
    if (courts && cal) nav.insertBefore(cal, courts);
    if (courts && tasks) nav.insertBefore(tasks, courts);
    return true;
  }
  function tryBuild(n) { if (!build() && n > 0) setTimeout(function () { tryBuild(n - 1); }, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { tryBuild(30); });
  else tryBuild(30);
})();
