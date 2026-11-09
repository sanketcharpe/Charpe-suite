/* ============================================================================
   Charpe Billing — Auto Invoice and Auto Letter by voice                Nov 2026
   ----------------------------------------------------------------------------
   🎙 Auto invoice  Say the case ("Prepare invoice for O.A. 297 of 2026, Gondnale,
                    CAT Nagpur"). The case is found in the Case Manager; the bill
                    opens with the next number, the parties and the addressee of
                    earlier bills. For CAT matters the orders show alongside as one
                    PDF. Then say what happened on which date: effective hearings
                    at the effective rate, the rest at the non-effective rate —
                    for CAT, at most 5 non-effective hearings in the whole case,
                    counted across every earlier bill. Expenses come in as a
                    heading with the description below, as on your bills.
   🎙 Auto letter   General letter, or a letter with a bill: say what it should
                    say; it is laid out on the letterhead in the usual way.
   📋 Instructions  Standing instructions (1, 2, 3 …) followed every time.
   ⚙ AI            Gemini (default) or Claude, chosen each time; Gemini also
                    listens to the recording. Keys stay on this device.

   Nothing is saved by itself: what the AI prepares is a draft in the usual form.
   Save invoice / Save letter give the next number exactly as before.
   ========================================================================== */
(function () {
'use strict';
var A = window.CBapp;
if (!A) return;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function db() { return A.db; }
var esc = A.esc;
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function toast(m) { A.toast(m); }
function today() { return A.todayISO(); }
function dmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : (iso || ''); }

/* ================================================================ AI settings */
var AIK = 'cs_ai';
function aiCfg() {
  var o = {};
  try { o = JSON.parse(localStorage.getItem(AIK) || '{}') || {}; } catch (e) {}
  /* keys already given to Excerpt Desk on this device are used too */
  if (!o.gemKey) { try { var x = JSON.parse(localStorage.getItem('xdesk:dict') || '{}'); if (x.key) o.gemKey = x.key; if (!o.gemModel && x.model) o.gemModel = x.model; } catch (e) {} }
  if (!o.claudeKey) { try { var y = JSON.parse(localStorage.getItem('xdesk:notesai') || '{}'); if (y.claudeKey) o.claudeKey = y.claudeKey; } catch (e) {} }
  o.gemModel = o.gemModel || 'gemini-3.8-flash';
  o.claudeModel = o.claudeModel || 'claude-sonnet-5-5';
  o.def = o.def || 'gemini';
  o.second = o.second || (o.def === 'gemini' ? 'claude' : 'gemini');
  return o;
}
function aiSave(o) { try { localStorage.setItem(AIK, JSON.stringify(o)); } catch (e) {} }
function hasKey(eng) { var c = aiCfg(); return eng === 'claude' ? !!c.claudeKey : !!c.gemKey; }

/* ================================================================ calling the AIs */
function b64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
async function gemini(parts, system, json) {
  var c = aiCfg();
  if (!c.gemKey) throw new Error('Add your Gemini API key first (⚙ AI).');
  var body = { contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: 0.2, maxOutputTokens: 16384 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.gemModel) + ':generateContent?key=' + encodeURIComponent(c.gemKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
  var cand = j.candidates && j.candidates[0];
  var t = cand && cand.content && (cand.content.parts || []).map(function (p) { return p.thought ? '' : (p.text || ''); }).join('');
  if (!t) throw new Error('Gemini sent back nothing' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.');
  return t;
}
async function claude(text, system) {
  var c = aiCfg();
  if (!c.claudeKey) throw new Error('Add your Claude API key first (⚙ AI).');
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': c.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: c.claudeModel, max_tokens: 8000, system: system || undefined, messages: [{ role: 'user', content: text }] })
  });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Claude: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
  return (j.content || []).map(function (p) { return p.text || ''; }).join('');
}
/* Gemini hears the recording; whichever AI was chosen then does the work. If the
   chosen one fails, the other default is tried once (when it has a key). */
async function transcribe(audio) {
  return (await gemini([{ inline_data: { mime_type: audio.type || 'audio/webm', data: await b64(audio) } },
    { text: 'Type out exactly what is said in this recording, in the language spoken (English, Hindi or Marathi mixed), with correct punctuation. Indian legal context: case numbers like O.A. 297/2026, ULP 106/2026, W.P. 3692/2026; courts such as CAT, MAT, Industrial Court, High Court Nagpur Bench; names are Indian (Marathi, Hindi, Christian, Parsi, Muslim) — spell them correctly. Write dates as said. Reply with the words only.' }],
    null, false)).trim();
}
async function run(engine, input, task, system) {
  /* input: {text} or {audio} */
  var order = [engine, engine === 'gemini' ? 'claude' : 'gemini'].filter(function (e, i) { return i === 0 || hasKey(e); });
  var heard = input.text || '';
  var last = null;
  for (var i = 0; i < order.length; i++) {
    var eng = order[i];
    try {
      if (eng === 'gemini') {
        var parts = input.audio && !heard ? [{ inline_data: { mime_type: input.audio.type || 'audio/webm', data: await b64(input.audio) } }, { text: 'The recording above is the instruction (Indian names: spell them correctly; flag doubtful ones with [?]).\n\n' + task }]
                                           : [{ text: task.replace('{{SAID}}', heard) }];
        if (input.audio && !heard) parts[1].text = parts[1].text.replace('{{SAID}}', '(the recording above)');
        var out = await gemini(parts, system, true);
        return { json: parseJson(out), engine: 'Gemini' };
      }
      if (input.audio && !heard) heard = await transcribe(input.audio);
      var t = await claude(task.replace('{{SAID}}', heard) + '\n\nReply with the JSON only.', system);
      return { json: parseJson(t), engine: 'Claude', heard: heard };
    } catch (e) {
      last = e;
      if (i + 1 < order.length) toast(e.message + ' — trying ' + (order[i + 1] === 'claude' ? 'Claude' : 'Gemini') + ' instead');
    }
  }
  throw last;
}
function parseJson(t) {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) {}
  var i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error('The AI did not answer in the expected form. Please try again.');
}

/* ================================================================ standing instructions */
function instr(kind) {
  var list = db().settings.aiInstr || [];
  return list.filter(function (x) { return !x.for || x.for === 'both' || x.for === kind; });
}
function instrText(kind) {
  var l = instr(kind);
  return l.length ? '\nSTANDING INSTRUCTIONS FROM THE ADVOCATE (always follow; they override the defaults above):\n' + l.map(function (x, i) { return (i + 1) + '. ' + x.text; }).join('\n') + '\n' : '';
}

