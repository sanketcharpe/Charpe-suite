/* Charpe Suite app — put into every Charpe Suite page and frame before its own code runs.
   Whatever the page sends to Charpe Helper (http://127.0.0.1:8770/) is answered by the
   phone's own engine instead (assets/native-net.js on the site), which fetches the court
   sites through the app. Everything else the page does is left exactly as it is. */
(function () {
  if (window.__charpeWrap) return;
  window.__charpeWrap = 1;
  window.CharpeIsApp = true;
  var HELPER = /^https?:\/\/(127\.0\.0\.1|localhost):8770(\/|$)/;
  var seg = (location.pathname.split('/')[1] || '');
  var BASE = 'https://sanketcharpe.github.io/' + (/^charpe-suite$/i.test(seg) ? seg : 'Charpe-suite') + '/';
  var orig = window.fetch, engP = null;

  function engine() {
    if (window.CharpeEngine) return Promise.resolve(window.CharpeEngine);
    if (engP) return engP;
    engP = new Promise(function (res, rej) {
      function go() {
        var s = document.createElement('script');
        s.src = BASE + 'assets/native-net.js?v=' + Math.floor(Date.now() / 3600000);
        s.onload = function () { window.CharpeEngine ? res(window.CharpeEngine) : rej(new Error('Failed to fetch')); };
        s.onerror = function () { engP = null; rej(new Error('Failed to fetch')); };
        (document.head || document.documentElement).appendChild(s);
      }
      if (document.documentElement) go(); else document.addEventListener('DOMContentLoaded', go);
    });
    return engP;
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!HELPER.test(url)) return orig.apply(this, arguments);
    var method = (init && init.method || 'GET').toUpperCase();
    var body = method === 'GET' ? '{"action":"ping"}' : (init && init.body) || '{}';
    return engine().then(function (E) {
      var b;
      try { b = JSON.parse(body); } catch (e) { b = {}; }
      return E.handle(b);
    }).then(function (obj) {
      return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  };
})();
