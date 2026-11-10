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
    '.ai-drawer[hidden]{display:none!important}.ai-conv{width:min(46vw,680px)!important}.ai-cases{padding:6px 12px;background:#fff;border-bottom:1px solid #d5dbe4;max-height:24vh;overflow:auto}.ai-case{display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-bottom:1px dotted #e2e6ec;font-size:13px}.ai-case>div:first-child{flex:1;min-width:0}.ai-cbtn{display:flex;gap:4px}.ai-pane{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}.ai-pane[hidden],.ai-pdfv[hidden]{display:none!important}.ai-pdfv{flex:1;min-height:0;display:flex;flex-direction:column}.ai-pvh{padding:6px 12px;background:#fff;border-bottom:1px solid #d5dbe4}.ai-log{padding:10px 12px;display:flex;flex-direction:column;gap:8px}.ai-m{max-width:92%;padding:8px 11px;border-radius:12px;font-size:13.5px;white-space:pre-wrap;line-height:1.45}.ai-m.me{align-self:flex-end;background:#1668e3;color:#fff;border-bottom-right-radius:4px}.ai-m.me small{color:#dbe6ff}.ai-m.ai{align-self:flex-start;background:#fff;border:1px solid #d5dbe4;border-bottom-left-radius:4px}.ai-m.q{border-color:#f0c36d;background:#fffaf0}.ai-pick{white-space:normal;margin-top:8px}.ai-pick label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}.ai-pick label input{width:auto;margin-top:3px}.ai-pg{padding:4px 0;border-top:1px dotted #e2e6ec}.ai-bills{padding:4px 12px 12px}.ai-bh{font-weight:700;margin:6px 0}.ai-bill{background:#fff;border:1px solid #d5dbe4;border-radius:10px;padding:8px 10px;margin:0 0 8px;font-size:13px}.ai-bill.open{border-color:#1668e3;box-shadow:0 0 0 2px #cfe0ff}.ai-bill.saved{opacity:.75}.ai-bill ul{margin:6px 0;padding-left:18px}.ai-bill li{margin:2px 0}.ai-bf{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ai-tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:8px;background:#eef3fb;color:#1b4d9b;border:1px solid #cddcf3}.ai-tag.ok{background:#e9f7ef;color:#127a4b;border-color:#bfe5cf}.ai-foot{padding:8px 12px;border-top:1px solid #c9d0da;background:#fff}.ai-in{display:flex;gap:8px;align-items:center}.ai-in textarea{flex:1;font:inherit;font-size:13.5px;padding:7px 9px;border:1px solid #c9d0da;border-radius:8px;resize:vertical;min-height:40px}.ai-mic.sm{width:46px;height:46px}.ai-mic.sm span{width:14px;height:22px}.ai-status{font-size:12.5px;color:#555;min-height:18px;margin-top:4px}.ai-replying{font-size:12.5px;background:#fffaf0;border:1px solid #f0c36d;border-radius:8px;padding:4px 8px;margin-bottom:6px}.ai-prev{overflow:auto;max-height:72vh;background:#e9ecf1;padding:10px;border-radius:8px}.ai-prev .sheet{zoom:.72;margin:0 auto}' +
    '@media (max-width:900px){.ai-drawer,.ai-conv{width:100vw!important;height:62vh;top:auto;border-right:0;border-top:1px solid #c9d0da}}';
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

/* ================================================================ 🎙 AUTO INVOICE — a conversation
   You speak (or type) as often as you like: the cases, which bills are separate and which
   common, what happened on which dates, the heads to charge, corrections, answers to the
   AI's questions — even while it is still working (it starts again with everything said).
   The drafts are kept here until each one is opened in the form and saved. */

/* ---- one AI call that can carry PDFs (the orders) as well as text ---- */
async function aiCall(engine, parts, system, signal) {
  var c = aiCfg();
  var order = [engine, engine === 'gemini' ? 'claude' : 'gemini'].filter(function (e, i) { return i === 0 || hasKey(e); });
  var last = null;
  for (var i = 0; i < order.length; i++) {
    var eng = order[i];
    try {
      var t;
      if (eng === 'gemini') {
        if (!c.gemKey) throw new Error('Add your Gemini API key first (⚙ AI).');
        var gp = parts.map(function (p) { return p.pdf ? { inline_data: { mime_type: 'application/pdf', data: p.pdf } } : { text: p.text }; });
        var body = { contents: [{ role: 'user', parts: gp }], systemInstruction: { parts: [{ text: system }] },
                     generationConfig: { temperature: 0.2, maxOutputTokens: 32768, responseMimeType: 'application/json' } };
        var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.gemModel) + ':generateContent?key=' + encodeURIComponent(c.gemKey),
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error('Gemini: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
        var cand = j.candidates && j.candidates[0];
        t = cand && cand.content && (cand.content.parts || []).map(function (p) { return p.thought ? '' : (p.text || ''); }).join('');
        if (!t) throw new Error('Gemini sent back nothing' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.');
      } else {
        if (!c.claudeKey) throw new Error('Add your Claude API key first (⚙ AI).');
        var cp = parts.map(function (p) { return p.pdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.pdf }, title: p.title || 'Orders' } : { type: 'text', text: p.text }; });
        cp.push({ type: 'text', text: 'Reply with the JSON only.' });
        var r2 = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: signal,
          headers: { 'content-type': 'application/json', 'x-api-key': c.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: c.claudeModel, max_tokens: 16000, system: system, messages: [{ role: 'user', content: cp }] }) });
        var j2 = await r2.json().catch(function () { return {}; });
        if (!r2.ok) throw new Error('Claude: ' + ((j2.error && j2.error.message) || 'HTTP ' + r2.status));
        t = (j2.content || []).map(function (p) { return p.text || ''; }).join('');
      }
      return { json: parseJson(t), engine: eng === 'gemini' ? 'Gemini' : 'Claude' };
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      last = e;
      if (i + 1 < order.length) toast(e.message + ' — trying ' + (order[i + 1] === 'claude' ? 'Claude' : 'Gemini') + ' instead');
    }
  }
  throw last;
}

/* ---- what earlier bills already charged, case by case ---- */
var RATE_FROM = /revised\s+rate\s+(?:from|w\.?e\.?f\.?)\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}/gi;
function itemDates(it) {
  var out = [];
  String((it.name || '') + ' ' + (it.note || '')).replace(RATE_FROM, ' ').replace(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/g, function (m, d, mo, y) {
    var iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2); if (out.indexOf(iso) < 0) out.push(iso); return m; });
  return out;
}
function caseTag(c) { var k = cnKey(c.cn); return k.n ? new RegExp('(^|\\D)0*' + k.n + '\\s*(\\/|OF|-)\\s*' + k.y + '(\\D|$)', 'i') : null; }
/* in a common bill, an item belongs to the case its note names; an item naming no case belongs to every case of the bill */
function itemForCase(it, c, allTags) {
  var txt = String((it.name || '') + ' ' + (it.note || '')), mine = caseTag(c);
  if (mine && mine.test(txt)) return true;
  return !allTags.some(function (rx) { return rx.test(txt); });
}
function caseHistory(c) {
  var bills = priorBills(c), dates = {}, ne = 0, lastD = '';
  bills.forEach(function (v) {
    var tags = cases().filter(function (k) { return refMatches(v.reference, k); }).map(caseTag).filter(Boolean);
    (v.items || []).forEach(function (it) {
      if (!itemForCase(it, c, tags)) return;
      if (NE_RX.test(it.name || '')) ne += Number(it.qty) || 0;
      itemDates(it).forEach(function (d) { dates[d] = v.number; if (d > lastD) lastD = d; });
    });
  });
  return { bills: bills, dates: dates, ne: ne, last: lastD };
}
function incNo(n, k) { return k ? String(n).replace(/(\d+)(?!.*\d)/, function (m) { return String(+m + k).padStart(m.length, '0'); }) : n; }

/* ---- the session ---- */
var SK = 'cs_ai_inv';
var SS = null;      /* {log:[], said:[], cases:[ids], pend:null, plan:null, saved:{}, engine} */
var UI = null;      /* the drawer */
function ssLoad() { try { var s = JSON.parse(localStorage.getItem(SK) || 'null'); if (s && s.log) return s; } catch (e) {} return null; }
function ssSave() { try { localStorage.setItem(SK, JSON.stringify(SS)); } catch (e) {} }
function ssNew() { SS = { log: [], said: [], cases: [], pend: null, plan: null, saved: {}, engine: aiCfg().def, at: Date.now() }; ssSave(); }
function caseById(id) { return cases().find(function (c) { return c.id === id; }) || null; }
function say(who, text, extra) { var m = Object.assign({ who: who, text: String(text || ''), at: Date.now() }, extra || {}); SS.log.push(m); ssSave(); paintLog(); return m; }