/* ================================================================ the Case Manager's cases */
function cases() {
  var c = [];
  try { c = JSON.parse(localStorage.getItem('cpm_c') || '[]') || []; } catch (e) {}
  return c.filter(function (x) { return x && !x.del; });
}
function ctit(c) { var pl = c.pl || '', de = c.de || ''; if (pl && de) return pl + ' Vs. ' + de; return pl || de || ''; }
function isCat(c) { return /administrative\s+tribunal|\bC\.?A\.?T\b/i.test((c && (c.court || '')) + ' ' + (c && c.cn || '')); }
/* "O.A. No. 297/2026" → {t:'OA', n:'297', y:'2026'} */
function cnKey(s) {
  s = String(s || '').toUpperCase();
  var m = s.match(/(\d{1,6})\s*(?:\/|OF|-)\s*((?:19|20)\d{2})/);
  var t = s.replace(/\bNO\b\.?/g, '').replace(/[^A-Z]/g, '').replace(/OF$/, '');
  return { t: t, n: m ? String(+m[1]) : '', y: m ? m[2] : '' };
}
function refMatches(ref, c) {
  var k = cnKey(c.cn);
  if (!k.n) return false;
  var r = String(ref || '').toUpperCase().replace(/\s+/g, ' ');
  var rx = new RegExp('(^|\\D)0*' + k.n + '\\s*(\\/|OF|-)\\s*' + k.y + '(\\D|$)');
  if (!rx.test(r)) return false;
  if (!k.t) return true;
  var rl = r.replace(/[^A-Z]/g, '');
  return rl.indexOf(k.t) >= 0 || k.t.length <= 1;
}
function words(s) { return String(s || '').toLowerCase().replace(/[^a-zऀ-ॿ ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && !/^(the|and|vs|versus|union|india|state|maharashtra|others|ors|through|msrtc|corporation|limited|ltd)$/.test(w); }); }
function findCases(q) {
  var k = cnKey((q.type || '') + ' ' + (q.number || '') + (q.year ? '/' + q.year : '') + ' ' + (q.caseNo || ''));
  var pw = words((q.parties || '') + ' ' + (q.text || ''));
  var cw = words(q.court || '');
  return cases().map(function (c) {
    var ck = cnKey(c.cn), s = 0;
    if (k.n && ck.n === k.n) s += 6;
    if (k.y && ck.y === k.y) s += 4;
    if (k.t && ck.t && (ck.t.indexOf(k.t) >= 0 || k.t.indexOf(ck.t) >= 0)) s += 3;
    var hay = words(ctit(c) + ' ' + (c.cl || ''));
    pw.forEach(function (w) { if (hay.some(function (h) { return h === w || (w.length > 4 && (h.indexOf(w) === 0 || w.indexOf(h) === 0)); })) s += 2; });
    var court = words(c.court);
    cw.forEach(function (w) { if (court.indexOf(w) >= 0) s += 1; });
    return { c: c, s: s };
  }).filter(function (x) { return x.s >= 4; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
}
function hearingDates(c) {
  var out = {}, td = today();
  ((c.eco && c.eco.hh) || []).forEach(function (h) { var d = h.bd || h.d; if (d && d <= td) out[d] = (out[d] ? out[d] + ' / ' : '') + (h.biz || h.p || ''); });
  (c.hist || []).forEach(function (h) { if (h.pd && h.pd <= td && !out[h.pd]) out[h.pd] = h.note || h.ps || ''; });
  return Object.keys(out).sort().map(function (d) { return { d: d, t: String(out[d] || '').replace(/\s+/g, ' ').slice(0, 220) }; });
}
function priorBills(c) {
  return (db().invoices || []).filter(function (v) { return refMatches(v.reference, c); })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
}
var NE_RX = /non[\s-]*effective/i;
function neCharged(bills) { var n = 0; bills.forEach(function (v) { (v.items || []).forEach(function (it) { if (NE_RX.test(it.name || '')) n += Number(it.qty) || 0; }); }); return n; }
function billedDates(bills) {
  var s = {};
  bills.forEach(function (v) { (v.items || []).forEach(function (it) {
    String((it.name || '') + ' ' + (it.note || '')).replace(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/g, function (m, d, mo, y) { s[y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2)] = v.number; return m; });
  }); });
  return s;
}
function clientFor(c, bills) {
  var last = bills[bills.length - 1];
  if (last && (last.billTo || last.clientId)) return { clientId: last.clientId || '', billTo: last.billTo || '' };
  var name = String(c.cl || '').toLowerCase().trim();
  if (name) {
    var hit = (db().clients || []).find(function (k) { var n = String(k.name || '').toLowerCase(); return n && (n === name || n.indexOf(name) >= 0 || name.indexOf(n) >= 0); });
    if (hit) return { clientId: hit.id, billTo: hit.address || hit.name };
  }
  return { clientId: '', billTo: '' };
}

/* ================================================================ recorder */
function Recorder(host, onDone) {
  var me = this, rec = null, chunks = [], t0 = 0, tm = null, stream = null;
  host.innerHTML = '<div class="ai-rec"><button class="ai-mic" type="button" aria-label="Start or stop listening"><span></span></button>' +
    '<div class="ai-rst"><b class="ai-rlab">Starting the microphone…</b><span class="ai-rtime"></span></div></div>' +
    '<details class="ai-type"><summary>Type instead</summary><textarea rows="4" placeholder="Type the instruction here…"></textarea><button class="btn sm" type="button">Use this text</button></details>';
  var mic = $('.ai-mic', host), lab = $('.ai-rlab', host), tim = $('.ai-rtime', host);
  $('.ai-type button', host).onclick = function () { var t = $('.ai-type textarea', host).value.trim(); if (!t) return; me.stop(true); onDone({ text: t }); };
  function tick() { var s = Math.round((Date.now() - t0) / 1000); tim.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  me.start = async function () {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) { lab.textContent = 'The microphone could not be used (' + (e.message || e.name) + '). Allow it, or type instead.'; mic.disabled = true; $('.ai-type', host).open = true; return; }
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      clearInterval(tm); stream.getTracks().forEach(function (t) { t.stop(); });
      if (me.cancelled) return;
      var blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      if (blob.size < 1500) { lab.textContent = 'Nothing was heard. Press the microphone and speak.'; mic.classList.remove('on'); return; }
      lab.textContent = 'Got it.'; onDone({ audio: blob });
    };
    rec.start(1000); t0 = Date.now(); tick(); tm = setInterval(tick, 500);
    mic.classList.add('on'); lab.textContent = 'Listening — press the microphone when you finish';
  };
  me.stop = function (cancel) {
    me.cancelled = !!cancel;
    if (rec && rec.state !== 'inactive') rec.stop(); else if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    mic.classList.remove('on'); clearInterval(tm);
  };
  mic.onclick = function () { if (rec && rec.state === 'recording') me.stop(false); else { me.cancelled = false; me.start(); } };
}

