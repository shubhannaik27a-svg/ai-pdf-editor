/* voice.js - microphone (speech-to-text) for the AI chat box and the home assistant box.
   Uses the browser's built-in speech recognition: Chrome/Edge (desktop + Android) and Safari (iPhone/Mac). Needs HTTPS and mic permission. */
(function () {
  'use strict';
  if (window.__voiceLoaded) return; window.__voiceLoaded = true;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var $ = function (s) { return document.querySelector(s); };
  var LANGS = [['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['hi-IN', '\u0939\u093F\u0928\u094D\u0926\u0940'], ['mr-IN', '\u092E\u0930\u093E\u0920\u0940']];
  var MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';

  function lang() {
    var s = ''; try { s = localStorage.getItem('voiceLang') || ''; } catch (_) { }
    if (s) return s;
    var n = navigator.language || 'en-US';
    return LANGS.some(function (l) { return l[0] === n; }) ? n : 'en-US';
  }

  var css = document.createElement('style');
  css.textContent =
    '#micBtn,#nMic{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid #d9d6f2;background:#fff;color:#4f46e5;display:grid;place-items:center;padding:0;cursor:pointer;align-self:center}' +
    '#micBtn svg,#nMic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '#micBtn.rec,#nMic.rec{background:#ef4444;border-color:#ef4444;color:#fff;animation:micp 1.2s infinite}#micBtn.na,#nMic.na{opacity:.5}' +
    '@keyframes micp{0%{box-shadow:0 0 0 0 #ef444488}70%{box-shadow:0 0 0 14px #ef444400}100%{box-shadow:0 0 0 0 #ef444400}}' +
    '#voiceRow{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:12px;color:#6b7280}#voiceRow.rec #voiceSt{color:#ef4444;font-weight:700}' +
    '#voiceLang{margin-left:auto;font-size:12px;padding:2px 6px;border-radius:8px;max-width:55%}' +
    '#vToast{position:fixed;left:12px;right:12px;bottom:110px;z-index:60;margin:0 auto;max-width:420px;padding:11px 14px;border-radius:12px;background:#1d2136;color:#fff;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s;text-align:center}#vToast.show{opacity:1}' +
    'body.m #micBtn{width:60px;height:60px}body.m #micBtn,body.m #nMic{background:#ffffff14;border-color:#ffffff30;color:#e9d5ff}body.m #micBtn.rec,body.m #nMic.rec{background:#ef4444;color:#fff}' +
    'body.m #voiceRow{padding:2px 16px 6px;font-size:12.5px;color:#c3b9ee}body.m #vToast{z-index:60;bottom:calc(100px + env(safe-area-inset-bottom,0px))}body.m #nMic{width:44px;height:44px}';
  document.head.appendChild(css);

  var toastEl, toastT;
  function toast(m) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'vToast'; document.body.appendChild(toastEl); }
    toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 4500);
  }

  var active = null;
  function Session(el, btn, row) { this.el = el; this.btn = btn; this.row = row; this.on = false; this.dead = false; this.rec = null; this.base = ''; this.quick = 0; this.t0 = 0; this.act = 0; }
  Session.prototype.ui = function (rec) {
    this.btn.classList.toggle('rec', rec); this.btn.setAttribute('aria-pressed', rec ? 'true' : 'false');
    if (this.row) { this.row.classList.toggle('rec', rec); var st = this.row.querySelector('#voiceSt'); if (st) st.textContent = rec ? '\u25CF Listening\u2026 speak now (tap the mic to stop)' : 'Tap the mic and speak'; }
  };
  Session.prototype.write = function (fin, interim) {
    var sep = this.base && !/\s$/.test(this.base) ? ' ' : '', txt = (fin + (fin && interim ? ' ' : '') + interim).trim();
    this.el.value = this.base + (txt ? sep + txt : '');
    this.el.dispatchEvent(new Event('input', { bubbles: true })); this.el.scrollTop = this.el.scrollHeight;
  };
  Session.prototype.launch = function () {
    var self = this, rec = new SR();
    rec.lang = lang(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    this.rec = rec; this.t0 = Date.now();
    rec.onresult = function (e) {
      if (self.rec !== rec || self.dead) return;
      self.act = Date.now();
      var fin = '', interim = '';
      for (var i = 0; i < e.results.length; i++) {
        var r = e.results[i], t = (r[0].transcript || '').trim();
        if (!t) continue;
        if (r.isFinal) { if (fin && t.toLowerCase().indexOf(fin.toLowerCase()) === 0) fin = t; else fin = fin ? fin + ' ' + t : t; } // some Android versions repeat earlier text
        else interim = (fin && t.toLowerCase().indexOf(fin.toLowerCase()) === 0) ? t.slice(fin.length).trim() : t;
      }
      self.write(fin, interim);
    };
    rec.onerror = function (e) {
      if (self.rec !== rec) return;
      var c = e.error;
      if (c === 'no-speech' || c === 'aborted') return;
      self.on = false; self.dead = true; self.ui(false); if (active === self) active = null;
      toast(c === 'not-allowed' || c === 'service-not-allowed' ? 'Microphone is blocked. Allow microphone access for this site in your browser settings, then try again.'
        : c === 'audio-capture' ? 'No microphone found on this device.'
        : c === 'network' ? 'Voice typing needs an internet connection.'
        : c === 'language-not-supported' ? 'This language is not supported for voice typing here.' : 'Voice typing stopped (' + c + ').');
    };
    rec.onend = function () {
      if (self.rec !== rec) return;
      if (!self.on || self.dead) { self.ui(false); if (active === self) active = null; return; }
      // the browser ends a session after silence: keep what was heard and listen again
      self.quick = Date.now() - self.t0 < 700 ? self.quick + 1 : 0;
      if (self.quick >= 3) { self.stop(true); toast('Voice typing could not start. Check microphone permission.'); return; }
      if (Date.now() - self.act > 25000 && self.act) { self.stop(false); toast('Stopped listening (no speech heard).'); return; }
      self.base = self.el.value;
      setTimeout(function () { if (self.on && !self.dead && self.rec === rec) { try { self.launch(); } catch (_) { self.stop(true); } } }, 200);
    };
    rec.start();
  };
  Session.prototype.start = function () {
    if (active && active !== this) active.stop(true);
    this.base = this.el.value; this.on = true; this.dead = false; this.quick = 0; this.act = Date.now(); active = this; this.ui(true);
    try { this.launch(); } catch (_) { this.on = false; this.ui(false); active = null; toast('Could not start the microphone.'); }
  };
  Session.prototype.stop = function (abort) {
    this.on = false; if (abort) this.dead = true;
    try { if (this.rec) { abort ? this.rec.abort() : this.rec.stop(); } } catch (_) { }
    this.ui(false); if (active === this && abort) active = null;
  };
  function stopActive() { if (active) active.stop(true); }

  function attach(el, btn, row) {
    var s = new Session(el, btn, row);
    btn.type = 'button'; btn.title = 'Speak instead of typing'; btn.setAttribute('aria-label', 'Voice typing'); btn.innerHTML = MIC;
    if (!SR) { btn.classList.add('na'); btn.onclick = function () { toast('Voice typing is not supported in this browser. Use Chrome (Android/desktop) or Safari (iPhone).'); }; return s; }
    btn.onclick = function (e) { e.preventDefault(); s.on ? s.stop(false) : s.start(); };
    el.addEventListener('input', function (e) { if (e.isTrusted && s.on) s.stop(true); }); // you started typing yourself
    return s;
  }

  function init() {
    var inEl = $('#in'), msg = $('#msg'), send = $('#bSend');
    if (inEl && msg && send && !$('#micBtn')) {
      var row = document.createElement('div'); row.id = 'voiceRow';
      row.innerHTML = '<span id="voiceSt">Tap the mic and speak</span><select id="voiceLang" aria-label="Voice language">' + LANGS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + '</option>'; }).join('') + '</select>';
      inEl.parentNode.insertBefore(row, inEl);
      var sel = row.querySelector('select'); sel.value = lang();
      sel.onchange = function () { try { localStorage.setItem('voiceLang', sel.value); } catch (_) { } if (active) { var a = active; a.stop(true); setTimeout(function () { a.start(); }, 250); } };
      var mic = document.createElement('button'); mic.id = 'micBtn'; inEl.insertBefore(mic, send);
      if (!SR) row.style.display = 'none';
      attach(msg, mic, row);
      // sending (button or Enter) ends listening so late words never reappear in the cleared box
      send.addEventListener('click', stopActive, true);
      msg.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) stopActive(); }, true);
    }
    // home-screen assistant box (phones)
    var t = setInterval(function () {
      var nIn = $('.nIn'), nMsg = $('#nMsg'), nSend = $('#nSend');
      if (nIn && nMsg && nSend) {
        clearInterval(t);
        if (!$('#nMic')) { var m2 = document.createElement('button'); m2.id = 'nMic'; nIn.insertBefore(m2, nSend); attach(nMsg, m2, null); nSend.addEventListener('click', stopActive, true); }
      }
    }, 400);
    setTimeout(function () { clearInterval(t); }, 15000);
    // stop when the app goes to the background or the chat sheet is closed
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopActive(); });
    new MutationObserver(function () { if (active && active.el.id === 'msg' && document.body.classList.contains('m') && !document.body.classList.contains('m-chat')) stopActive(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