function startInvoice() {
  css();
  var old = ssLoad();
  if (old && (old.said.length || old.cases.length) && !UI) {
    var o = overlay('Auto invoice', '<p style="margin:0 0 10px">You have an Auto invoice in progress (' + old.said.length + ' instruction' + (old.said.length === 1 ? '' : 's') + (old.plan ? ', ' + (old.plan.invoices || []).length + ' draft bill(s)' : '') + ').</p>' +
      '<div class="ai-row"><button class="btn" id="ai-ss-new">Start afresh</button><button class="btn primary" id="ai-ss-go">Continue it</button></div>');
    $('#ai-ss-go').onclick = function () { o.close(); SS = old; openDrawer(false); };
    $('#ai-ss-new').onclick = function () { o.close(); ssNew(); openDrawer(true); };
    return;
  }
  if (UI) { UI.el.hidden = false; return; }
  ssNew(); openDrawer(true);
}

function openDrawer(listenNow) {
  closeDrawer();
  var el = document.createElement('div'); el.className = 'ai-drawer ai-conv';
  el.innerHTML =
    '<div class="ai-dh"><b>🎙 Auto invoice</b><button class="btn sm" id="ai-new" title="Forget this conversation and start again">New</button><button class="btn sm" id="ai-hide" title="Hide; the button 🎙 Auto invoice brings it back">Hide</button></div>' +
    '<div class="ai-cases" id="ai-cases"></div>' +
    '<div class="ai-pane" id="ai-pane">' +
      '<div class="ai-log" id="ai-log"></div>' +
      '<div class="ai-bills" id="ai-bills"></div>' +
    '</div>' +
    '<div class="ai-pdfv" id="ai-pdfv" hidden></div>' +
    '<div class="ai-foot">' +
      '<div class="ai-replying" id="ai-replying" hidden></div>' +
      '<div class="ai-eng" id="ai-deng" style="margin:0 0 6px"></div>' +
      '<div class="ai-in"><button class="ai-mic sm" id="ai-mic" type="button" title="Speak (press again to finish)"><span></span></button>' +
        '<textarea id="ai-txt" rows="2" placeholder="Speak with the microphone, or type here — a new instruction, a correction, or an answer — any time"></textarea>' +
        '<button class="btn primary" id="ai-send" type="button">Send</button></div>' +
      '<div class="ai-status" id="ai-status"></div>' +
    '</div>';
  document.body.appendChild(el);
  UI = { el: el, rec: null, ac: null, replyTo: null, busy: false, url: null };
  $('#ai-hide', el).onclick = function () { el.hidden = true; toast('Auto invoice hidden — press 🎙 Auto invoice to continue'); };
  $('#ai-new', el).onclick = function () { if (!confirm('Forget this Auto invoice conversation and its unsaved draft bills?')) return; abortRun(); ssNew(); paintAll(); };
  engineChips($('#ai-deng', el), function (e) { SS.engine = e; ssSave(); });
  /* the chips start at the first default; keep the one chosen in this conversation */
  if (SS.engine && SS.engine !== aiCfg().def) { var b = $('#ai-deng button[data-e="' + SS.engine + '"]', el); if (b) b.click(); }
  $('#ai-send', el).onclick = function () { var t = $('#ai-txt', el).value.trim(); if (!t) return; $('#ai-txt', el).value = ''; heard(t); };
  $('#ai-txt', el).addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#ai-send', el).click(); });
  $('#ai-mic', el).onclick = micToggle;
  paintAll();
  if (!SS.log.length) say('ai', 'Say the case or cases and what is to be charged — e.g. “Prepare separate bills for O.A. 297 of 2026 Gondnale and O.A. 935 of 2025 Wakodkar. In Gondnale, 10th September was heard at length; the other sittings non-effective. Add typing and Xerox 450 rupees.” Or ask for one common bill for both. You can speak again at any time to add or correct anything.');
  if (listenNow) micToggle();
}
function closeDrawer() { if (UI) { abortRun(); if (UI.rec) try { UI.rec.stop(true); } catch (e) {} if (UI.url) URL.revokeObjectURL(UI.url); UI.el.remove(); UI = null; } }
function status(t, spin) { if (!UI) return; $('#ai-status', UI.el).innerHTML = t ? (spin ? '<span class="ai-spin" style="width:13px;height:13px;border-width:2px;display:inline-block;vertical-align:-2px"></span> ' : '') + esc(t) : ''; }

/* ---- the microphone in the drawer: speak → typed by Gemini → treated like typed text ---- */
var MREC = null;
async function micToggle() {
  if (!UI) return;
  var mic = $('#ai-mic', UI.el);
  if (MREC && MREC.state === 'recording') { MREC.stop(); return; }
  var stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { status('The microphone could not be used (' + (e.message || e.name) + '). Type instead.'); return; }
  var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); })[0] || '';
  var chunks = [], rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), t0 = Date.now(), tm;
  MREC = rec;
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = async function () {
    clearInterval(tm); stream.getTracks().forEach(function (t) { t.stop(); }); MREC = null;
    if (!UI) return;
    mic.classList.remove('on');
    var blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    if (blob.size < 1500) { status('Nothing was heard.'); return; }
    status('Typing what you said…', true);
    try { var t = await transcribe(blob); if (!t) { status('Nothing was heard.'); return; } heard(t); }
    catch (e) { status(e.message); }
  };
  rec.start(1000); mic.classList.add('on');
  var tick = function () { var s = Math.round((Date.now() - t0) / 1000); status('Listening ' + Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2) + ' — press the microphone when you finish'); };
  tick(); tm = setInterval(tick, 500);
}

/* ---- everything you say comes here ---- */
function heard(text) {
  if (!UI) return;
  var reply = UI.replyTo;
  UI.replyTo = null; paintReplying();
  if (reply != null) {
    var q = SS.log[reply];
    if (q && q.q) q.answered = true;
    say('me', text, { reply: q ? q.text : '' });
    SS.said.push('Answer to your question “' + (q ? q.text : '') + '”: ' + text);
  } else {
    say('me', text);
    SS.said.push(text);
  }
  ssSave();
  next();
}
function abortRun() { if (UI && UI.ac) { try { UI.ac.abort(); } catch (e) {} UI.ac = null; } }
function next() {
  abortRun();
  if (!SS.cases.length || SS.pend) return identify();
  return plan();
}

/* ---- 1. which cases? (as many as were said) ---- */
async function identify() {
  var ac = new AbortController(); UI.ac = ac;
  status('Finding the cases…', true);
  try {
    var r = await aiCall(SS.engine, [{ text:
      'The advocate is asking for fee bills. Pick out EVERY case he mentions (there may be one, two or more).\n' +
      'WHAT HE SAID SO FAR:\n' + SS.said.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' +
      (SS.cases.length ? 'CASES ALREADY CONFIRMED: ' + SS.cases.map(function (id) { var c = caseById(id); return c ? c.cn + ' ' + ctit(c) : ''; }).join('; ') + ' (list only further cases)\n\n' : '') +
      'Return JSON: {"cases":[{"type":"O.A. / ULP / W.P. / R.C.S. …","number":"","year":"","parties":"names said","court":"court as said","said":"how he referred to it"}]}' }], AI_SYS, ac.signal);
    if (ac !== UI.ac) return;
    UI.ac = null;
    var want = (r.json.cases || []).filter(function (q) { return q && (q.number || q.parties); });
    SS.pend = want.map(function (q) {
      var hits = findCases(q).filter(function (h) { return SS.cases.indexOf(h.c.id) < 0; });
      return { q: q, hits: hits.map(function (h) { return { id: h.c.id, s: h.s }; }) };
    });
    ssSave();
    if (!SS.pend.length) {
      SS.pend = null; ssSave();
      if (SS.cases.length) return plan();
      say('ai', 'I could not make out which case the bill is for. Please say the case number and the parties, or pick the cases below.', { pick: true });
      paintPick(true); status(''); return;
    }
    status('');
    say('ai', 'Please confirm the case' + (SS.pend.length > 1 || (SS.pend[0].hits.length > 1) ? 's' : '') + ' — tick every one the bills are for (you can tick more than one), then press “These are the cases”.', { pick: true });
    paintPick(true);
  } catch (e) {
    if (e.name === 'AbortError') return;
    UI.ac = null; status(''); say('ai', '⚠ ' + e.message);
  }
}