/* ================================================================ UI bits */
function css() {
  if ($('#ai-css')) return;
  var s = document.createElement('style'); s.id = 'ai-css';
  s.textContent =
    '.ai-bar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}' +
    '.ai-bar .btn{font-weight:600}.ai-bar .ai-go{background:#1b2a41;color:#fff;border-color:#1b2a41}' +
    '.ai-ov{position:fixed;inset:0;z-index:10001;background:rgba(10,16,28,.55);display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;overflow:auto}' +
    '.ai-box{background:#fff;color:#1b2430;border-radius:12px;width:min(640px,100%);padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif;position:relative}' +
    '.ai-box h3{margin:0 0 10px;font-size:17px}.ai-box .ai-x{position:absolute;top:10px;right:12px;border:0;background:none;font-size:22px;cursor:pointer;color:#555}' +
    '.ai-eng{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 12px;font-size:13px;color:#555}.ai-eng button{border:1px solid #c9d0da;background:#fff;border-radius:16px;padding:4px 12px;cursor:pointer}.ai-eng button.on{background:#1668e3;border-color:#1668e3;color:#fff}' +
    '.ai-rec{display:flex;gap:14px;align-items:center;margin:8px 0}' +
    '.ai-mic{width:64px;height:64px;border-radius:50%;border:0;background:#1668e3;cursor:pointer;display:grid;place-items:center;flex:none}' +
    '.ai-mic span{width:18px;height:28px;border-radius:9px;background:#fff;box-shadow:0 10px 0 -6px #fff}' +
    '.ai-mic.on{background:#d22d2d;animation:aipulse 1.2s infinite}.ai-mic.on span{width:20px;height:20px;border-radius:4px;box-shadow:none}' +
    '@keyframes aipulse{0%{box-shadow:0 0 0 0 rgba(210,45,45,.5)}70%{box-shadow:0 0 0 14px rgba(210,45,45,0)}100%{box-shadow:0 0 0 0 rgba(210,45,45,0)}}' +
    '.ai-rst{display:flex;flex-direction:column;gap:2px}.ai-rtime{font-variant-numeric:tabular-nums;color:#666}' +
    '.ai-type{margin-top:6px}.ai-type textarea{width:100%;box-sizing:border-box;margin:6px 0;font:inherit;padding:8px;border:1px solid #c9d0da;border-radius:8px}' +
    '.ai-busy{display:flex;gap:10px;align-items:center;color:#444}.ai-spin{width:18px;height:18px;border:3px solid #c9d6ef;border-top-color:#1668e3;border-radius:50%;animation:aisp .8s linear infinite}@keyframes aisp{to{transform:rotate(360deg)}}' +
    '.ai-said{background:#f4f6f9;border-radius:8px;padding:8px 10px;font-size:13px;color:#333;margin:8px 0;white-space:pre-wrap}' +
    '.ai-hits{list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:6px}.ai-hits li{border:1px solid #d5dbe4;border-radius:8px;padding:8px 10px;cursor:pointer}.ai-hits li:hover{border-color:#1668e3;background:#f2f7ff}.ai-hits small{color:#666}' +
    '.ai-warn{background:#fff6e5;border:1px solid #f0c36d;border-radius:8px;padding:8px 10px;font-size:13px;margin:8px 0}' +
    '.ai-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}' +
    '.ai-lbl{display:block;font-size:12px;font-weight:600;color:#555;margin:10px 0 4px}.ai-box input,.ai-box select{font:inherit;padding:7px 9px;border:1px solid #c9d0da;border-radius:7px;width:100%;box-sizing:border-box}' +
    /* the side drawer: orders on the left, the bill stays on the right */
    '.ai-drawer{position:fixed;left:0;top:0;bottom:0;width:min(44vw,640px);z-index:10000;background:#f4f6f9;border-right:1px solid #c9d0da;box-shadow:6px 0 30px rgba(0,0,0,.18);display:flex;flex-direction:column;font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif}' +
    '.ai-dh{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#1b2a41;color:#fff}.ai-dh b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ai-dh .btn{background:#fff;color:#1b2a41}' +
    '.ai-db{flex:1;min-height:0;display:flex;flex-direction:column}.ai-pdf{flex:1;min-height:0;border:0;width:100%;background:#fff}' +
    '.ai-dates{max-height:30%;overflow:auto;padding:8px 12px;font-size:12.5px;border-bottom:1px solid #d5dbe4;background:#fff}.ai-dates div{padding:2px 0;border-bottom:1px dotted #e2e6ec}' +
    '.ai-df{padding:10px 12px;border-top:1px solid #c9d0da;background:#fff}' +
    '.ai-il{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:6px}.ai-il li{border:1px solid #d5dbe4;border-radius:8px;padding:8px 10px;display:flex;gap:8px;align-items:flex-start}.ai-il li .t{flex:1;white-space:pre-wrap}.ai-il li b{min-width:22px}' +
    '@media (max-width:900px){.ai-drawer{width:100vw;height:55vh;top:auto;border-right:0;border-top:1px solid #c9d0da}}';
  document.head.appendChild(s);
}
function overlay(title, html) {
  css();
  var o = document.createElement('div'); o.className = 'ai-ov';
  o.innerHTML = '<div class="ai-box" role="dialog"><button class="ai-x" aria-label="Close" title="Close">×</button><h3>' + esc(title) + '</h3>' + html + '</div>';
  document.body.appendChild(o);
  var api = { el: o, box: $('.ai-box', o), closed: false, onclose: null,
    close: function () { if (api.closed) return; api.closed = true; if (api.onclose) try { api.onclose(); } catch (e) {} o.remove(); } };
  $('.ai-x', o).onclick = api.close;
  o.addEventListener('click', function (e) { if (e.target === o) api.close(); });
  return api;
}
function engineChips(host, onPick) {
  var c = aiCfg(), cur = c.def;
  host.innerHTML = '<span>Prepared by</span><button data-e="gemini">Gemini</button><button data-e="claude">Claude</button><span class="ai-en"></span>';
  function paint() { $$('button', host).forEach(function (b) { b.classList.toggle('on', b.dataset.e === cur); }); $('.ai-en', host).textContent = hasKey(cur) ? '' : '(no key yet — add it in ⚙ AI)'; }
  $$('button', host).forEach(function (b) { b.onclick = function () { cur = b.dataset.e; paint(); if (onPick) onPick(cur); }; });
  paint();
  return function () { return cur; };
}
function busy(host, msg) { host.innerHTML = '<div class="ai-busy"><span class="ai-spin"></span><span>' + esc(msg) + '</span></div>'; }

