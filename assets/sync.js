/* ============================================================================
   Charpe Suite — Google Drive sync client
   ----------------------------------------------------------------------------
   Talks to a Google Apps Script web app that you deploy yourself, pointed at a
   single Drive folder. Every request carries a shared secret; the script does
   nothing without it. Nothing here touches any Google API directly, so this app
   never holds a Google credential and can never reach the rest of your Drive.

   Wire format (POST, text/plain so the browser skips a CORS preflight):
     { token, action, ... }
   Actions: ping | pull | push | file | list | history
   ========================================================================== */
(function (global) {
  'use strict';

  var CFG_KEY   = '__charpe_sync_cfg';
  var META_KEY  = '__charpe_sync_meta';
  var SKIP      = [CFG_KEY, META_KEY];          // never travel in a snapshot
  var SCHEMA    = 1;

  /* ---------------------------------------------------------------- config */

  function cfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setCfg(next) {
    var merged = Object.assign(cfg(), next);
    localStorage.setItem(CFG_KEY, JSON.stringify(merged));
    return merged;
  }
  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setMeta(next) {
    localStorage.setItem(META_KEY, JSON.stringify(Object.assign(meta(), next)));
  }
  function configured() {
    var c = cfg();
    return !!(c.url && c.token);
  }

  /* -------------------------------------------------------------- snapshot */

  /* Everything both tools keep in localStorage, minus our own bookkeeping.
     Deliberately generic: a key added to either tool later syncs with no
     change needed here. */
  function snapshot() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || SKIP.indexOf(k) >= 0) continue;
      if (k.charAt(0) === '_' && k.indexOf('__charpe') === 0) continue;
      data[k] = localStorage.getItem(k);
    }
    return {
      schema: SCHEMA,
      device: deviceName(),
      savedAt: new Date().toISOString(),
      keys: Object.keys(data).length,
      data: data
    };
  }

  function restore(payload, opts) {
    opts = opts || {};
    if (!payload || !payload.data) throw new Error('That backup has no data in it.');
    if (payload.schema > SCHEMA) {
      throw new Error('That backup was written by a newer version of the app.');
    }
    if (!opts.merge) {
      // Clear only the tools' keys; leave sync config alone so we stay connected.
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && SKIP.indexOf(k) < 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    }
    Object.keys(payload.data).forEach(function (k) {
      if (SKIP.indexOf(k) >= 0) return;
      localStorage.setItem(k, payload.data[k]);
    });
    return Object.keys(payload.data).length;
  }

  function deviceName() {
    var c = cfg();
    if (c.device) return c.device;
    var ua = navigator.userAgent || '';
    var guess = /Android/i.test(ua) ? 'Android phone'
              : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad'
              : /Windows/i.test(ua) ? 'Windows laptop'
              : /Mac/i.test(ua) ? 'Mac'
              : 'This device';
    setCfg({ device: guess });
    return guess;
  }

  /* Rough measure of how much room the tools are using. */
  function usedBytes() {
    var n = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      n += (k || '').length + (localStorage.getItem(k) || '').length;
    }
    return n * 2; // UTF-16
  }

  /* --------------------------------------------------------------- network */

  function call(action, body, timeoutMs) {
    var c = cfg();
    if (!c.url || !c.token) {
      return Promise.reject(new Error('Sync is not set up yet — add the web app URL and secret.'));
    }
    var payload = Object.assign({ token: c.token, action: action }, body || {});
    var ctrl = ('AbortController' in global) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 45000) : null;

    return fetch(c.url, {
      method: 'POST',
      // text/plain keeps the request "simple" so no OPTIONS preflight is sent —
      // Apps Script web apps cannot answer a preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        return r.text().then(function (txt) {
          if (!r.ok) throw new Error('The script replied ' + r.status + '. ' + hint(r.status));
          var json;
          try { json = JSON.parse(txt); }
          catch (e) {
            throw new Error(
              'The reply was not readable. Check the deployment is set to ' +
              '"Execute as: Me" and "Who has access: Anyone".'
            );
          }
          if (json.ok === false) throw new Error(json.error || 'The script refused the request.');
          return json;
        });
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error('The script did not answer in time.');
        if (e instanceof TypeError) {
          throw new Error(
            'Could not reach the script. Check you are online and that the URL ends in /exec.'
          );
        }
        throw e;
      });
  }

  function hint(status) {
    if (status === 401 || status === 403) return 'That usually means the secret does not match.';
    if (status === 404) return 'Check the URL — it should end in /exec.';
    return '';
  }

  /* ----------------------------------------------------------------- verbs */

  function ping() {
    return call('ping', {}, 20000).then(function (r) {
      setMeta({ lastPing: Date.now(), folder: r.folder || '' });
      return r;
    });
  }

  function push() {
    var snap = snapshot();
    return call('push', { payload: snap }).then(function (r) {
      setMeta({
        lastPush: Date.now(),
        lastSync: Date.now(),
        remoteStamp: r.savedAt || snap.savedAt,
        backups: r.backups
      });
      return Object.assign({ keys: snap.keys }, r);
    });
  }

  function pull() {
    return call('pull').then(function (r) {
      if (!r.payload) throw new Error('There is nothing in the Drive folder yet — push first.');
      return r.payload;
    });
  }

  function applyPull(payload, merge) {
    var n = restore(payload, { merge: !!merge });
    setMeta({ lastPull: Date.now(), lastSync: Date.now(), remoteStamp: payload.savedAt });
    return n;
  }

  /* Upload a generated file (invoice PDF, Excel export) into the Drive folder. */
  function putFile(name, mime, bytes) {
    return call('file', { name: name, mime: mime, b64: toB64(bytes) });
  }

  function listFiles() { return call('list'); }
  function history()   { return call('history'); }

  function toB64(bytes) {
    if (typeof bytes === 'string') return btoa(unescape(encodeURIComponent(bytes)));
    var u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    var out = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(out);
  }

  /* ------------------------------------------------- background auto-sync */

  var pending = null;

  function nudge() {
    var c = cfg();
    if (!c.auto || !configured()) return;
    if (!navigator.onLine) return;
    clearTimeout(pending);
    pending = setTimeout(function () {
      push()
        .then(function () { emit('auto-ok'); })
        .catch(function (e) { emit('auto-fail', e.message); });
    }, 6000); // settle after the user stops typing
  }

  var listeners = [];
  function on(fn) { listeners.push(fn); }
  function emit(kind, detail) {
    listeners.forEach(function (fn) { try { fn(kind, detail); } catch (e) {} });
  }

  global.addEventListener('online', function () { nudge(); });

  global.CharpeSync = {
    cfg: cfg, setCfg: setCfg, meta: meta, setMeta: setMeta, configured: configured,
    snapshot: snapshot, restore: restore, usedBytes: usedBytes, deviceName: deviceName,
    ping: ping, push: push, pull: pull, applyPull: applyPull,
    putFile: putFile, listFiles: listFiles, history: history,
    nudge: nudge, on: on, emit: emit, SKIP: SKIP
  };
})(window);