/* ---- 2. the bills ---- */
function catalogLines() { return (db().catalog || []).map(function (k) { return k.id + ' | ' + k.name + ' | ₹' + k.rate + (k.clerkable === false ? ' | expense (no clerkage)' : ''); }).join('\n'); }
async function ordersPdf(c) {
  if (c._pdf !== undefined) return c._pdf;
  try {
    var cw = casesWin(); if (!cw) return (c._pdf = null);
    if (!cw.f.getAttribute('src')) cw.f.setAttribute('src', 'cases.html');
    var t0 = Date.now();
    while (!(cw.f.contentWindow && cw.f.contentWindow.ordMergedPdf) && Date.now() - t0 < 20000) await new Promise(function (r) { setTimeout(r, 400); });
    var w = cw.f.contentWindow;
    if (!w || !w.ordMergedPdf) return (c._pdf = null);
    var r = await w.ordMergedPdf(c.id);
    if (!r || !r.blob) return (c._pdf = null);
    c._pdf = { blob: r.blob, size: r.blob.size };
    return c._pdf;
  } catch (e) { return (c._pdf = null); }
}
var PDFS = {};   /* case id → {blob,size} for this page visit */
async function plan() {
  var ac = new AbortController(); UI.ac = ac;
  var cs = SS.cases.map(caseById).filter(Boolean);
  if (!cs.length) return identify();
  status('Reading the orders and the earlier bills…', true);
  var info = [], parts = [], total = 0;
  for (var i = 0; i < cs.length; i++) {
    var c = cs[i], h = caseHistory(c), cat = isCat(c);
    var p = PDFS[c.id] !== undefined ? PDFS[c.id] : (PDFS[c.id] = await ordersPdf(c));
    if (ac !== UI.ac) return;
    var useP = p && p.size < 12e6 && total + p.size < 24e6;
    if (useP) { total += p.size; parts.push({ pdf: await b64(p.blob), title: 'Orders — ' + c.cn }); parts.push({ text: '(The PDF just above holds all the downloaded orders of ' + c.cn + ', in date order.)' }); }
    info.push({ c: c, h: h, cat: cat, pdf: !!useP });
  }
  paintCases(info);
  var cur = SS.plan ? JSON.stringify({ invoices: (SS.plan.invoices || []).filter(function (v) { return !v.savedAs; }).map(function (v) { return { cases: v.cases, billTo: v.billTo, reference: v.reference, items: v.items }; }) }) : '';
  var task =
    'Prepare the professional fee bill(s) from everything the advocate has said.\nTODAY: ' + dmy(today()) + '\n\n' +
    'CASES:\n' + info.map(function (x, k) {
      var c = x.c, hd = hearingDates(c);
      return '[' + c.id + '] ' + c.cn + ' — ' + ctit(c) + '\n  Court: ' + (c.court || '') + (x.cat ? ' (Central Administrative Tribunal)' : '') + '\n  Client: ' + (c.cl || '') +
        '\n  Earlier bills: ' + (x.h.bills.length ? x.h.bills.map(function (v) { return v.number + ' (' + dmy(v.date) + ')'; }).join(', ') : 'none') +
        '\n  LAST DATE ALREADY CHARGED: ' + (x.h.last ? dmy(x.h.last) : 'none') +
        (x.cat ? '\n  Non-effective hearings already charged in this case: ' + x.h.ne + ' of the 5 allowed' : '') +
        (Object.keys(x.h.dates).length ? '\n  Dates already charged: ' + Object.keys(x.h.dates).sort().map(function (d) { return dmy(d) + ' (' + x.h.dates[d] + ')'; }).join(', ') : '') +
        (hd.length ? '\n  Dates on record (court site / diary):\n' + hd.map(function (z) { return '    ' + dmy(z.d) + ': ' + z.t; }).join('\n') : '') +
        '\n  Orders PDF attached: ' + (x.pdf ? 'yes' : 'no');
    }).join('\n\n') + '\n\n' +
    (info.some(function (x) { return x.h.bills.length; }) ? 'EARLIER BILLS IN FULL (style of headings and notes to follow):\n' + info.map(function (x) { return x.h.bills.slice(-2).map(billText).join('\n'); }).filter(Boolean).join('\n') + '\n\n' : '') +
    'RATE CARD (id | item title | rate):\n' + catalogLines() + '\n\n' +
    'WHAT THE ADVOCATE SAID, IN ORDER (later instructions and corrections override earlier ones):\n' + SS.said.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n') + '\n\n' +
    (cur ? 'THE DRAFT BILLS AS THEY STAND (revise them; return the complete new set):\n' + cur + '\n\n' : '') +
    'RULES:\n' +
    '1. One bill per case, unless he asks for a common (combined, joint, one) bill for some cases — then those cases share one bill. If it is not clear which he wants for two or more cases, ask.\n' +
    '2. In a common bill, begin every note with the case it belongs to, e.g. "O.A. 297/2026 — On 10/09/2026 …", and put the case id in "case". The reference of a common bill names all its cases.\n' +
    '3. Charge only sittings AFTER the last date already charged for that case, unless he names an earlier date; never charge a date that is in "Dates already charged" unless he insists — and then say so in "notes".\n' +
    '4. Which sittings to charge: those he names; if he says e.g. "all sittings since the last bill", take the dates on record after the last charged date up to today.\n' +
    '5. Effective or non-effective: as he says. Where he does not say, decide from the order of that date in the attached orders PDF (or, if there is none, the business on record): EFFECTIVE if the matter was actually taken up — heard, argued, reply/rejoinder taken on record and heard, interim relief heard, order or judgment pronounced, evidence; NON-EFFECTIVE if adjourned, not reached, time sought, leave note, no board. Give the reason in "why" and set "basis" to "said", "order" or "record".\n' +
    '6. One line per effective hearing (qty 1; note e.g. "On 10/09/2026 the Hon\'ble Tribunal heard the matter at length."). Non-effective hearings of a case go in ONE line with qty = their number and the dates in the note ("Dates: 03/02/2026, 17/02/2026").\n' +
    '7. CAT cases: at most 5 non-effective hearings in the whole case (the count already charged is given). Effective hearings have no limit.\n' +
    '8. Other heads as he says (drafting the reply/written statement, conference, opinion, notice, appearance, typing, Xerox, postage, travel …): rate-card item when one fits (catalogId), otherwise his amount. Expenses: kind "expense", clerkable false, heading as he says it and his narration as the note. Never add a head or an expense he did not mention.\n' +
    '9. Use the rate-card rate unless he gives another amount (then rateFromDictation true). Do not add clerkage — the tool adds it.\n' +
    '10. billTo and reference: as in the earlier bills of that case/client; if unknown, leave billTo empty and ask.\n' +
    '11. Ask a question ONLY where you genuinely cannot decide (separate or common; a head with no rate and no amount; an unclear date; to whom the bill goes). Ask each thing once; do not ask what has already been answered. Make the drafts anyway with your best reading.\n' +
    instrText('invoice') +
    '\nReturn JSON: {"invoices":[{"cases":["case id",…],"billTo":"","reference":"","items":[{"case":"case id or null","catalogId":"k1 or null","name":"heading","rate":0,"qty":1,"note":"","kind":"effective|noneffective|fee|expense","dates":["YYYY-MM-DD"],"basis":"said|order|record|","why":"short reason when decided from an order","clerkable":true,"rateFromDictation":false}]}],' +
    '"questions":["…"],"notes":["anything he should know: dates already charged that he asked for, orders that were unclear, …"],"newCases":[{"type":"","number":"","year":"","parties":""}]}\n' +
    '"newCases": only cases he mentions that are NOT among the CASES above.';
  parts.unshift({ text: task });
  status('Preparing the bill' + (cs.length > 1 ? 's' : '') + ' with ' + (SS.engine === 'claude' ? 'Claude' : 'Gemini') + '…', true);
  try {
    var r = await aiCall(SS.engine, parts, AI_SYS, ac.signal);
    if (!UI || ac !== UI.ac) return;
    UI.ac = null; status('');
    settle(r, info);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (UI) UI.ac = null;
    status(''); say('ai', '⚠ ' + e.message + ' — speak again or press Send to retry.');
  }
}