/* ================================================================ ⚙ AI settings window */
function openSettings() {
  var c = aiCfg();
  var o = overlay('AI for bills and letters',
    '<p style="margin:0 0 8px;color:#555">Gemini listens to your recording and is used unless you pick Claude for that bill or letter. Keys are kept on this device only.</p>' +
    '<label class="ai-lbl">Gemini API key</label><input id="ai-gk" type="password" autocomplete="off" placeholder="AIza…">' +
    '<label class="ai-lbl">Gemini model</label><input id="ai-gm">' +
    '<label class="ai-lbl">Claude API key</label><input id="ai-ck" type="password" autocomplete="off" placeholder="sk-ant-…">' +
    '<label class="ai-lbl">Claude model</label><input id="ai-cm">' +
    '<label class="ai-lbl">First default (used when you do not choose)</label><select id="ai-d1"><option value="gemini">Gemini</option><option value="claude">Claude</option></select>' +
    '<label class="ai-lbl">Second default (tried if the first one fails)</label><select id="ai-d2"><option value="claude">Claude</option><option value="gemini">Gemini</option></select>' +
    '<div class="ai-row"><button class="btn" id="ai-cancel">Cancel</button><button class="btn primary" id="ai-ok">Save</button></div>');
  $('#ai-gk').value = c.gemKey || ''; $('#ai-gm').value = c.gemModel; $('#ai-ck').value = c.claudeKey || ''; $('#ai-cm').value = c.claudeModel;
  $('#ai-d1').value = c.def; $('#ai-d2').value = c.second;
  $('#ai-cancel').onclick = o.close;
  $('#ai-ok').onclick = function () {
    aiSave({ gemKey: $('#ai-gk').value.trim(), gemModel: $('#ai-gm').value.trim(), claudeKey: $('#ai-ck').value.trim(), claudeModel: $('#ai-cm').value.trim(), def: $('#ai-d1').value, second: $('#ai-d2').value });
    o.close(); toast('AI settings saved on this device');
  };
}

/* ================================================================ 📋 standing instructions */
function openInstructions() {
  var o = overlay('Standing instructions',
    '<p style="margin:0;color:#555">Followed every time a bill or letter is prepared from your dictation. They are kept with your billing data, so every device uses them.</p>' +
    '<ul class="ai-il" id="ai-il"></ul>' +
    '<label class="ai-lbl" id="ai-ilab">New instruction</label>' +
    '<textarea id="ai-itext" rows="3" style="width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #c9d0da;border-radius:8px" placeholder="e.g. For Railway bills, mention the PAN in the letter. / Write the note for an effective hearing as: On (date) the Hon\'ble Tribunal heard the matter at length."></textarea>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><select id="ai-ifor" style="width:auto"><option value="both">For bills and letters</option><option value="invoice">For bills only</option><option value="letter">For letters only</option></select>' +
    '<button class="btn sm" id="ai-imic" type="button">🎙 Dictate it</button><span id="ai-imsg" style="color:#666;font-size:12.5px"></span></div>' +
    '<div class="ai-row"><button class="btn" id="ai-icancel" hidden>Cancel editing</button><button class="btn primary" id="ai-iadd">Add as instruction</button></div>');
  var editing = null, recr = null;
  function list() { return (db().settings.aiInstr = db().settings.aiInstr || []); }
  function paint() {
    var l = list();
    $('#ai-il').innerHTML = l.length ? l.map(function (x, i) {
      return '<li><b>' + (i + 1) + '.</b><span class="t">' + esc(x.text) + '<br><small style="color:#777">' + (x.for === 'invoice' ? 'Bills' : x.for === 'letter' ? 'Letters' : 'Bills and letters') + '</small></span>' +
        '<button class="btn sm" data-ed="' + i + '">Edit</button><button class="btn sm" data-del="' + i + '">Delete</button></li>';
    }).join('') : '<li style="color:#777">No instructions yet.</li>';
  }
  function reset() { editing = null; $('#ai-itext').value = ''; $('#ai-ifor').value = 'both'; $('#ai-ilab').textContent = 'New instruction'; $('#ai-iadd').textContent = 'Add as instruction ' + (list().length + 1); $('#ai-icancel').hidden = true; }
  $('#ai-il').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var l = list();
    if (b.dataset.del != null) { var i = +b.dataset.del; if (!confirm('Delete instruction ' + (i + 1) + '?')) return; l.splice(i, 1); A.saveNow(); paint(); reset(); return; }
    if (b.dataset.ed != null) { editing = +b.dataset.ed; $('#ai-itext').value = l[editing].text; $('#ai-ifor').value = l[editing].for || 'both'; $('#ai-ilab').textContent = 'Editing instruction ' + (editing + 1); $('#ai-iadd').textContent = 'Save instruction ' + (editing + 1); $('#ai-icancel').hidden = false; $('#ai-itext').focus(); }
  };
  $('#ai-icancel').onclick = reset;
  $('#ai-iadd').onclick = function () {
    var t = $('#ai-itext').value.trim(); if (!t) { $('#ai-itext').focus(); return; }
    var l = list();
    if (editing != null) { l[editing].text = t; l[editing].for = $('#ai-ifor').value; } else l.push({ id: A.uid(), text: t, for: $('#ai-ifor').value, at: today() });
    A.saveNow(); paint(); reset(); toast('Instruction saved');
  };
  $('#ai-imic').onclick = async function () {
    var host = document.createElement('div'); $('#ai-imsg').textContent = '';
    if (recr) return;
    var box = $('#ai-imic').parentNode; box.after(host);
    recr = new Recorder(host, async function (inp) {
      recr = null;
      if (inp.text) { $('#ai-itext').value = inp.text; host.remove(); return; }
      busy(host, 'Typing what you said…');
      try { $('#ai-itext').value = await transcribe(inp.audio); host.remove(); }
      catch (e) { host.innerHTML = '<div class="ai-warn">' + esc(e.message) + '</div>'; }
    });
    recr.start();
  };
  o.onclose = function () { if (recr) recr.stop(true); };
  paint(); reset();
}

