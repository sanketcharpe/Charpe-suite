/* Charpe Suite — small CAPTCHA keyboard (Nov 2026)
   Whenever a CAPTCHA box gets the cursor (the eCourts screen, the per-case Fetch box, High Court / District
   search, Search Courts), a compact keyboard of 0-9 and a-z appears at the foot of the screen. Its keys type into
   that box exactly as the PC keyboard would, so Enter / Next still jumps to the next case.
   "Phone keyboard off" (remembered on this device) stops the phone's own keyboard covering the screen. */
(function () {
  'use strict';
  var KEY = 'charpe_capkbd';
  function pref() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setPref(k, v) { var p = pref(); p[k] = v; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

  /* which inputs are CAPTCHA boxes */
  function isCap(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var id = el.id || '';
    if (/^ecoin\d+$/.test(id) || id === 'hcqC' || id === 'dcqC' || id === 'srCap') return true;
    if (el.getAttribute('data-cm') === 'in') return true;
    if (el.getAttribute('data-captcha') != null) return true;
    return /captcha/i.test(el.getAttribute('placeholder') || '');
  }

  var cur = null, shift = false, box = null;

  function css() {
    if (document.getElementById('capkbdcss')) return;
    var s = document.createElement('style'); s.id = 'capkbdcss';
    s.textContent =
      '#capkbd{position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:2147483000;background:#eef2f8;border:1px solid #b8c6dc;' +
      'border-radius:8px;box-shadow:0 4px 18px rgba(20,40,80,.25);padding:5px 6px 6px;font:12px system-ui,Segoe UI,Arial,sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;max-width:98vw}' +
      '#capkbd .kr{display:flex;justify-content:center;gap:3px;margin-top:3px}' +
      '#capkbd button{min-width:26px;height:28px;padding:0 4px;border:1px solid #a9b8cf;border-radius:4px;background:#fff;color:#111;font:600 13px/1 Consolas,monospace;cursor:pointer}' +
      '#capkbd button:active{background:#d6e4fb}' +
      '#capkbd button.w{font:600 11px system-ui,Segoe UI,Arial,sans-serif;padding:0 7px;background:#f7f9fc}' +
      '#capkbd button.go{background:#1668e3;border-color:#1668e3;color:#fff}' +
      '#capkbd button.on{background:#1a2744;border-color:#1a2744;color:#fff}' +
      '#capkbd .kh{display:flex;align-items:center;gap:8px;font-size:10.5px;color:#445}' +
      '#capkbd .kh label{display:flex;align-items:center;gap:3px;cursor:pointer}' +
      '#capkbd .kh .x{margin-left:auto;min-width:22px;height:20px;font-size:11px}' +
      'body.capkbd-on{padding-bottom:var(--kbh,0px)}body.capkbd-on #ecob .ep{max-height:calc(100vh - 36px - var(--kbh,0px))}' +
      '@media (max-width:420px){#capkbd button{min-width:24px;height:30px;font-size:13px;padding:0 2px}#capkbd .kr{gap:2px}}';
    document.head.appendChild(s);
  }

  var ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function build() {
    css();
    box = document.createElement('div'); box.id = 'capkbd';
    var p = pref();
    var h = '<div class="kh"><b>&#9000; CAPTCHA keyboard</b>' +
      '<label title="Stop the phone or tablet keyboard from opening over the screen"><input type="checkbox" data-k="nophone"' + (p.nophone ? ' checked' : '') + '> phone keyboard off</label>' +
      '<button class="w x" data-k="hide" title="Hide (it comes back on the next CAPTCHA box)">&#10005;</button></div>';
    ROWS.forEach(function (r, i) {
      h += '<div class="kr">' + r.split('').map(function (ch) { return '<button data-c="' + ch + '">' + ch + '</button>'; }).join('') +
        (i === 3 ? '<button class="w" data-k="bs" title="Delete one character">&#9003;</button>' : '') + '</div>';
    });
    h += '<div class="kr"><button class="w" data-k="shift" title="Capital letters">&#8679; ABC</button>' +
      '<button class="w" data-k="clr" title="Clear this box">Clear</button>' +
      '<button class="w go" data-k="next" title="Same as pressing Enter: next case">Next &#8629;</button></div>';
    box.innerHTML = h;
    /* keep the cursor in the CAPTCHA box: never let the keys take focus */
    box.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') e.preventDefault(); });
    box.addEventListener('touchstart', function (e) { var b = e.target.closest('button'); if (b) { e.preventDefault(); press(b); } }, { passive: false });
    box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) press(b); });
    box.addEventListener('change', function (e) {
      if (e.target.getAttribute('data-k') === 'nophone') { setPref('nophone', e.target.checked); phoneMode(cur); if (cur) { cur.blur(); cur.focus(); } }
    });
    document.body.appendChild(box);
  }
  function paintShift() {
    if (!box) return;
    [].forEach.call(box.querySelectorAll('button[data-c]'), function (b) { var c = b.getAttribute('data-c'); b.textContent = shift ? c.toUpperCase() : c; });
    var s = box.querySelector('[data-k="shift"]'); if (s) s.className = 'w' + (shift ? ' on' : '');
  }
  function phoneMode(el) {
    if (!el) return;
    if (pref().nophone) el.setAttribute('inputmode', 'none'); else el.removeAttribute('inputmode');
  }
  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
  function press(b) {
    var el = cur;
    var k = b.getAttribute('data-k'), c = b.getAttribute('data-c');
    if (k === 'hide') { hide(true); return; }
    if (k === 'shift') { shift = !shift; paintShift(); return; }
    if (!el || !document.body.contains(el) || el.disabled) { el = cur = null; return; }
    var v = el.value, s = el.selectionStart == null ? v.length : el.selectionStart, e = el.selectionEnd == null ? v.length : el.selectionEnd;
    if (c) {
      var ch = shift ? c.toUpperCase() : c, max = el.maxLength > 0 ? el.maxLength : 99;
      if (v.length - (e - s) >= max) return;
      el.value = v.slice(0, s) + ch + v.slice(e); setCaret(el, s + 1); fire(el);
    } else if (k === 'bs') {
      if (s !== e) { el.value = v.slice(0, s) + v.slice(e); setCaret(el, s); }
      else if (s > 0) { el.value = v.slice(0, s - 1) + v.slice(s); setCaret(el, s - 1); }
      fire(el);
    } else if (k === 'clr') { el.value = ''; fire(el); }
    else if (k === 'next') {
      var ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return;   /* Enter moves the cursor to the next case: do not pull it back */
    }
    if (document.activeElement !== el && document.body.contains(el)) { try { el.focus({ preventScroll: true }); } catch (x) {} }
  }
  function setCaret(el, n) { try { el.setSelectionRange(n, n); } catch (e) {} }

  var hiddenFor = null;   /* the box the user closed the keyboard on: it stays away until another box is used */
  function show(el) {
    cur = el; phoneMode(el);
    if (hiddenFor === el) return;
    hiddenFor = null;
    if (!box) build();
    box.style.display = '';
    paintShift();
    /* leave room for the keyboard, and keep the box being typed in above it */
    var kh = box.offsetHeight + 12;
    document.body.style.setProperty('--kbh', kh + 'px'); document.body.classList.add('capkbd-on');
    setTimeout(function () { try { var rc = el.getBoundingClientRect(); if (rc.bottom > window.innerHeight - kh || rc.top < 0) el.scrollIntoView({ block: 'center' }); } catch (x) {} }, 30);
  }
  function hide(byUser) { if (byUser) hiddenFor = cur; if (box) box.style.display = 'none'; document.body.classList.remove('capkbd-on'); }

  document.addEventListener('focusin', function (e) {
    if (isCap(e.target)) show(e.target);
    else if (box && !box.contains(e.target)) hide(false);
  });
  /* a CAPTCHA box that disappears (screen closed, case fetched) takes the keyboard with it */
  setInterval(function () {
    if (box && box.style.display !== 'none' && cur && (!document.body.contains(cur) || !cur.offsetParent)) {
      var a = document.activeElement;
      if (isCap(a) && a.offsetParent) { cur = a; return; }
      hide(false); cur = null;
    }
  }, 700);
  /* inputs created already focused (the screen opens with the cursor in the first box) */
  setTimeout(function () { var a = document.activeElement; if (isCap(a)) show(a); }, 0);
  window.capKbdShow = function () { var a = document.activeElement; hiddenFor = null; if (isCap(a)) show(a); else { var f = document.querySelector('#ecorows input:not([disabled])'); if (f) f.focus(); } };
})();