/* checks the AI must not be trusted with: the CAT cap, dates already charged, rates */
function settle(r, info) {
  var out = r.json || {}, byId = {}, warn = [];
  info.forEach(function (x) { byId[x.c.id] = x; });
  var keepSaved = SS.plan ? (SS.plan.invoices || []).filter(function (v) { return v.savedAs; }) : [];
  var invs = (out.invoices || []).map(function (v) {
    var ids = (v.cases || []).filter(function (id) { return byId[id]; });
    if (!ids.length && info.length === 1) ids = [info[0].c.id];
    var items = (v.items || []).map(function (it) {
      var k = it.catalogId && (db().catalog || []).find(function (z) { return z.id === it.catalogId; });
      var o = { name: String(it.name || (k && k.name) || '').trim(), hsn: (k && k.hsn) || '', qty: Math.max(1, Math.round(Number(it.qty) || 1)),
                note: String(it.note || '').trim(), clerkable: it.kind === 'expense' ? false : (it.clerkable !== false),
                _k: it.kind, _d: (it.dates || []).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }), _c: byId[it.case] ? it.case : (ids.length === 1 ? ids[0] : null), _b: it.basis || '', _w: it.why || '' };
      if (k && !it.rateFromDictation) { o.name = k.name; o.rate = Number(k.rate) || 0; if (k.clerkable === false) o.clerkable = false; }
      else o.rate = Number(it.rate) || (k ? Number(k.rate) : 0) || 0;
      if (!k && it.kind !== 'expense' && !it.rateFromDictation) warn.push('“' + o.name + '” is not on the rate card — check its rate (₹' + o.rate + ').');
      if (it.rateFromDictation) warn.push('“' + o.name + '” at ₹' + o.rate + ' as you said (not the rate card).');
      return o;
    }).filter(function (o) { return o.name || o.rate; });
    return { cases: ids, billTo: String(v.billTo || ''), reference: String(v.reference || ''), items: items };
  }).filter(function (v) { return v.items.length; });
  /* dates already charged, and dates before the last charged date */
  invs.forEach(function (v) { v.items.forEach(function (o) {
    var x = o._c && byId[o._c]; if (!x) return;
    o._d.forEach(function (d) {
      if (x.h.dates[d]) warn.push(x.c.cn + ': ' + dmy(d) + ' was already charged in ' + x.h.dates[d] + '.');
      else if (x.h.last && d < x.h.last) warn.push(x.c.cn + ': ' + dmy(d) + ' is before the last date already charged (' + dmy(x.h.last) + ').');
    });
  }); });
  /* CAT: at most 5 non-effective hearings in the whole case — across earlier bills AND these drafts */
  info.filter(function (x) { return x.cat; }).forEach(function (x) {
    var left = Math.max(0, 5 - x.h.ne), want = 0;
    var mine = [];
    invs.forEach(function (v) { v.items.forEach(function (o) { if (o._c === x.c.id && (o._k === 'noneffective' || NE_RX.test(o.name))) { want += o.qty; mine.push(o); } }); });
    if (want <= left) return;
    var cut = want - left;
    for (var i = mine.length - 1; i >= 0 && cut > 0; i--) {
      var o = mine[i], take = Math.min(cut, o.qty); o.qty -= take; cut -= take;
      if (o.qty > 0) o.note = (o.note ? o.note + '\n' : '') + '(since more than 5, only charges for ' + o.qty + ' sitting' + (o.qty === 1 ? '' : 's') + ')';
    }
    warn.push(x.c.cn + ': ' + (left === 0 ? 'no non-effective hearing charged — the 5 allowed were already charged in earlier bills.' : 'non-effective hearings capped at ' + left + ' (5 in the whole case; ' + x.h.ne + ' already charged).'));
  });
  invs.forEach(function (v) {
    v.items = v.items.filter(function (o) { return o.qty > 0; });
    var c0 = caseById(v.cases[0]);
    var who = c0 ? clientFor(c0, byId[c0.id] ? byId[c0.id].h.bills : []) : { clientId: '', billTo: '' };
    v.clientId = who.clientId; if (!v.billTo) v.billTo = who.billTo;
    if (!v.reference) v.reference = v.cases.map(function (id) { var c = caseById(id); return c ? c.cn + ' ' + ctit(c) : ''; }).join('; ');
    if (!v.billTo) warn.push('Bill for ' + v.cases.map(function (id) { var c = caseById(id); return c ? c.cn : ''; }).join(' + ') + ': to whom is it addressed? (Bill To is empty.)');
  });
  invs = invs.filter(function (v) { return v.items.length; });
  SS.plan = { invoices: keepSaved.concat(invs), at: Date.now(), engine: r.engine };
  var qs = (out.questions || []).filter(Boolean);
  var notes = (out.notes || []).filter(Boolean).concat(warn);
  say('ai', '✓ ' + invs.length + ' draft bill' + (invs.length === 1 ? '' : 's') + ' prepared by ' + r.engine + ' — below. Open one in the form to check it and Save invoice; 👁 shows it as it will print.' + (notes.length ? '' : ''), { notes: notes });
  qs.forEach(function (q) { say('ai', q, { q: true }); });
  var nc = (out.newCases || []).filter(function (q) { return q && (q.number || q.parties); });
  if (nc.length) {
    SS.pend = nc.map(function (q) { return { q: q, hits: findCases(q).filter(function (h) { return SS.cases.indexOf(h.c.id) < 0; }).map(function (h) { return { id: h.c.id, s: h.s }; }) }; });
    say('ai', 'You also mentioned ' + nc.map(function (q) { return [q.type, q.number && q.year ? q.number + '/' + q.year : q.number, q.parties].filter(Boolean).join(' '); }).join('; ') + '. Tick it below to include it.', { pick: true });
  }
  ssSave(); paintAll();
  /* the first unsaved bill goes into the form at once, so its preview is on the right */
  var first = SS.plan.invoices.findIndex(function (v) { return !v.savedAs; });
  if (first >= 0) openInForm(first, true);
}

/* ---- drafts → the form, and the preview ---- */
function draftOf(v, k) {
  var d = A.blankDraft();
  d.number = incNo(d.number, k || 0);
  d.clientId = v.clientId || ''; d.billTo = v.billTo || ''; d.reference = v.reference || '';
  d.items = v.items.map(function (o) { return { name: o.name, hsn: o.hsn || '', rate: o.rate, qty: o.qty, note: o.note, clerkable: o.clerkable }; });
  return d;
}
function unsavedIndex(i) { var k = 0; (SS.plan.invoices || []).forEach(function (v, j) { if (j < i && !v.savedAs) k++; }); return k; }
function openInForm(i, quiet) {
  var v = SS.plan && SS.plan.invoices[i]; if (!v || v.savedAs) return;
  var cur = A.currentDraft(), mine = UI && UI.open != null;   /* the form holds one of these drafts already */
  if (!mine && (A.editingId() || A.draftHasContent(cur))) {
    if (quiet) { toast('Draft bills are ready in Auto invoice — the bill on screen was left as it is'); return; }
    if (!confirm('The bill on screen has not been saved. Replace it with this draft?')) return;
  }
  A.setDraft(draftOf(v, 0), null); A.go('build');
  if (UI) { UI.open = i; UI.openSaved = (A.lastSaved && A.lastSaved()) ? A.lastSaved().id : null; }
  paintBills();
}
function preview(i) {
  var v = SS.plan.invoices[i]; if (!v) return;
  var d = v.savedAs ? (db().invoices || []).find(function (x) { return x.number === v.savedAs; }) : draftOf(v, unsavedIndex(i));
  if (!d) return;
  if (!v.savedAs) d.isDraft = true;
  var html = A.sheetHTML ? A.sheetHTML(d) : '';
  var o = overlay((v.savedAs ? 'Saved bill ' + v.savedAs : 'Draft bill — as it will print') , '<div class="ai-prev">' + (html || '<p>Reload Billing once to see the preview.</p>') + '</div>' +
    '<div class="ai-row">' + (v.savedAs ? '' : '<button class="btn primary" id="ai-pv-open">Open in the form</button>') + '<button class="btn" id="ai-pv-x">Close</button></div>');
  o.box.style.width = 'min(900px,100%)';
  $('#ai-pv-x').onclick = o.close;
  if (!v.savedAs) $('#ai-pv-open').onclick = function () { o.close(); openInForm(i); };
}
/* a bill saved from the form: mark its draft as saved */
setInterval(function () {
  if (!UI || UI.open == null || !SS || !SS.plan) return;
  var ls = A.lastSaved && A.lastSaved();
  if (ls && ls.id !== UI.openSaved) {
    var v = SS.plan.invoices[UI.open];
    if (v && !v.savedAs) { v.savedAs = ls.number; say('ai', '✓ Saved as ' + ls.number + '.'); }
    UI.open = null; UI.openSaved = ls.id; ssSave(); paintBills();
    var nx = SS.plan.invoices.findIndex(function (x) { return !x.savedAs; });
    if (nx >= 0) say('ai', 'Next: ' + billLabel(SS.plan.invoices[nx]) + ' — press “Open in the form”.');
  }
}, 1500);