/* ================================================================ 🎙 AUTO INVOICE */
var AI_SYS = 'You assist Adv. Sanket R. Charpe (Nagpur; Additional Standing Counsel, Central Government, CAT Mumbai Bench circuit sittings at Nagpur) with his professional fee bills. Be exact. Never invent dates, case numbers, amounts or events that were not said or are not in the material given. Indian names: spell carefully; mark doubtful ones with [?].';

function startInvoice() {
  var o = overlay('Auto invoice',
    '<div class="ai-eng" id="ai-eng"></div>' +
    '<p style="margin:0 0 4px;color:#555">Say which case, e.g. “Prepare invoice for O.A. 297 of 2026, Gondnale versus Union of India, pending before the Central Administrative Tribunal, Nagpur.”</p>' +
    '<div id="ai-step"></div>');
  var pick = engineChips($('#ai-eng', o.box));
  var step = $('#ai-step', o.box), recr;
  function listen() {
    recr = new Recorder(step, function (inp) { understand(inp); });
    recr.start();
  }
  o.onclose = function () { if (recr) recr.stop(true); };
  async function understand(inp) {
    busy(step, 'Finding the case…');
    try {
      var task = 'From the advocate\'s instruction, pick out which case the bill is for.\nINSTRUCTION: {{SAID}}\n\n' +
        'Return JSON: {"said":"the instruction in words","type":"case type as said, e.g. O.A., ULP, W.P., R.C.S., M.A., C.P.","number":"","year":"","parties":"names said","court":"court as said"}';
      var r = await run(pick(), inp, task, AI_SYS);
      var q = r.json || {};
      q.text = q.said || r.heard || inp.text || '';
      choose(q);
    } catch (e) { step.innerHTML = '<div class="ai-warn">' + esc(e.message) + '</div><div class="ai-row"><button class="btn" id="ai-again">Try again</button></div>'; $('#ai-again').onclick = listen; }
  }
  function choose(q) {
    var hits = findCases(q);
    var said = q.text ? '<div class="ai-said">' + esc(q.text) + '</div>' : '';
    if (hits.length === 1 || (hits.length > 1 && hits[0].s >= 12 && hits[0].s - hits[1].s >= 4)) { o.close(); openBill(hits[0].c, q); return; }
    step.innerHTML = said + (hits.length ? '<b>Which case?</b><ul class="ai-hits">' + hits.map(function (h, i) {
      return '<li data-i="' + i + '"><b>' + esc(h.c.cn || '(no number)') + '</b> — ' + esc(ctit(h.c)) + '<br><small>' + esc(h.c.court || '') + (h.c.cl ? ' · ' + esc(h.c.cl) : '') + '</small></li>';
    }).join('') + '</ul>' : '<div class="ai-warn">No case in the Case Manager matches what was said.</div>') +
      '<label class="ai-lbl">Or search by number or party</label><input id="ai-q" placeholder="e.g. 297/2026 or Gondnale">' +
      '<ul class="ai-hits" id="ai-qh"></ul>' +
      '<div class="ai-row"><button class="btn" id="ai-again">Speak again</button><button class="btn" id="ai-nocase">Bill without a case from the list</button></div>';
    $$('.ai-hits li[data-i]', step).forEach(function (li) { li.onclick = function () { o.close(); openBill(hits[+li.dataset.i].c, q); }; });
    $('#ai-again').onclick = listen;
    $('#ai-nocase').onclick = function () { o.close(); openBill({ cn: [q.type, q.number && q.year ? q.number + '/' + q.year : q.number].filter(Boolean).join(' '), pl: q.parties || '', court: q.court || '', nocase: true }, q); };
    $('#ai-q').oninput = function () {
      var v = this.value.trim().toLowerCase();
      var l = v.length < 2 ? [] : cases().filter(function (c) { return ((c.cn || '') + ' ' + ctit(c) + ' ' + (c.cl || '')).toLowerCase().indexOf(v) >= 0; }).slice(0, 8);
      $('#ai-qh').innerHTML = l.map(function (c, i) { return '<li data-j="' + i + '"><b>' + esc(c.cn || '') + '</b> — ' + esc(ctit(c)) + '<br><small>' + esc(c.court || '') + '</small></li>'; }).join('');
      $$('#ai-qh li', step).forEach(function (li) { li.onclick = function () { o.close(); openBill(l[+li.dataset.j], q); }; });
    };
  }
  listen();
}

var CUR = null;   /* the case the bill on screen was started for */
function openBill(c, q) {
  if (A.draftHasContent(A.currentDraft()) && !A.editingId() && !confirm('The bill on screen has not been saved. Replace it with a new bill for ' + (c.cn || 'this case') + '?')) return;
  var bills = c.nocase ? [] : priorBills(c);
  var who = clientFor(c, bills);
  var d = A.blankDraft();
  d.clientId = who.clientId; d.billTo = who.billTo;
  var last = bills[bills.length - 1];
  d.reference = last && last.reference ? last.reference.replace(/\s*\(?(judg(e)?ment|order)\s+dated?[^)]*\)?\s*$/i, '') : [c.cn, ctit(c)].filter(Boolean).join(' ');
  d.items = [{ name: '', hsn: '', rate: 0, qty: 1, note: '', clerkable: true }];
  A.setDraft(d, null); A.go('build');
  CUR = { c: c, bills: bills, q: q };
  drawer(c, bills, who);
  toast('Bill ' + d.number + ' started for ' + (c.cn || 'the case') + (who.billTo ? '' : ' — addressee not known yet; fill Bill To'));
}

