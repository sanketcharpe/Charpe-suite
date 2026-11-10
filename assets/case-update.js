/* One case, fetched afresh from the court — for Billing (letters) and Excerpt Desk (Nov 2026).
   cmCaseInfo(id)        what the Case Manager has: the case, its orders, and when it was last fetched
   cmFindCases(text)     cases whose number (or parties) appear in a text — a letter, a file name
   cmUpdateCase(id, el)  fetch the case and its orders now; the CAPTCHA (district courts, High Court)
                         is shown inside `el`, which may sit in the page that asked (Billing, Excerpt Desk).
                         Supreme Court, CAT and MAT need no CAPTCHA. Resolves when the orders are saved. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function cnr(c) { return String(c && c.cnr || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function kindOf(c) {
    if (window.trKind && trKind(c)) return 'tribunal';
    if (typeof ecoOk === 'function' && ecoOk(c)) return 'captcha';
    return 'none';
  }
  function stamp(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  window.cmCaseInfo = function (id) {
    var c = find(id); if (!c) return null;
    var k = kindOf(c), e = c.eco || {};
    var list = window.ordListFor ? ordListFor(id) : [];
    return {
      id: c.id, cn: c.cn || '', title: ctit(c), court: c.court || '', cl: c.cl || '', nd: c.nd || '', ns: c.ns || '', st: c.st || '', cnr: cnr(c),
      at: e.at || '', atText: stamp(e.at), kind: k,
      why: k === 'none' ? (cnr(c) ? 'This court is not one the tool can fetch from.' : 'No CNR number is saved for this case — add it in the Case Manager (Edit) first.') : '',
      orders: list, pending: list.filter(function (o) { return !o.ok && !o.none; }).length
    };
  };
  window.cmCases = function () {
    return LC().map(function (c) { return { id: c.id, cn: c.cn || '', title: ctit(c), court: c.court || '', cl: c.cl || '' }; });
  };

  /* "O.A. No. 297 of 2026", "OA 297/2026", "W.P. 3692/2026" … → type letters + number + year */
  function refs(t) {
    var out = [], re = /([A-Za-z][A-Za-z.()\s]{0,22}?)\s*(?:No\.?\s*)?(\d{1,6})\s*(?:\/|of|-)\s*((?:19|20)\d{2})/gi, m;
    t = String(t || '');
    while ((m = re.exec(t))) out.push({ ty: m[1].toLowerCase().replace(/\b(no|nos|in|and|the|case|matter|of)\b/g, '').replace(/[^a-z]/g, ''), no: +m[2], yr: m[3] });
    return out;
  }
  window.cmFindCases = function (text) {
    var want = refs(text); if (!want.length) return [];
    var hits = [];
    LC().forEach(function (c) {
      var have = refs(c.cn);
      var score = 0;
      have.forEach(function (h) {
        want.forEach(function (w) {
          if (h.no !== w.no || h.yr !== w.yr) return;
          var s = 2;
          if (h.ty && w.ty && (h.ty === w.ty || h.ty.indexOf(w.ty) >= 0 || w.ty.indexOf(h.ty) >= 0)) s = 3;
          else if (h.ty && w.ty) s = 1;
          if (s > score) score = s;
        });
      });
      if (score) hits.push({ id: c.id, cn: c.cn || '', title: ctit(c), court: c.court || '', score: score });
    });
    return hits.sort(function (a, b) { return b.score - a.score; });
  };

  /* ---------- fetching ---------- */
  function box(el) {
    el.innerHTML = '<div style="border:1px solid #c9d3e3;border-radius:8px;padding:10px 12px;background:#f6f9fe;font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#1b2433">' +
      '<div data-cm="msg">Starting…</div><div data-cm="cap" style="display:none;margin-top:8px;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<img data-cm="img" alt="CAPTCHA" title="Click for a new picture" style="height:44px;border:1px solid #c9d3e3;border-radius:4px;background:#fff;cursor:pointer">' +
      '<input data-cm="in" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8" placeholder="Type it" style="width:110px;font:600 16px/1 monospace;padding:8px;border:1px solid #9fb2d0;border-radius:6px">' +
      '<button data-cm="go" type="button" style="padding:8px 14px;border:0;border-radius:6px;background:#1668e3;color:#fff;font-weight:600;cursor:pointer">Fetch</button></div>' +
      '<div data-cm="bar" style="display:none;height:6px;background:#dde6f3;border-radius:3px;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:0;background:#1668e3;transition:width .3s"></i></div></div>';
    var q = function (k) { return el.querySelector('[data-cm="' + k + '"]'); };
    return {
      msg: function (t, col) { var m = q('msg'); m.innerHTML = t; m.style.color = col || '#1b2433'; },
      cap: function (on) { q('cap').style.display = on ? 'flex' : 'none'; },
      img: q('img'), inp: q('in'), go: q('go'),
      bar: function (p) { q('bar').style.display = p == null ? 'none' : 'block'; q('bar').firstChild.style.width = Math.max(3, p || 0) + '%'; }
    };
  }
  function waitLane(sid, ui) {
    return new Promise(function (res) {
      var t = setInterval(function () {
        var L = ECO.lanes && ECO.lanes[sid];
        if (!L) { clearInterval(t); res(); return; }
        ui.msg('Downloading the orders and the proceedings of each date… ' + L.done + ' of ' + L.total);
        ui.bar(L.total ? L.done / L.total * 100 : 5);
      }, 600);
    });
  }
  function count(id) { return (window.ordListFor ? ordListFor(id) : []).filter(function (o) { return o.ok; }).length; }

  window.cmUpdateCase = function (id, el) {
    var c = find(id);
    if (!c) return Promise.reject(new Error('The case is not in the Case Manager.'));
    var ui = box(el), k = kindOf(c), before = count(id);
    function done() {
      try { ECO.api.saveNow(); } catch (e) { try { saveAll(); } catch (x) {} }
      var after = count(id), e = (find(id) || {}).eco || {};
      ui.cap(false); ui.bar(null);
      ui.msg('&#10003; Updated ' + esc(stamp(e.at || new Date().toISOString())) + ' — ' + after + ' order' + (after === 1 ? '' : 's') + ' on record' + (after > before ? ' (' + (after - before) + ' new)' : '') + '.', '#127a4b');
      return { before: before, after: after, at: e.at || '' };
    }
    if (k === 'none') { ui.msg(esc(cmCaseInfo(id).why), '#a35b00'); return Promise.reject(new Error(cmCaseInfo(id).why)); }
    if (k === 'tribunal') {
      ui.msg('Fetching from the court site (no CAPTCHA needed for this court)…'); ui.bar(20);
      return Promise.resolve(trUpdate([c])).then(function () {
        /* the orders of these courts are downloaded in the same go; give the last save a moment */
        return new Promise(function (r) { setTimeout(r, 900); });
      }).then(done);
    }
    var cfg = ECO.api.cfg();
    if (!cfg.url || !cfg.tok) { ui.msg('The eCourts backend is not set up: Case Manager → Settings → Official eCourts.', '#b3261e'); return Promise.reject(new Error('eCourts backend not set up')); }
    var num = cnr(c), sid = null;
    return new Promise(function (resolve, reject) {
      function picture(fresh) {
        ui.msg('Opening eCourts for ' + esc(c.cn || num) + '…'); ui.cap(false);
        var p = (fresh || !sid) ? ECO.api.post({ action: 'start', cnrs: [num] }).then(function (x) { return (x.rows || [])[0] || { err: 'No answer from eCourts' }; })
                                : ECO.api.post({ action: 'captcha', sid: sid, cnr: num });
        return p.then(function (x) {
          if (x.err || !x.img) { ui.msg('eCourts did not give a CAPTCHA: ' + esc(x.err || 'no picture') + ' <a href="#" data-cm="again">Try again</a>', '#b3261e'); var a = el.querySelector('[data-cm="again"]'); if (a) a.onclick = function (e) { e.preventDefault(); picture(true); }; return; }
          sid = x.sid; ui.img.src = x.img; ui.inp.value = ''; ui.cap(true);
          ui.msg('Type the characters in the picture and press <b>Enter</b>. Click the picture for a new one.');
          try { ui.inp.focus(); } catch (e) {}
        }).catch(function (e) { ui.msg('Could not reach eCourts: ' + esc(e.message || e) + ' <a href="#" data-cm="again">Try again</a>', '#b3261e'); var a = el.querySelector('[data-cm="again"]'); if (a) a.onclick = function (ev) { ev.preventDefault(); picture(true); }; });
      }
      function go() {
        var t = ui.inp.value.trim(); if (!t) { ui.inp.focus(); return; }
        ui.go.disabled = true; ui.msg('Searching eCourts…');
        ECO.api.post({ action: 'search', sid: sid, cnr: num, captcha: t }).then(function (r) {
          ui.go.disabled = false;
          if (r.expired) { ui.msg('That picture expired — here is a new one.', '#a35b00'); return picture(true); }
          if (r.bad) { if (r.img) { ui.img.src = r.img; ui.inp.value = ''; ui.inp.focus(); } else picture(false); ui.msg('Wrong CAPTCHA — type the new picture.', '#b3261e'); return; }
          if (r.notFound) { ui.cap(false); ui.msg('eCourts has no case for CNR ' + esc(num) + '.', '#b3261e'); reject(new Error('Not found on eCourts')); return; }
          ui.cap(false);
          ECO.api.apply(id, r.data);
          ECO.api.queueCase(id, sid, -1);
          ui.msg('Case details saved. Downloading the orders…'); ui.bar(5);
          return waitLane(sid, ui).then(function () { resolve(done()); });
        }).catch(function (e) { ui.go.disabled = false; ui.msg('Could not fetch: ' + esc(e.message || e), '#b3261e'); });
      }
      ui.go.onclick = go;
      ui.inp.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } };
      ui.img.onclick = function () { picture(false); };
      try { ECO.api.dirReady(false); } catch (e) {}
      picture(true);
    });
  };
})();