/* ---- painting ---- */
function billLabel(v) { return v.cases.map(function (id) { var c = caseById(id); return c ? c.cn : '?'; }).join(' + ') + (v.cases.length > 1 ? ' (common bill)' : ''); }
function paintAll() { paintCases(); paintLog(); paintBills(); paintReplying(); }
function paintCases(info) {
  if (!UI) return;
  var host = $('#ai-cases', UI.el);
  var cs = SS.cases.map(caseById).filter(Boolean);
  host.innerHTML = cs.length ? cs.map(function (c) {
    var h = caseHistory(c), cat = isCat(c);
    var x = info && info.find(function (z) { return z.c.id === c.id; });
    return '<div class="ai-case"><div><b>' + esc(c.cn || '') + '</b> ' + esc(ctit(c)) + '<br><small>' + esc(c.court || '') +
      ' · last charged: <b>' + (h.last ? dmy(h.last) : '—') + '</b>' + (h.bills.length ? ' (' + esc(h.bills[h.bills.length - 1].number) + ')' : '') +
      (cat ? ' · non-effective charged: <b>' + h.ne + '/5</b>' : '') + (x ? (x.pdf ? ' · orders read' : ' · <span style="color:#a15c00">no orders downloaded</span>') : '') + '</small></div>' +
      '<div class="ai-cbtn"><button class="btn sm" data-ord="' + esc(c.id) + '" title="See the orders of this case">📄</button><button class="btn sm" data-rm="' + esc(c.id) + '" title="Remove this case">×</button></div></div>';
  }).join('') + '<button class="btn sm" id="ai-addcase" style="margin:4px 0 0">＋ Add a case</button>' : '';
  $$('[data-rm]', host).forEach(function (b) { b.onclick = function () { SS.cases = SS.cases.filter(function (id) { return id !== b.dataset.rm; }); ssSave(); paintCases(); say('ai', 'Removed. Speak or press Send to prepare the bills again.'); }; });
  $$('[data-ord]', host).forEach(function (b) { b.onclick = function () { showPdf(b.dataset.ord); }; });
  var ad = $('#ai-addcase', host); if (ad) ad.onclick = function () { say('ai', 'Pick the case to add.', { pick: true }); paintPick(true); };
}
function paintLog() {
  if (!UI) return;
  var host = $('#ai-log', UI.el);
  host.innerHTML = SS.log.map(function (m, i) {
    if (m.who === 'me') return '<div class="ai-m me">' + (m.reply ? '<small>↳ in reply to: ' + esc(m.reply) + '</small><br>' : '') + esc(m.text) + '</div>';
    var h = '<div class="ai-m ai' + (m.q ? ' q' : '') + '">' + (m.q ? '<b>❓ </b>' : '') + esc(m.text);
    if (m.notes && m.notes.length) h += '<div class="ai-warn" style="margin:6px 0 0">' + m.notes.map(esc).join('<br>') + '</div>';
    if (m.q) h += '<div style="margin-top:6px">' + (m.answered ? '<small style="color:#127a4b">answered</small> ' : '') + '<button class="btn sm" data-rep="' + i + '">🎙 Reply</button> <button class="btn sm" data-rept="' + i + '">⌨ Type a reply</button></div>';
    if (m.pick && i === lastPick()) h += '<div id="ai-pickhost"></div>';
    return h + '</div>';
  }).join('');
  $$('[data-rep]', host).forEach(function (b) { b.onclick = function () { UI.replyTo = +b.dataset.rep; paintReplying(); if (!(MREC && MREC.state === 'recording')) micToggle(); }; });
  $$('[data-rept]', host).forEach(function (b) { b.onclick = function () { UI.replyTo = +b.dataset.rept; paintReplying(); $('#ai-txt', UI.el).focus(); }; });
  if ($('#ai-pickhost', host)) paintPick(false);
  host.scrollTop = host.scrollHeight;
}
function lastPick() { for (var i = SS.log.length - 1; i >= 0; i--) if (SS.log[i].pick) return SS.log[i].done ? -1 : i; return -1; }
function paintReplying() {
  if (!UI) return;
  var r = $('#ai-replying', UI.el), m = UI.replyTo != null ? SS.log[UI.replyTo] : null;
  r.hidden = !m;
  if (m) { r.innerHTML = '↳ Replying to: <i>' + esc(m.text.slice(0, 140)) + '</i> <button class="btn sm" id="ai-repx">cancel</button>'; $('#ai-repx', r).onclick = function () { UI.replyTo = null; paintReplying(); }; }
}
/* tick the cases: every candidate for every case mentioned, plus a search to add any other */
function paintPick(scroll) {
  if (!UI) return;
  var host = $('#ai-pickhost', UI.el); if (!host) { paintLog(); host = $('#ai-pickhost', UI.el); if (!host) return; }
  var groups = SS.pend || [];
  var shown = {};
  host.innerHTML = '<div class="ai-pick">' + groups.map(function (g, gi) {
    var q = g.q, lab = [q.type, q.number && q.year ? q.number + '/' + q.year : q.number, q.parties].filter(Boolean).join(' ');
    var best = g.hits[0] && (g.hits.length === 1 || g.hits[0].s - (g.hits[1] ? g.hits[1].s : 0) >= 4) ? g.hits[0].id : null;
    return '<div class="ai-pg"><small>You said: <b>' + esc(q.said || lab || '—') + '</b></small>' + (g.hits.length ? g.hits.map(function (h) {
      var c = caseById(h.id); if (!c || shown[h.id]) return ''; shown[h.id] = 1;
      return '<label><input type="checkbox" value="' + esc(c.id) + '"' + (c.id === best ? ' checked' : '') + '> <b>' + esc(c.cn || '') + '</b> — ' + esc(ctit(c)) + ' <small>' + esc(c.court || '') + '</small></label>';
    }).join('') : '<div style="color:#a15c00;font-size:13px">No case in the Case Manager matches — search below.</div>') + '</div>';
  }).join('') +
    '<input id="ai-psearch" placeholder="Search any case by number, party or client" style="margin-top:6px"><div id="ai-pres"></div>' +
    '<div class="ai-row" style="justify-content:flex-start"><button class="btn primary" id="ai-pok">These are the cases</button><button class="btn" id="ai-pno">Cancel</button></div></div>';
  $('#ai-psearch', host).addEventListener('keydown', function (e) { e.stopPropagation(); });
  $('#ai-psearch', host).oninput = function () {
    var v = this.value.trim().toLowerCase();
    var l = v.length < 2 ? [] : cases().filter(function (c) { return SS.cases.indexOf(c.id) < 0 && !shown[c.id] && ((c.cn || '') + ' ' + ctit(c) + ' ' + (c.cl || '')).toLowerCase().indexOf(v) >= 0; }).slice(0, 8);
    $('#ai-pres', host).innerHTML = l.map(function (c) { return '<label><input type="checkbox" value="' + esc(c.id) + '"> <b>' + esc(c.cn || '') + '</b> — ' + esc(ctit(c)) + ' <small>' + esc(c.court || '') + '</small></label>'; }).join('');
  };
  $('#ai-pno', host).onclick = function () { SS.pend = null; var m = SS.log[lastPick()]; if (m) m.done = true; ssSave(); paintLog(); };
  $('#ai-pok', host).onclick = function () {
    var ids = $$('input[type=checkbox]:checked', host).map(function (x) { return x.value; });
    if (!ids.length) { toast('Tick at least one case'); return; }
    ids.forEach(function (id) { if (SS.cases.indexOf(id) < 0) SS.cases.push(id); });
    SS.pend = null; var m = SS.log[lastPick()]; if (m) m.done = true;
    say('me', 'Cases: ' + ids.map(function (id) { var c = caseById(id); return c ? c.cn + ' ' + ctit(c) : id; }).join('; '));
    ssSave(); paintCases();
    if (SS.said.length) plan(); else say('ai', 'Now say what is to be charged — the sittings (effective / non-effective, or let me read the orders), other heads and expenses, and whether the bills are separate or common.');
  };
  if (scroll) { var lg = $('#ai-log', UI.el); lg.scrollTop = lg.scrollHeight; }
}
function paintBills() {
  if (!UI) return;
  var host = $('#ai-bills', UI.el), invs = SS.plan ? SS.plan.invoices || [] : [];
  if (!invs.length) { host.innerHTML = ''; return; }
  host.innerHTML = '<div class="ai-bh">Draft bills</div>' + invs.map(function (v, i) {
    var d = v.savedAs ? null : draftOf(v, unsavedIndex(i)), tot = d ? A.totalOf(d) : 0;
    return '<div class="ai-bill' + (UI.open === i ? ' open' : '') + (v.savedAs ? ' saved' : '') + '"><div class="ai-bt"><b>' + (i + 1) + '. ' + esc(billLabel(v)) + '</b>' +
      (v.savedAs ? ' <span class="ai-tag ok">saved as ' + esc(v.savedAs) + '</span>' : (UI.open === i ? ' <span class="ai-tag">in the form</span>' : '')) + '</div>' +
      '<small>' + esc(String(v.billTo || '— Bill To not known —').split('\n')[0]) + '</small>' +
      '<ul>' + v.items.map(function (o) {
        var c = o._c && v.cases.length > 1 ? caseById(o._c) : null;
        return '<li>' + (c ? '<small>' + esc(c.cn) + '</small> ' : '') + esc(o.name) + ' — ₹' + A.money(o.rate) + (o.qty > 1 ? ' × ' + o.qty : '') +
          (o._b === 'order' || o._b === 'record' ? ' <span class="ai-tag" title="' + esc(o._w || '') + '">' + (o._b === 'order' ? 'from the order' : 'from the record') + '</span>' : '') +
          (o.note ? '<br><small>' + esc(o.note) + '</small>' : '') + (o._w && o._b !== 'said' ? '<br><small style="color:#666">why: ' + esc(o._w) + '</small>' : '') + '</li>';
      }).join('') + '</ul>' +
      (d ? '<div class="ai-bf"><b>Total ₹' + A.money(tot) + '</b> <small>(with clerkage)</small><span style="flex:1"></span><button class="btn sm" data-pv="' + i + '">👁 View</button><button class="btn sm primary" data-op="' + i + '">Open in the form</button></div>'
         : '<div class="ai-bf"><span style="flex:1"></span><button class="btn sm" data-pv="' + i + '">👁 View</button></div>') + '</div>';
  }).join('');
  $$('[data-pv]', host).forEach(function (b) { b.onclick = function () { preview(+b.dataset.pv); }; });
  $$('[data-op]', host).forEach(function (b) { b.onclick = function () { openInForm(+b.dataset.op); }; });
}
/* the orders of one case, inside the drawer */
async function showPdf(id) {
  if (!UI) return;
  var c = caseById(id), v = $('#ai-pdfv', UI.el), pane = $('#ai-pane', UI.el);
  pane.hidden = true; v.hidden = false;
  v.innerHTML = '<div class="ai-pvh"><button class="btn sm" id="ai-pdfback">← Back</button> <b>' + esc(c ? c.cn : '') + '</b></div><div id="ai-pdfb" style="flex:1;min-height:0;display:flex;padding:10px"></div>';
  $('#ai-pdfback', v).onclick = function () { v.hidden = true; v.innerHTML = ''; pane.hidden = false; if (UI.url) { URL.revokeObjectURL(UI.url); UI.url = null; } };
  busy($('#ai-pdfb', v), 'Putting the orders together…');
  var p = PDFS[id] !== undefined ? PDFS[id] : (PDFS[id] = c ? await ordersPdf(c) : null);
  if (!UI || v.hidden) return;
  if (!p) { $('#ai-pdfb', v).innerHTML = '<div class="ai-warn">No orders of this case have been downloaded yet (or the Case Manager is not open). Fetch them in the Case Manager → Orders &amp; order sheets.</div>'; return; }
  UI.url = URL.createObjectURL(p.blob);
  $('#ai-pdfb', v).style.padding = '0';
  $('#ai-pdfb', v).innerHTML = '<iframe class="ai-pdf" src="' + UI.url + '#view=FitH"></iframe>';
}