/* the left drawer: orders (CAT), the dates on record, and the microphone for what happened */
var DR = null;
function closeDrawer() { if (DR) { if (DR.recr) DR.recr.stop(true); if (DR.url) URL.revokeObjectURL(DR.url); DR.el.remove(); DR = null; } }
function drawer(c, bills, who) {
  closeDrawer(); css();
  var el = document.createElement('div'); el.className = 'ai-drawer';
  var hd = c.nocase ? [] : hearingDates(c), ne = neCharged(bills), cat = isCat(c);
  el.innerHTML = '<div class="ai-dh"><b>' + esc((c.cn || '') + ' — ' + ctit(c)) + '</b><button class="btn sm" id="ai-dclose">Hide</button></div>' +
    '<div class="ai-db">' +
      '<div class="ai-dates"><b>' + (cat ? 'CAT matter. ' : '') + 'Earlier bills for this case: ' + (bills.length ? bills.map(function (v) { return esc(v.number) + ' (' + dmy(v.date) + ')'; }).join(', ') : 'none') + '.</b>' +
        (cat ? '<br>Non-effective hearings already charged: <b>' + ne + ' of 5</b>.' : '') +
        (hd.length ? '<div style="margin-top:6px;font-weight:600">Dates on record</div>' + hd.map(function (h) { return '<div><b>' + dmy(h.d) + '</b> ' + esc(h.t) + '</div>'; }).join('') : '') + '</div>' +
      '<div id="ai-pdfhost" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>' +
    '</div>' +
    '<div class="ai-df"><div class="ai-eng" id="ai-deng" style="margin-bottom:6px"></div>' +
      '<div style="color:#555;font-size:13px">Say what happened, date by date: “On 12th January the matter was heard at length… On 3rd February it was adjourned… Typing and Xerox expenses 450 rupees…”. Say it again later to change anything.</div>' +
      '<div id="ai-dstep"></div></div>';
  document.body.appendChild(el);
  DR = { el: el, c: c, bills: bills };
  $('#ai-dclose', el).onclick = closeDrawer;
  var pick = engineChips($('#ai-deng', el));
  var step = $('#ai-dstep', el);
  function ready(msg) {
    step.innerHTML = (msg || '') + '<div class="ai-row" style="justify-content:flex-start"><button class="btn primary" id="ai-dmic">🎙 Dictate what happened</button></div>';
    $('#ai-dmic', el).onclick = function () { DR.recr = new Recorder(step, function (inp) { DR.recr = null; events(inp, pick(), step, ready); }); DR.recr.start(); };
  }
  ready();
  if (cat && !c.nocase) showOrders(c);
  else $('#ai-pdfhost', el).innerHTML = '<p style="padding:10px 12px;color:#666;margin:0">' + (c.nocase ? 'This case is not in the Case Manager.' : 'Orders are shown here for CAT matters.') + '</p>';
}
/* the orders of the case, as ONE PDF in date order, made by the Case Manager */
function casesWin() {
  try {
    var f = window.parent && window.parent !== window ? window.parent.document.getElementById('fCases') : null;
    return f && f.contentWindow ? { f: f, w: f.contentWindow } : null;
  } catch (e) { return null; }
}
async function showOrders(c) {
  var host = $('#ai-pdfhost', DR.el);
  busy(host, 'Putting the orders together…'); host.style.padding = '10px 12px';
  try {
    var cw = casesWin();
    if (!cw) throw new Error('Open Charpe Suite from its home page (not the billing page alone) to see the orders here.');
    if (!cw.f.getAttribute('src')) { cw.f.setAttribute('src', 'cases.html'); }
    var t0 = Date.now();
    while (!(cw.f.contentWindow && cw.f.contentWindow.ordMergedPdf) && Date.now() - t0 < 20000) await new Promise(function (r) { setTimeout(r, 400); });
    var w = cw.f.contentWindow;
    if (!w.ordMergedPdf) throw new Error('The Case Manager did not open. Open it once (and sign in), then press Show orders.');
    var r = await w.ordMergedPdf(c.id);
    if (!DR || DR.c !== c) return;
    if (!r) throw new Error('No orders of this case have been downloaded yet. Fetch them in the Case Manager (Orders & order sheets), then press Show orders.');
    DR.url = URL.createObjectURL(r.blob);
    host.style.padding = '0';
    host.innerHTML = '<iframe class="ai-pdf" src="' + DR.url + '#view=FitH"></iframe>' + (r.miss && r.miss.length ? '<div class="ai-warn" style="margin:6px">' + r.miss.length + ' order(s) could not be opened and are left out.</div>' : '');
  } catch (e) {
    if (!DR) return;
    host.innerHTML = '<div class="ai-warn">' + esc(e.message) + '</div><button class="btn sm" id="ai-reord">Show orders</button>';
    $('#ai-reord', DR.el).onclick = function () { showOrders(c); };
  }
}

