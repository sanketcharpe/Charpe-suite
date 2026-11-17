/* Charpe Suite — Modern view switch (Nov 2026).
   Modern view is the default; "Classic view" brings back the earlier look at once.
   The choice is remembered on this computer. Only the look changes — every page and button is the same. */
(function () {
  'use strict';
  var KEY = 'cs_ui_view';
  function get() { try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'modern'; } catch (e) { return 'modern'; } }
  function label() {
    var b = document.getElementById('uiTgl'); if (!b) return;
    var m = get() === 'modern';
    b.innerHTML = m ? '&#8634; Classic view' : '&#10024; Modern view';
    b.title = m ? 'Switch back to the earlier look' : 'Switch to the new dashboard look';
  }
  function apply() { document.documentElement.classList.toggle('ui-modern', get() === 'modern'); label(); }
  apply();   /* before the page is drawn, so there is no flash of the other look */

  window.uiToggle = function () {
    try { localStorage.setItem(KEY, get() === 'modern' ? 'classic' : 'modern'); } catch (e) {}
    apply();
    if (typeof window.toast === 'function') { try { toast(get() === 'modern' ? 'Modern view' : 'Classic view'); } catch (e) {} }
  };

  function addButton() {
    var hr = document.querySelector('header .hright');
    if (!hr) return false;
    if (!document.getElementById('uiTgl')) {
      var b = document.createElement('button');
      b.id = 'uiTgl'; b.type = 'button'; b.className = 'btn bo'; b.style.padding = '3px 8px';
      b.onclick = window.uiToggle;
      hr.insertBefore(b, hr.firstChild);
    }
    label();
    return true;
  }
  function tryAdd(n) { if (!addButton() && n > 0) setTimeout(function () { tryAdd(n - 1); }, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { tryAdd(20); });
  else tryAdd(20);

  /* another tab or the other PC's sync changed the choice */
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
})();