function casesWin() {
  try {
    var f = window.parent && window.parent !== window ? window.parent.document.getElementById('fCases') : null;
    return f && f.contentWindow ? { f: f, w: f.contentWindow } : null;
  } catch (e) { return null; }
}
function billText(v) {
  return v.number + ' dated ' + dmy(v.date) + ' — ' + (v.reference || '') + '\n' + (v.items || []).map(function (it) {
    return '  • ' + it.name + ' — ₹' + it.rate + ' × ' + it.qty + (it.note ? '\n    note: ' + String(it.note).replace(/\n/g, ' ') : '');
  }).join('\n');
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

/* ================================================================ 📥 FROM CLAUDE (the Claude app's inbox in Drive)
   When you ask Claude in the Claude app for a bill or a letter, it leaves the draft in the
   "Claude Inbox" folder of your Drive. It is fetched here through the eCourts backend (the same
   address and password as Settings → Official eCourts) and opens as a draft for you to check. */
function ecoCfg() { try { var s = JSON.parse(localStorage.getItem('cpm_s') || '{}') || {}; return s.eco || {}; } catch (e) { return {}; } }
async function inboxPost(body) {
  var c = ecoCfg();
  if (!c.url || !c.tok) throw new Error('nocfg');
  body.token = c.tok;
  var r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  var j = JSON.parse(await r.text());
  if (!j.ok) throw new Error(j.error || 'error');
  return j;
}
var INBOX = { items: [], at: 0, off: false };
async function inboxCheck(force) {
  if (INBOX.off || (!force && Date.now() - INBOX.at < 60000) || !navigator.onLine) return;
  INBOX.at = Date.now();
  try { INBOX.items = (await inboxPost({ action: 'inbox', kind: 'billing' })).items || []; }
  catch (e) { if (/unknown action|nocfg/i.test(e.message)) INBOX.off = /unknown action/i.test(e.message); INBOX.items = []; }
  paintInbox();
}
function paintInbox() {
  var b = $('#ai-inbox'); if (!b) return;
  var n = INBOX.items.length;
  b.hidden = !n; b.textContent = '📥 From Claude (' + n + ')';
}
function openInbox() {
  var o = overlay('From the Claude app', '<div id="ai-ibl"></div>');
  function paint() {
    var l = INBOX.items;
    $('#ai-ibl', o.box).innerHTML = l.length ? '<ul class="ai-hits">' + l.map(function (x, i) {
      return '<li style="cursor:default"><b>' + esc(x.title || (x.kind === 'letter' ? 'Letter' : 'Bill')) + '</b><br><small>' + (x.kind === 'letter' ? 'Letter' : 'Bill') + ' · ' + esc(String(x.created || '').slice(0, 10)) + '</small>' +
        (x.message ? '<div class="ai-said">' + esc(x.message) + '</div>' : '') +
        '<div class="ai-row" style="justify-content:flex-start;margin-top:6px"><button class="btn sm primary" data-o="' + i + '">Open as a draft</button><button class="btn sm" data-d="' + i + '">Discard</button></div></li>';
    }).join('') + '</ul>' : '<p style="color:#666">Nothing waiting.</p>';
  }
  $('#ai-ibl', o.box).onclick = async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var x = INBOX.items[+(b.dataset.o || b.dataset.d)]; if (!x) return;
    if (b.dataset.d != null) { if (!confirm('Discard “' + (x.title || 'this draft') + '”? It is moved to Claude Inbox › Done in your Drive.')) return; }
    else { o.close(); if (!openInboxItem(x)) return; }
    try { await inboxPost({ action: 'inboxdone', fid: x.fid }); } catch (err) { toast('Could not mark it as used: ' + err.message); }
    INBOX.items = INBOX.items.filter(function (y) { return y !== x; }); paintInbox(); if (!o.closed) paint();
  };
  paint();
}
function openInboxItem(x) {
  if (x.kind === 'letter') {
    var v = x.invoiceNo ? (db().invoices || []).find(function (k) { return k.number === x.invoiceNo; }) : null;
    if (!window.CBL || !window.CBL.openFromText) { toast('Reload Billing once, then open it again'); return false; }
    return window.CBL.openFromText(v ? 'invoice' : (x.letterKind === 'invoice' ? 'invoice' : 'general'), String(x.text || ''), v, 'Letter from the Claude app — check it, then Save letter');
  }
  var dr = x.draft || {};
  if (A.draftHasContent(A.currentDraft()) && !A.editingId() && !confirm('The bill on screen has not been saved. Replace it with the draft from Claude?')) return false;
  var d = A.blankDraft();
  if (dr.client) { var cl = (db().clients || []).find(function (k) { var a = String(k.name || '').toLowerCase(), b = String(dr.client).toLowerCase(); return a && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }); if (cl) { d.clientId = cl.id; d.billTo = cl.address || cl.name; } }
  if (dr.billTo) d.billTo = dr.billTo;
  if (dr.reference) d.reference = dr.reference;
  if (dr.date && /^\d{4}-\d{2}-\d{2}$/.test(dr.date)) { d.date = dr.date; d.due = dr.date; }
  var items = (dr.items || []).map(function (it) { return { name: String(it.name || ''), hsn: '', rate: Number(it.rate) || 0, qty: Number(it.qty) || 1, note: String(it.note || ''), clerkable: it.clerkable !== false }; }).filter(function (it) { return it.name || it.rate; });
  if (items.length) d.items = items;
  A.setDraft(d, null); A.go('build');
  toast('Bill from the Claude app — check it, then Save invoice (' + d.number + ')');
  return true;
}
window.addEventListener('focus', function () { inboxCheck(false); });
setTimeout(function () { inboxCheck(true); }, 4000);
setInterval(function () { inboxCheck(false); }, 180000);