function catalogText() {
  return (db().catalog || []).map(function (k) { return k.id + ' | ' + k.name + ' | ₹' + k.rate + (k.clerkable ? '' : ' | expense (no clerkage)'); }).join('\n');
}
function billText(v) {
  return v.number + ' dated ' + dmy(v.date) + ' — ' + (v.reference || '') + '\n' + (v.items || []).map(function (it) {
    return '  • ' + it.name + ' — ₹' + it.rate + ' × ' + it.qty + (it.note ? '\n    note: ' + String(it.note).replace(/\n/g, ' ') : '');
  }).join('\n');
}
function sampleFor(clientId) {
  var s = (db().invoices || []).filter(function (v) { return v.sample && (!clientId || v.clientId === clientId); });
  return s[s.length - 1] || null;
}
async function events(inp, engine, step, ready) {
  busy(step, 'Preparing the bill…');
  var x = CUR, c = x.c, d = A.currentDraft(), cat = isCat(c);
  var ne = neCharged(x.bills), done = billedDates(x.bills);
  var hd = c.nocase ? [] : hearingDates(c);
  var have = (d.items || []).filter(function (it) { return (it.name || '').trim() || Number(it.rate); });
  var sample = sampleFor(d.clientId);
  var task =
    'Prepare the fee items of a professional bill from the advocate\'s dictation.\n\n' +
    'CASE: ' + (c.cn || '') + ' — ' + ctit(c) + '\nCOURT: ' + (c.court || '') + (cat ? ' (Central Administrative Tribunal)' : '') + '\nTODAY: ' + dmy(today()) + '\n' +
    (hd.length ? '\nDATES ON RECORD (from the court site / case diary):\n' + hd.map(function (h) { return dmy(h.d) + ': ' + h.t; }).join('\n') + '\n' : '') +
    (x.bills.length ? '\nEARLIER BILLS FOR THIS CASE (do not charge again for a date already charged here):\n' + x.bills.map(billText).join('\n') + '\n' : '') +
    (sample ? '\nSAMPLE BILL THE ADVOCATE MARKED FOR THIS CLIENT (follow its item titles and the style of its notes):\n' + billText(sample) + '\n' : '') +
    '\nRATE CARD (id | item title | rate):\n' + catalogText() + '\n' +
    (have.length ? '\nTHE BILL AS IT STANDS NOW (the dictation may change it; return the whole revised list):\n' + have.map(function (it) { return '• ' + it.name + ' — ₹' + it.rate + ' × ' + it.qty + (it.note ? ' — note: ' + it.note : ''); }).join('\n') + '\n' : '') +
    '\nDICTATION: {{SAID}}\n\n' +
    'RULES:\n' +
    '1. Each date on which something happened is a hearing. If the description shows the matter was really taken up (heard, argued, arguments, evidence, final hearing, order or judgment pronounced, reply filed and matter heard, interim relief heard, etc.) it is EFFECTIVE; anything else (adjourned, not reached, board did not reach, leave note, time sought, matter not taken up) is NON-EFFECTIVE.\n' +
    '2. Use the rate-card item that fits the court and client (CAT items for CAT; Railway items for Railway clients; MSRTC items for MSRTC). Put its id in catalogId. Use the rate from the rate card unless the advocate said a different amount — then put that amount in rate and set rateFromDictation true.\n' +
    '3. One line per effective hearing, with qty 1, and a note describing what happened, e.g. "On 12/01/2026 the Hon\'ble Tribunal heard the matter at length." Dates as DD/MM/YYYY.\n' +
    '4. Non-effective hearings go together in ONE line with qty = their number and the note listing their dates, e.g. "Dates: 03/02/2026, 17/02/2026".\n' +
    '5. Expenses: one line each, kind "expense", heading as the advocate said it (e.g. "Typing and Xerox expenses") with the narration he gave as the note, amount as said, clerkable false. Never add expenses that were not said.\n' +
    '6. Other work (drafting the reply, legal opinion, notice, conference) as its own line from the rate card.\n' +
    '7. Do not add clerkage — the tool adds it.\n' +
    '8. List in "doubts" anything you were unsure about (a date that is not clear, an event that could be either effective or non-effective).\n' +
    instrText('invoice') +
    '\nReturn JSON: {"items":[{"catalogId":"k1 or null","name":"item heading","rate":0,"qty":1,"note":"","kind":"effective|noneffective|expense|fee","dates":["YYYY-MM-DD"],"clerkable":true,"rateFromDictation":false}],"doubts":["…"],"said":"the dictation in words"}';
  try {
    var r = await run(engine, inp, task, AI_SYS);
    var out = r.json || {};
    var warn = [];
    var items = (out.items || []).map(function (it) {
      var k = it.catalogId && (db().catalog || []).find(function (z) { return z.id === it.catalogId; });
      var o = { name: String(it.name || (k && k.name) || '').trim(), hsn: (k && k.hsn) || '', qty: Math.max(1, Math.round(Number(it.qty) || 1)),
                note: String(it.note || '').trim(), clerkable: it.kind === 'expense' ? false : (it.clerkable !== false), _kind: it.kind, _dates: it.dates || [] };
      if (k && !it.rateFromDictation) { o.name = k.name; o.rate = Number(k.rate) || 0; if (k.clerkable === false) o.clerkable = false; }
      else o.rate = Number(it.rate) || (k ? Number(k.rate) : 0) || 0;
      if (!k && it.kind !== 'expense' && !it.rateFromDictation) warn.push('“' + o.name + '” is not on the rate card — check its rate.');
      if (it.rateFromDictation) warn.push('“' + o.name + '” is charged at ₹' + o.rate + ' as you said (not the rate card).');
      return o;
    }).filter(function (o) { return o.name || o.rate; });
    /* dates already charged in an earlier bill */
    items.forEach(function (o) { (o._dates || []).forEach(function (dt) { if (done[dt]) warn.push(dmy(dt) + ' was already charged in ' + done[dt] + '.'); }); });
    /* CAT: at most 5 non-effective hearings in the whole case */
    if (cat) {
      var left = Math.max(0, 5 - ne), want = 0;
      items.forEach(function (o) { if (o._kind === 'noneffective' || NE_RX.test(o.name)) want += o.qty; });
      if (want > left) {
        var cut = want - left;
        for (var i = items.length - 1; i >= 0 && cut > 0; i--) {
          var o2 = items[i];
          if (!(o2._kind === 'noneffective' || NE_RX.test(o2.name))) continue;
          var take = Math.min(cut, o2.qty); o2.qty -= take; cut -= take;
          if (o2.qty > 0) o2.note = (o2.note ? o2.note + '\n' : '') + '(since more than 5, only charges for ' + o2.qty + ' sitting' + (o2.qty === 1 ? '' : 's') + ')';
        }
        items = items.filter(function (o) { return o.qty > 0; });
        warn.push(left === 0 ? 'No non-effective hearing is charged: the 5 allowed for this CAT case were already charged in earlier bills.'
                             : 'Non-effective hearings capped at ' + left + ' (5 for the whole case; ' + ne + ' already charged).');
      }
    }
    items.forEach(function (o) { delete o._kind; delete o._dates; });
    if (!items.length) throw new Error('Nothing chargeable was found in what you said. Please try again.');
    var nd = clone(A.currentDraft());
    nd.items = items;
    A.setDraft(nd, A.editingId());
    (out.doubts || []).forEach(function (q) { if (q) warn.push(q); });
    ready((out.said || r.heard ? '<div class="ai-said">' + esc(out.said || r.heard) + '</div>' : '') +
      '<div style="color:#127a4b;font-weight:600">✓ ' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' put in the bill by ' + r.engine + '. Check it on the right, then Save invoice.</div>' +
      (warn.length ? '<div class="ai-warn">' + warn.map(esc).join('<br>') + '</div>' : ''));
  } catch (e) { ready('<div class="ai-warn">' + esc(e.message) + '</div>'); }
}

