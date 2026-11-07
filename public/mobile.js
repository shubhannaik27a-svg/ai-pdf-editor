/* mobile.js - phone/tablet layer for AI PDF Editor.
   Does nothing on screens wider than 820px. Adds: bottom bar, slide-down menu,
   chat drawer, fit-to-width zoom, sharper pages, and a touch->mouse bridge so the
   editing tools (select area, move/resize boxes, cover box) work with a finger. */
(function () {
  'use strict';
  if (window.__mobileLoaded) return;
  window.__mobileLoaded = true;

  var $ = function (s) { return document.querySelector(s); };
  var mq = window.matchMedia('(max-width: 820px)');

  /* ---------- css + viewport ---------- */
  var link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = 'mobile.css';
  document.head.appendChild(link);
  var vp = document.querySelector('meta[name=viewport]');
  var want = 'width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content';
  if (vp) vp.setAttribute('content', want);
  else { vp = document.createElement('meta'); vp.name = 'viewport'; vp.content = want; document.head.appendChild(vp); }

  /* sharper pages on high-DPI phones (used by the render patch in index.html) */
  window.__pdfQuality = function (v) {
    if (!mq.matches) return 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var cap = Math.sqrt(3.2e6 / Math.max(v.width * v.height, 1)); // keep each page canvas under ~3.2M pixels
    return Math.round(Math.max(1, Math.min(dpr, cap)) * 100) / 100;
  };

  /* ---------- build the mobile UI ---------- */
  var mode = 'scroll', autoMode = false, toastTimer;

  function el(tag, id, html) { var e = document.createElement(tag); if (id) e.id = id; if (html) e.innerHTML = html; return e; }

  function build() {
    var chatEl = $('#chat');
    if (chatEl) {
      var placeChat = function () { var main = $('#main'); if (mq.matches) document.body.appendChild(chatEl); else if (main && chatEl.parentNode !== main) main.appendChild(chatEl); };
      placeChat();
      if (mq.addEventListener) mq.addEventListener('change', placeChat);
    }
    var findBar = $('#findBar');
    if (findBar) document.body.appendChild(findBar); // it lived inside the toolbar, which is now a hidden menu

    var top = el('div', 'mTop',
      '<span class="mBrand">\u2728 AI PDF Editor</span><span class="mPage" id="mPage"></span>' +
      '<button id="mMenu" aria-label="Menu">\u2630</button>');
    var bar = el('div', 'mBar',
      '<button id="mOpen"><b>\uD83D\uDCC2</b>Open</button>' +
      '<button id="mUndo"><b>\u21B6</b>Undo</button>' +
      '<button id="mRedo"><b>\u21B7</b>Redo</button>' +
      '<button id="mMode"><b>\u270B</b><span>Scroll</span></button>' +
      '<button id="mChat"><b>\uD83D\uDCAC</b>AI<i class="dot"></i></button>' +
      '<button id="mSave"><b>\u2B07\uFE0F</b>Save</button>');
    var toast = el('div', 'mToast');
    document.body.append(top, bar, toast);

    var bz = $('#bZo');
    if (bz) {
      var fit = el('button', 'mFit', 'Fit page width');
      var th = el('button', 'mThumbs', 'Page thumbnails');
      bz.after(fit, th);
      fit.onclick = fitNow;
      th.onclick = function () { document.body.classList.toggle('m-thumbs'); };
    }

    var chatHead = $('#chatHead');
    if (chatHead) {
      var x = el('button', 'mChatX', '\u2715');
      chatHead.append(x);
      x.onclick = function (e) { e.stopPropagation(); closeChat(); };
    }

    function fwd(btn, target) { $(btn).onclick = function () { var t = $(target); if (t) t.click(); }; }
    fwd('#mOpen', '#bOpen'); fwd('#mUndo', '#bUndo'); fwd('#mRedo', '#bRedo'); fwd('#mSave', '#bDl');
    $('#mMenu').onclick = function () { document.body.classList.toggle('m-menu'); document.body.classList.remove('m-chat'); };
    $('#mChat').onclick = function () { document.body.classList.contains('m-chat') ? closeChat() : openChat(false); };
    $('#mMode').onclick = function () {
      setMode(mode === 'edit' ? 'scroll' : 'edit', false);
      toast_(mode === 'edit'
        ? 'Select mode: drag on the page to select an area or move things. Tap again to scroll.'
        : 'Scroll mode: drag to scroll, tap text to select it.');
    };

    // menu closes after most buttons; zoom and nudge buttons keep it open
    $('#bar').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b && !b.matches('#bZi,#bZo,#nL,#nU,#nD,#nR')) closeMenu();
    });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('m-menu') && !e.target.closest('#bar,#mTop')) closeMenu();
    }, true);
    if (chatHead) chatHead.addEventListener('click', function (e) { if (e.target === chatHead || e.target.closest('small,i')) closeChat(); });
  }

  // keep the full-screen chat above the on-screen keyboard (iOS does not resize the page for it)
  window.__fitChat = function () {
    var c = $('#chat'), vv = window.visualViewport; if (!c || !vv || !mq.matches) return;
    if (document.body.classList.contains('m-chat')) { c.style.top = vv.offsetTop + 'px'; c.style.height = vv.height + 'px'; c.style.bottom = 'auto'; }
    else { c.style.top = ''; c.style.height = ''; c.style.bottom = ''; }
  };
  if (window.visualViewport) { visualViewport.addEventListener('resize', function () { window.__fitChat(); }); visualViewport.addEventListener('scroll', function () { window.__fitChat(); }); }
  function closeMenu() { document.body.classList.remove('m-menu'); }
  function openChat(focus) {
    document.body.classList.add('m-chat'); closeMenu(); window.__fitChat();
    var d = document.querySelector('#mChat .dot'); if (d) d.classList.remove('show');
    var lg = $('#log'); if (lg) lg.scrollTop = 1e9;
    if (focus) requestAnimationFrame(function () { var m = $('#msg'); if (m) m.focus(); });
  }
  function closeChat() { document.body.classList.remove('m-chat'); window.__fitChat(); }

  function setMode(m, isAuto) {
    mode = m; autoMode = !!isAuto;
    document.body.classList.toggle('m-edit', m === 'edit');
    var b = $('#mMode');
    if (b) {
      b.classList.toggle('on', m === 'edit');
      b.querySelector('b').textContent = m === 'edit' ? '\u270F\uFE0F' : '\u270B';
      b.querySelector('span').textContent = m === 'edit' ? 'Select' : 'Scroll';
    }
  }

  function toast_(msg, err) {
    var t = $('#mToast'); if (!t) return;
    t.textContent = msg.length > 160 ? msg.slice(0, 157) + '\u2026' : msg;
    t.classList.toggle('err', !!err);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, err ? 6000 : 4200);
  }

  /* ---------- fit to width + page tracking ---------- */
  function fitValue() {
    if (typeof pages === 'undefined' || !pages.length) return null;
    var box = $('#pages'); if (!box) return null;
    var w = box.clientWidth - 14, maxW = 0;
    for (var i = 0; i < pages.length; i++) maxW = Math.max(maxW, pages[i].w);
    if (!(maxW > 0) || w <= 0) return null;
    return Math.max(0.3, Math.min(5, Math.floor(w / maxW * 100) / 100));
  }
  async function fitNow() {
    var f = fitValue();
    if (f == null || typeof render !== 'function') return;
    zoom = f;
    await render();
  }

  var ticking = false;
  function updateActive() {
    ticking = false;
    var box = $('#pages'), ind = $('#mPage'); if (!box) return;
    var pgs = Array.prototype.slice.call(box.querySelectorAll('.pg'));
    if (!pgs.length) { if (ind) ind.textContent = ''; return; }
    var cr = box.getBoundingClientRect(), mid = cr.top + cr.height * 0.4, best = 0, bd = 1e9;
    pgs.forEach(function (p, i) {
      var r = p.getBoundingClientRect();
      var d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < bd) { bd = d; best = i; }
    });
    if (ind) ind.textContent = 'Page ' + (best + 1) + ' / ' + pgs.length;
    // the app tracks the "current page" on hover, which phones do not have
    if (mq.matches && typeof active !== 'undefined' && active !== best) pgs[best].dispatchEvent(new MouseEvent('mouseenter'));
  }

  // first render of a PDF on a phone: fit the page to the screen width instead of the 130% desktop default
  if (typeof window.render === 'function') {
    var origRender = window.render;
    window.render = async function () {
      if (mq.matches && typeof zoom !== 'undefined' && zoom === 1.3) { var f = fitValue(); if (f != null) zoom = f; }
      var r = await origRender.apply(this, arguments);
      updateActive();
      return r;
    };
  }

  /* ---------- touch -> mouse bridge ---------- */
  var SKIP = 'textarea,input,select,button,label,a,#mTop,#mBar,#bar,#chat,#boxBar,#findBar,#dlg,#dlg2,#docDlg,#coverDlg,#thumbs';
  var br = null, lastTap = { t: 0, x: 0, y: 0 }, cand = null;

  function fire(type, target, t, extra) {
    try {
      target.dispatchEvent(new MouseEvent(type, Object.assign({
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: t.clientX, clientY: t.clientY, screenX: t.screenX || 0, screenY: t.screenY || 0,
        button: 0, buttons: 0, detail: (type === 'click' || type === 'mousedown') ? 1 : 0
      }, extra || {})));
    } catch (_) { }
  }
  function under(x, y, fallback) {
    return (document.elementFromPoint && document.elementFromPoint(x, y)) || fallback || document.body;
  }
  function tapped(x, y, target) {
    var now = Date.now();
    if (now - lastTap.t < 350 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap.t = 0;
      var u = under(x, y, target), it = u.closest && u.closest('.it');
      if (it) it.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, detail: 2 }));
    } else lastTap = { t: now, x: x, y: y };
  }

  document.addEventListener('touchstart', function (e) {
    if (!mq.matches) return;
    var tg = e.target;
    if (!(tg instanceof Element)) return;
    if (e.touches.length > 1) { // a second finger (pinch): finish the drag cleanly and let the browser handle the gesture
      if (br) { fire('mouseup', under(br.lx, br.ly, br.target), { clientX: br.lx, clientY: br.ly }, { buttons: 0 }); }
      br = null; cand = null; return;
    }
    if (tg.closest(SKIP)) return;
    var t = e.touches[0];
    var inBox = tg.closest('.txtbox,.boxHandle,.imgp'), inPage = tg.closest('.ov,.pg');
    if (inBox || (inPage && mode === 'edit')) {
      e.preventDefault();
      br = { id: t.identifier, sx: t.clientX, sy: t.clientY, lx: t.clientX, ly: t.clientY, moved: false, target: tg };
      fire('mousedown', tg, t, { buttons: 1 });
    } else if (inPage) {
      cand = { id: t.identifier, x: t.clientX, y: t.clientY, t: Date.now(), target: tg };
    }
  }, { passive: false, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!br) return;
    var t = Array.prototype.find.call(e.touches, function (x) { return x.identifier === br.id; });
    if (!t) return;
    e.preventDefault();
    if (Math.hypot(t.clientX - br.sx, t.clientY - br.sy) > 8) br.moved = true;
    br.lx = t.clientX; br.ly = t.clientY;
    fire('mousemove', under(t.clientX, t.clientY, br.target), t, { buttons: 1 });
  }, { passive: false, capture: true });

  function endTouch(e, cancelled) {
    var t;
    if (br) {
      t = Array.prototype.find.call(e.changedTouches, function (x) { return x.identifier === br.id; });
      if (!t) return;
      e.preventDefault();
      var u = under(t.clientX, t.clientY, br.target);
      fire('mouseup', u, t, { buttons: 0 });
      if (!br.moved && !cancelled) { fire('click', u, t, { buttons: 0 }); tapped(t.clientX, t.clientY, br.target); }
      br = null;
    } else if (cand) {
      t = Array.prototype.find.call(e.changedTouches, function (x) { return x.identifier === cand.id; });
      if (!t) return;
      if (!cancelled && Math.hypot(t.clientX - cand.x, t.clientY - cand.y) < 10 && Date.now() - cand.t < 350) {
        e.preventDefault(); // we send the mouse events ourselves, once, so the browser must not
        var tu = under(t.clientX, t.clientY, cand.target);
        fire('mousedown', tu, t, { buttons: 1 }); fire('mouseup', tu, t, { buttons: 0 }); fire('click', tu, t, { buttons: 0 });
        tapped(t.clientX, t.clientY, cand.target);
      }
      cand = null;
    }
  }
  document.addEventListener('touchend', function (e) { endTouch(e, false); }, { passive: false, capture: true });
  document.addEventListener('touchcancel', function (e) { endTouch(e, true); }, { passive: false, capture: true });

  /* ---------- wiring ---------- */
  function apply() {
    document.body.classList.toggle('m', mq.matches);
    if (!mq.matches) document.body.classList.remove('m-menu', 'm-chat', 'm-thumbs', 'm-edit');
    else updateActive();
  }

  function init() {
    build();
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);

    var box = $('#pages');
    if (box) box.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(updateActive); } }, { passive: true });

    // tools that ask for a click/drag on the page (cursor turns to crosshair) switch to select mode by themselves
    new MutationObserver(function () {
      if (!mq.matches) return;
      var c = document.body.style.cursor === 'crosshair';
      if (c && mode !== 'edit') { setMode('edit', true); closeMenu(); }
      else if (!c && autoMode && mode === 'edit') setMode('scroll', false);
    }).observe(document.body, { attributes: true, attributeFilter: ['style'] });

    // messages the app writes to the chat are shown as a toast while the chat is closed
    var log = $('#log');
    if (log) new MutationObserver(function (muts) {
      if (!mq.matches) return;
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (!(n instanceof Element) || !n.classList.contains('m') || n.classList.contains('u')) return;
          if (document.body.classList.contains('m-chat')) return;
          toast_(n.textContent || '', n.classList.contains('e'));
          var d = document.querySelector('#mChat .dot'); if (d) d.classList.add('show');
        });
      });
    }).observe(log, { childList: true });

    // home-screen cards that start a chat open the drawer
    document.addEventListener('click', function (e) {
      if (!mq.matches) return;
      var t = e.target.closest('#home [data-go],#home .tg');
      if (!t) return;
      var go = t.dataset ? t.dataset.go : '';
      if (t.classList.contains('tg') || ['open', 'shot', 'tpl', 'doc'].indexOf(go) < 0) openChat(true);
    });
  }

  function loadNeon() {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'neon.css'; document.head.appendChild(l);
    var j = document.createElement('script'); j.src = 'neon.js'; document.body.appendChild(j);
  }
  function loadVoice() { var v = document.createElement('script'); v.src = 'voice.js'; document.body.appendChild(v); }
  if (document.body) { init(); loadNeon(); loadVoice(); } else document.addEventListener('DOMContentLoaded', function () { init(); loadNeon(); loadVoice(); });
})();