/* ================================================================ 📎 ENCLOSE ORDERS (letters)
   The case the letter is about, on the left: its details, every order with its date, 👁 to read
   it and a tick to enclose it. Ticked orders are added after the letter in the same PDF (Get PDF,
   Share) and listed under Encl. in the letter. */
var EN = null;
function enOrdersApi() { var cw = casesWin(); return cw && cw.f.contentWindow && cw.f.contentWindow.ordListFor ? cw.f.contentWindow : null; }
async function enApi() {
  var cw = casesWin(); if (!cw) return null;
  if (!cw.f.getAttribute('src')) cw.f.setAttribute('src', 'cases.html');
  var t0 = Date.now();
  while (!(cw.f.contentWindow && cw.f.contentWindow.ordListFor) && Date.now() - t0 < 20000) await new Promise(function (r) { setTimeout(r, 400); });
  return enOrdersApi();
}
window.CBenclose = async function (blob, att) {
  var w = await enApi(); if (!w) throw new Error('Open Charpe Suite from its home page so the Case Manager can give the orders.');
  var r = await w.ordEnclose(blob, att.map(function (a) { return { cid: a.cid, key: a.key }; }));
  return { blob: new Blob([await r.blob.arrayBuffer()], { type: 'application/pdf' }), miss: r.miss || [] };
};
function enGuess(l) {
  var txt = '';
  if (l && l.invoiceId) { var v = (db().invoices || []).find(function (x) { return x.id === l.invoiceId; }); if (v) txt += ' ' + (v.reference || ''); }
  txt += ' ' + ((l && l.text) || '');
  var hit = cases().filter(function (c) { return refMatches(txt, c); });
  return hit;
}
function enLine(c, o) {
  var kind = /judg/i.test(o.t || '') ? 'judgment' : 'order';
  return 'Copy of the ' + kind + ' dated ' + (o.d ? dmy(o.d) : '—') + ' in ' + (c.cn || ctit(c)) + '.';
}
function enClose() { if (EN) { if (EN.url) URL.revokeObjectURL(EN.url); EN.el.remove(); EN = null; } }
async function enclosePanel() {
  css();
  if (EN) { EN.el.hidden = false; return; }
  var l = window.CBL && window.CBL.current && window.CBL.current();
  if (!l) { toast('Open or start a letter first'); return; }
  var el = document.createElement('div'); el.className = 'ai-drawer ai-conv';
  el.innerHTML = '<div class="ai-dh"><b>📎 Enclose orders</b><button class="btn sm" id="en-x">Hide</button></div>' +
    '<div class="ai-cases"><input id="en-q" placeholder="Which case? Type its number or a party" style="width:100%;box-sizing:border-box;font:inherit;padding:7px 9px;border:1px solid #c9d0da;border-radius:7px"><div id="en-res"></div></div>' +
    '<div class="ai-pane" id="en-pane" style="padding:10px 12px"></div>' +
    '<div class="ai-pdfv" id="en-view" hidden></div>' +
    '<div class="ai-foot" id="en-foot"></div>';
  document.body.appendChild(el);
  EN = { el: el, c: null, url: null };
  $('#en-x', el).onclick = function () { el.hidden = true; };
  var q = $('#en-q', el);
  q.addEventListener('keydown', function (e) { e.stopPropagation(); });
  q.oninput = function () {
    var v = q.value.trim().toLowerCase();
    var list = v.length < 2 ? [] : cases().filter(function (c) { return ((c.cn || '') + ' ' + ctit(c) + ' ' + (c.cl || '')).toLowerCase().indexOf(v) >= 0; }).slice(0, 8);
    $('#en-res', el).innerHTML = '<ul class="ai-hits">' + list.map(function (c, i) { return '<li data-i="' + i + '"><b>' + esc(c.cn || '') + '</b> — ' + esc(ctit(c)) + '<br><small>' + esc(c.court || '') + '</small></li>'; }).join('') + '</ul>';
    $$('#en-res li', el).forEach(function (li) { li.onclick = function () { $('#en-res', el).innerHTML = ''; q.value = ''; enShow(list[+li.dataset.i]); }; });
  };
  var g = enGuess(l);
  var att = l.att || [];
  var first = att.length ? cases().find(function (c) { return c.id === att[0].cid; }) : g[0];
  if (first) enShow(first);
  else $('#en-pane', el).innerHTML = '<p style="color:#555">Type the case number or a party name above to see its orders.</p>';
  if (g.length > 1 && !att.length) $('#en-res', el).innerHTML = '<small>Other cases named in this letter:</small><ul class="ai-hits">' + g.slice(1, 6).map(function (c, i) { return '<li data-g="' + (i + 1) + '"><b>' + esc(c.cn || '') + '</b> — ' + esc(ctit(c)) + '</li>'; }).join('') + '</ul>';
  $$('#en-res li[data-g]', el).forEach(function (li) { li.onclick = function () { enShow(g[+li.dataset.g]); }; });
  enFoot();
}
async function enShow(c) {
  if (!EN) return;
  EN.c = c;
  var pane = $('#en-pane', EN.el);
  var nd = c.nd || c.next || '', st = c.stage || c.st || '';
  pane.innerHTML = '<div class="ai-bill" style="margin:0 0 10px"><b>' + esc(c.cn || '') + '</b><br>' + esc(ctit(c)) + '<br><small>' + esc(c.court || '') +
    (c.cl ? '<br>Client: ' + esc(c.cl) : '') + (st ? '<br>Stage: ' + esc(st) : '') + (nd ? '<br>Next date: ' + esc(/^\d{4}-/.test(nd) ? dmy(nd) : nd) : '') + '</small></div>' +
    '<div class="ai-bh">Orders</div><div id="en-list"></div>';
  busy($('#en-list', pane), 'Getting the orders…');
  var w = await enApi();
  if (!EN || EN.c !== c) return;
  if (!w) { $('#en-list', pane).innerHTML = '<div class="ai-warn">Open Charpe Suite from its home page (not the billing page alone) to see the orders.</div>'; return; }
  var list = w.ordListFor(c.id) || [];
  if (!list.length) { $('#en-list', pane).innerHTML = '<div class="ai-warn">No orders of this case are on record yet. Fetch them in the Case Manager → Orders &amp; order sheets.</div>'; return; }
  var l = window.CBL.current(), att = (l && l.att) || [];
  $('#en-list', pane).innerHTML = list.slice().reverse().map(function (o) {
    var on = att.some(function (a) { return a.cid === c.id && a.key === o.key; });
    return '<div class="ai-case" style="align-items:center"><div><b>' + (o.d ? dmy(o.d) : '—') + '</b> ' + esc(o.t || 'Order') + (o.ok ? '' : ' <small style="color:#a15c00">— not downloaded yet</small>') + '</div>' +
      '<div class="ai-cbtn"><button class="btn sm" data-v="' + esc(o.key) + '"' + (o.ok ? '' : ' disabled') + '>👁 View</button>' +
      '<label style="display:flex;gap:4px;align-items:center;font-size:13px;white-space:nowrap"><input type="checkbox" data-a="' + esc(o.key) + '"' + (on ? ' checked' : '') + (o.ok ? '' : ' disabled') + ' style="width:auto"> Attach</label></div></div>';
  }).join('');
  $$('[data-v]', pane).forEach(function (b) { b.onclick = function () { enView(c, list.find(function (o) { return o.key === b.dataset.v; })); }; });
  $$('[data-a]', pane).forEach(function (x) { x.onchange = function () { enToggle(c, list.find(function (o) { return o.key === x.dataset.a; }), x.checked); }; });
}
function enToggle(c, o, on) {
  var l = window.CBL.current(); if (!l || !o) return;
  var att = (l.att || []).slice(), encl = (l.encl || []).slice();
  var i = att.findIndex(function (a) { return a.cid === c.id && a.key === o.key; });
  if (on && i < 0) { var line = enLine(c, o); att.push({ cid: c.id, key: o.key, d: o.d, t: o.t, cn: c.cn, line: line }); encl.push(line); }
  if (!on && i >= 0) { var ln = att[i].line; att.splice(i, 1); var j = encl.indexOf(ln); if (j >= 0) encl.splice(j, 1); }
  /* enclosed orders in date order, case by case, after any other enclosure */
  var ours = att.map(function (a) { return a.line; });
  att.sort(function (a, b) { return (a.cn || '').localeCompare(b.cn || '') || String(a.d).localeCompare(String(b.d)); });
  encl = encl.filter(function (t) { return ours.indexOf(t) < 0; }).concat(att.map(function (a) { return a.line; }));
  window.CBL.setEnclosures(encl, att);
  enFoot();
}
function enFoot() {
  if (!EN) return;
  var l = window.CBL.current(), n = (l && l.att || []).length;
  $('#en-foot', EN.el).innerHTML = n ? '<b>' + n + ' order' + (n === 1 ? '' : 's') + ' enclosed</b> — listed under Encl. in the letter and added after it in <b>Get PDF</b> and <b>Share</b>.' : '<span style="color:#555">Tick Attach on the orders to enclose them with this letter.</span>';
}
async function enView(c, o) {
  if (!EN || !o) return;
  var v = $('#en-view', EN.el), pane = $('#en-pane', EN.el);
  pane.hidden = true; v.hidden = false;
  v.innerHTML = '<div class="ai-pvh"><button class="btn sm" id="en-back">← Back</button> <b>' + esc((c.cn || '') + ' — ' + (o.d ? dmy(o.d) : '') + ' ' + (o.t || '')) + '</b></div><div id="en-vb" style="flex:1;min-height:0;display:flex;padding:10px"></div>';
  $('#en-back', v).onclick = function () { v.hidden = true; v.innerHTML = ''; pane.hidden = false; if (EN.url) { URL.revokeObjectURL(EN.url); EN.url = null; } };
  busy($('#en-vb', v), 'Opening the order…');
  try {
    var w = await enApi(); var b = await w.ordBlobFor(c.id, o.key);
    if (!EN || v.hidden) return;
    EN.url = URL.createObjectURL(b);
    $('#en-vb', v).style.padding = '0';
    $('#en-vb', v).innerHTML = '<iframe class="ai-pdf" src="' + EN.url + '#view=FitH"></iframe>';
  } catch (e) { $('#en-vb', v).innerHTML = '<div class="ai-warn">' + esc(e.message || e) + '</div>'; }
}
if (window.CBL && window.CBL.hooks) window.CBL.hooks.push(function () { if (EN) { var l = window.CBL.current(); var g = l && (l.att && l.att.length ? cases().find(function (c) { return c.id === l.att[0].cid; }) : enGuess(l)[0]); if (g) enShow(g); enFoot(); } });