/* ================================================================ 🎙 AUTO LETTER */
function letterText(l) {
  var d = document.createElement('div'); d.innerHTML = l.html || '';
  var t = $$('p, li', d).map(function (p) { return p.textContent.trim(); }).filter(Boolean).join('\n');
  return t || String(l.text || '');
}
function startLetter() {
  var bills = (db().invoices || []).slice().sort(function (a, b) { return String(b.date + b.number).localeCompare(String(a.date + a.number)); }).slice(0, 30);
  var last = A.lastSaved && A.lastSaved();
  var o = overlay('Auto letter',
    '<div class="ai-eng" id="ai-eng"></div>' +
    '<label class="ai-lbl">Which letter?</label>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-k="general">General letter</button><button class="btn" data-k="invoice">Letter attached to invoice</button></div>' +
    '<div id="ai-lbill" hidden><label class="ai-lbl">Bill</label><select id="ai-lsel">' + bills.map(function (v) {
      return '<option value="' + esc(v.id) + '"' + (last && last.id === v.id ? ' selected' : '') + '>' + esc(v.number + ' · ' + dmy(v.date) + ' · ' + String(v.reference || '').slice(0, 60)) + '</option>';
    }).join('') + '</select></div>' +
    '<div id="ai-step"></div>');
  var pick = engineChips($('#ai-eng', o.box)), kind = null, step = $('#ai-step', o.box), recr = null;
  o.onclose = function () { if (recr) recr.stop(true); };
  $$('[data-k]', o.box).forEach(function (b) {
    b.onclick = function () {
      kind = b.dataset.k;
      $$('[data-k]', o.box).forEach(function (x) { x.classList.toggle('primary', x === b); });
      $('#ai-lbill', o.box).hidden = kind !== 'invoice';
      if (kind === 'invoice' && !bills.length) { step.innerHTML = '<div class="ai-warn">There are no saved bills yet.</div>'; return; }
      step.innerHTML = '<p style="margin:10px 0 0;color:#555">' + (kind === 'invoice' ? 'Say anything to add to the usual covering letter, or just “the usual letter”.' : 'Say whom it is to, the subject, and what it should say.') + '</p><div id="ai-rh"></div>';
      if (recr) recr.stop(true);
      recr = new Recorder($('#ai-rh', step), function (inp) { recr = null; write(inp); });
      recr.start();
    };
  });
  async function write(inp) {
    var v = kind === 'invoice' ? (db().invoices || []).find(function (x) { return x.id === $('#ai-lsel', o.box).value; }) : null;
    busy($('#ai-rh', step), 'Writing the letter…');
    var samples = (db().letters || []).filter(function (l) { return l.status !== 'draft' && (l.kind || 'general') === kind; }).slice(-3);
    var task = 'Write the body of a letter for Adv. Sanket R. Charpe from his dictation. It goes on his printed letterhead; the date, letter number, "Thanking you" and the signature block are added by the tool — do NOT write them.\n\n' +
      (v ? 'THE BILL IT GOES WITH: ' + v.number + ' dated ' + dmy(v.date) + '; amount ₹' + A.money(A.totalOf(v)) + ' (' + A.amountWords(A.totalOf(v)) + '); reference: ' + (v.reference || '') + '; addressed to: ' + String(v.billTo || '').replace(/\n/g, ', ') + '\nItems: ' + (v.items || []).map(function (it) { return it.name + ' ₹' + it.rate + '×' + it.qty; }).join('; ') + '\n' : '') +
      (samples.length ? '\nHIS EARLIER LETTERS OF THIS KIND (follow their tone and layout):\n' + samples.map(function (l) { return '---\n' + letterText(l).slice(0, 1800); }).join('\n') + '\n---\n' : '') +
      '\nDICTATION: {{SAID}}\n\n' +
      'Write it in this exact plain-text layout:\nTo,\n<addressee, designation, office — one per line>\n\nSubject: <subject>' + (v ? ' (the case reference)' : '') + '\n\nSir/Madam,\n\n<paragraphs, formal Indian legal English, concise>\n\nEnclosures:\n<one enclosure per line, if any' + (v ? '; for a bill letter always: My bill No. ' + v.number + ' dated ' + dmy(v.date) + ' towards fee and expenses in the matter.' : '') + '>\n' +
      instrText('letter') +
      '\nReturn JSON: {"letter":"the letter text exactly in the layout above","said":"the dictation in words"}';
    try {
      var r = await run(pick(), inp, task, AI_SYS);
      var text = String((r.json || {}).letter || '').trim();
      if (!text) throw new Error('The AI sent back no letter. Please try again.');
      o.close();
      if (!window.CBL || !window.CBL.openFromText) { toast('This page needs reloading once to place letters'); return; }
      window.CBL.openFromText(kind, text, v, 'Letter prepared by ' + r.engine + ' — check it, then Save letter for its number');
    } catch (e) {
      var h = $('#ai-rh', step); if (h) h.innerHTML = '<div class="ai-warn">' + esc(e.message) + '</div>';
    }
  }
}

/* ================================================================ wiring: the buttons on the bill and letter pages */
function addBar() {
  css();
  var row = $('#m5-startrow');
  if (row && !$('#ai-bar')) {
    var bar = document.createElement('div'); bar.id = 'ai-bar'; bar.className = 'ai-bar';
    bar.innerHTML = '<button class="btn sm ai-go" id="ai-inv" title="Say the case, then what happened on each date">🎙 Auto invoice</button>' +
      '<button class="btn sm ai-go" id="ai-let" title="General letter or a letter with a bill, by voice">🎙 Auto letter</button>' +
      '<button class="btn sm" id="ai-ins" title="Standing instructions followed every time">📋 Instructions</button>' +
      '<button class="btn sm" id="ai-set" title="Gemini / Claude keys and defaults">⚙ AI</button>';
    row.parentNode.insertBefore(bar, row);
    $('#ai-inv').onclick = startInvoice; $('#ai-let').onclick = startLetter;
    $('#ai-ins').onclick = openInstructions; $('#ai-set').onclick = openSettings;
  }
  var lv = $('#m5-new-inv');
  if (lv && !$('#ai-let2')) {
    var b = document.createElement('button'); b.className = 'btn sm ai-go'; b.id = 'ai-let2'; b.type = 'button'; b.textContent = '🎙 Auto letter';
    b.style.cssText = 'background:#1b2a41;color:#fff;border-color:#1b2a41;margin-left:6px';
    b.onclick = startLetter; lv.parentNode.insertBefore(b, lv.nextSibling);
  }
}
/* the drawer belongs to the bill it was opened for: once that bill is saved, it closes */
setInterval(function () {
  if (!DR) return;
  var ls = A.lastSaved && A.lastSaved();
  if (DR.saved === undefined) { DR.saved = ls ? ls.id : null; return; }
  if (ls && ls.id !== DR.saved) { var no = ls.number; closeDrawer(); toast('Saved as ' + no); }
}, 1500);
if (A.hooks) A.hooks.push(function () { addBar(); });
addBar();
window.CBAI = { startInvoice: startInvoice, startLetter: startLetter, openInstructions: openInstructions, openSettings: openSettings, closeDrawer: closeDrawer, _findCases: findCases, _cnKey: cnKey, _refMatches: refMatches };
})();