/* ================================================================ wiring: the buttons on the bill and letter pages */
function addBar() {
  css();
  var row = $('#m5-startrow');
  if (row && !$('#ai-bar')) {
    var bar = document.createElement('div'); bar.id = 'ai-bar'; bar.className = 'ai-bar';
    bar.innerHTML = '<button class="btn sm ai-go" id="ai-inv" title="Say the case, then what happened on each date">🎙 Auto invoice</button>' +
      '<button class="btn sm ai-go" id="ai-let" title="General letter or a letter with a bill, by voice">🎙 Auto letter</button>' +
      '<button class="btn sm" id="ai-ins" title="Standing instructions followed every time">📋 Instructions</button>' +
      '<button class="btn sm" id="ai-set" title="Gemini / Claude keys and defaults">⚙ AI</button>' +
      '<button class="btn sm primary" id="ai-inbox" hidden title="Bills and letters Claude prepared for you in the Claude app">📥 From Claude</button>';
    row.parentNode.insertBefore(bar, row);
    $('#ai-inv').onclick = startInvoice; $('#ai-let').onclick = startLetter;
    $('#ai-ins').onclick = openInstructions; $('#ai-set').onclick = openSettings;
    $('#ai-inbox').onclick = openInbox; paintInbox();
  }
  var lv = $('#m5-new-inv');
  if (lv && !$('#ai-let2')) {
    var b = document.createElement('button'); b.className = 'btn sm ai-go'; b.id = 'ai-let2'; b.type = 'button'; b.textContent = '🎙 Auto letter';
    b.style.cssText = 'background:#1b2a41;color:#fff;border-color:#1b2a41;margin-left:6px';
    b.onclick = startLetter; lv.parentNode.insertBefore(b, lv.nextSibling);
  }
  if (lv && !$('#en-btn')) {
    var e2 = document.createElement('button'); e2.className = 'btn sm'; e2.id = 'en-btn'; e2.type = 'button'; e2.textContent = '📎 Enclose orders';
    e2.title = 'See the orders of the case this letter is about, and enclose any of them with the letter';
    e2.style.marginLeft = '6px'; e2.onclick = enclosePanel;
    var anchorBtn = $('#ai-let2') || lv; anchorBtn.parentNode.insertBefore(e2, anchorBtn.nextSibling);
  }
}
/* calmer layout (Nov 2026): related buttons open as one menu — every button still does what it did */
function groupUi() {
  if (!window.DD) return;
  if (!document.getElementById('ddSetup')) {
    var t = function (v) { return document.querySelector('nav.tabs > .tab[data-view="' + v + '"]'); };
    if (t('clients')) DD.group({ id: 'ddSetup', label: 'Setup', cls: 'tab', title: 'Clients, Rate card, Backups, Settings', right: true, items: [t('clients'), t('catalog'), t('backups'), t('settings')] });
  }
  if ($('#ai-bar') && !document.getElementById('ddAi')) {
    DD.group({ id: 'ddAi', label: '⋯ More', cls: 'btn sm', title: 'Auto letter, standing instructions, AI settings', items: [$('#ai-let'), $('#ai-ins'), $('#ai-set')] });
    $('#ai-set').textContent = '⚙ AI settings (Gemini / Claude)';
    $('#ai-ins').textContent = '📋 Standing instructions';
  }
  if ($('#m5-new-inv') && !document.getElementById('ddNewLet')) {
    var n = DD.group({ id: 'ddNewLet', label: '＋ New letter', cls: 'btn primary', title: 'Letter for an invoice, general letter, or by voice', items: [$('#m5-new-inv'), $('#m5-new-gen'), $('#ai-let2')] });
    var en = $('#en-btn'); if (n && en) { en.style.marginLeft = '0'; n.parentNode.insertBefore(en, n.nextSibling); }
    if ($('#ai-let2')) $('#ai-let2').textContent = '🎙 Auto letter (speak it)';
  }
  if ($('#m5-pdf') && !document.getElementById('ddGetLet')) {
    DD.group({ id: 'ddGetLet', label: '⬇ Get / Share', cls: 'btn', title: 'PDF, Word or share', items: [$('#m5-pdf'), $('#m5-word'), $('#m5-share')] });
  }
}
(function () {
  var c = document.createElement('style');
  c.textContent = '.tabs .dd>summary.tab{display:inline-flex}.tabs .dd:has(.ddm .tab.on)>summary{background:var(--accent);color:#fff}' +
    '.tabs .ddm>.tab.on{background:var(--accent)!important;color:#fff!important}' +
    '#ai-bar .dd>summary,.m5-side .dd>summary{display:inline-flex}.m5-side .btnbar{align-items:center}' +
    '.btn,.tab{transition:background .15s,border-color .15s,box-shadow .15s,color .15s}';
  document.head.appendChild(c);
})();
if (A.hooks) A.hooks.push(function () { addBar(); groupUi(); });
addBar(); groupUi();
window.CBAI = { inboxCheck: inboxCheck, openInboxItem: openInboxItem, startInvoice: startInvoice, startLetter: startLetter, openInstructions: openInstructions, openSettings: openSettings, closeDrawer: closeDrawer, _findCases: findCases, _cnKey: cnKey, _refMatches: refMatches };
})();
