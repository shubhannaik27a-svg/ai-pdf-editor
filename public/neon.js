/* neon.js - mobile home screen + bottom tool bar in the neon style. Buttons forward to the app's existing buttons. */
(function () {
  'use strict';
  var mq = window.matchMedia('(max-width: 820px)'), $ = function (s) { return document.querySelector(s); };
  var P = {
    undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/>', redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
    find: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.7" y2="16.7"/>', erase: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    crop: '<path d="M6 1v15a2 2 0 0 0 2 2h15"/><path d="M1 6h15a2 2 0 0 1 2 2v15"/>', text: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    page: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>', image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    pen: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', zin: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.7" y2="16.7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
    zout: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.7" y2="16.7"/><line x1="8" y1="11" x2="14" y2="11"/>', dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', cam: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', set: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    star: '<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/>', cur: '<path d="M3 3l7 17 2.5-7.4L20 10z"/>', move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', chev: '<polyline points="9 18 15 12 9 6"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    arr: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', dn: '<polyline points="6 9 12 15 18 9"/>', word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 12l1.5 6 2.5-6 2.5 6L16 12"/>',
    crown: '<path d="M2 7l5 5 5-8 5 8 5-5-2 13H4z"/>', lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', fit: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>', th: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'
  };
  var ic = function (k) { return '<svg class="ic" viewBox="0 0 24 24">' + P[k] + '</svg>'; };
  var hasPdf = function () { return !!document.querySelector('#pages .pg'); };
  var click = function (sel) { var e = $(sel); if (e) e.click(); };
  function toast(m) { var t = $('#mToast'); if (!t) return; t.textContent = m; t.classList.remove('err'); t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function chatOpen() { if (!document.body.classList.contains('m-chat')) click('#mChat'); }
  function ask(mode, text, send) { var m = $('#mode'); if (m) m.value = mode; $('#msg').value = text || ''; if (send) $('#bSend').click(); else $('#msg').focus(); chatOpen(); }
  var NEEDS = '#bFind,#bTxt,#bBox,#bImg,#bSnip,#bPg,#bEr,#bFl,#bDl,#bUndo,#bRedo';
  function go(sel) { closeSheet(); if (sel.split(',').length === 1 && /^(#bFind|#bTxt|#bBox|#bImg|#bSnip|#bPg|#bEr|#bFl|#bDl)$/.test(sel) && !hasPdf()) return toast('Open a PDF first, then use this tool.'); click(sel); }

  /* every feature, used by "See all" and the New menu: [icon, title, text, action] */
  var ALL = [
    ['folder', 'Open PDF', 'Edit, read, merge, and more\u2014without Ads.', '#bOpen'], ['star', 'Create with AI', 'Describe it, structure, or get a report in seconds.', 'ai'],
    ['cam', 'Screenshot \u2192 Report', 'Upload outputs/screenshots, let AI draft them as a full report in your lab format.', '#bShot'], ['file', 'Template + Results', 'Pour your results PDF into the required lab manual format.', '#bTpl'],
    ['word', 'Word \u2192 PDF', 'Convert Word files to PDF format.', '#bDoc'], ['word', 'Doc \u2192 PDF (exact copy)', 'Same size, margins and pictures', '#bDocQ'],
    ['image', 'Photo to PDF', 'Rebuild a page photo as a searchable PDF', '#bCover'], ['page', 'New blank PDF', 'Start from an empty page', '#bNew'],
    ['pen', 'Cover + text', 'Hide old text, type new text', '#bBox'], ['image', 'Add image', 'Place a picture on a page', '#bImg'],
    ['crop', 'Cut / copy image', 'Move pictures between pages', '#bSnip'], ['text', 'Add text', 'Type anywhere on the page', '#bTxt'],
    ['page', 'Add page', 'Insert a new page', '#bPg'], ['erase', 'Erase selection', 'Remove selected text or area', '#bEr'],
    ['find', 'Find / Replace', 'Search and replace text', '#bFind'], ['undo', 'Undo', '', '#bUndo'], ['redo', 'Redo', '', '#bRedo'],
    ['fit', 'Fit page width', '', '#mFit'], ['th', 'Page thumbnails', '', '#mThumbs'],
    ['dl', 'Download PDF', 'Download your edited PDF securely.', '#bDl'], ['lock', 'Download flattened (secure)', 'Erased text is removed for good', '#bFl']
  ];
  var COL = { folder: 'blue', star: 'gold', cam: 'cyan', file: 'teal', word: 'wd', dl: 'vio', image: 'cyan', pen: 'blue' };
  function card(f, i) { return '<button class="nCard ' + (i % 2 ? 'r' : 'l') + '" data-a="' + f[3] + '"><span class="bd ' + (COL[f[0]] || 'vio') + '">' + (f[0] === 'word' ? '<b>W</b>' : ic(f[0])) + '</span><span class="t"><b>' + f[1] + '</b>' + (f[2] ? '<span>' + f[2] + '</span>' : '') + '</span><i class="go">' + ic('arr') + '</i></button>'; }
  function act(a) { if (a === 'ai') { closeSheet(); ask('gen', '', false); } else go(a); }
  function sheet(title, list) {
    var s = $('#nSheet'); s.innerHTML = '<div><h3>' + title + '</h3><div class="nGrid">' + list.map(card).join('') + '</div></div>';
    s.classList.add('open');
  }
  function closeSheet() { var s = $('#nSheet'); if (s) s.classList.remove('open'); }

  function build() {
    var top = document.createElement('div'); top.id = 'nTop';
    top.innerHTML = '<svg class="lg" viewBox="0 0 24 24"><defs><linearGradient id="lgG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><path fill="url(#lgG)" d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z"/><circle cx="20" cy="20" r="1.6" fill="#c4b5fd"/></svg><div class="tt"><h1>AI <i>PDF</i> Editor</h1><small>Edit \u2022 Convert \u2022 Create \u2022 with AI \u2728</small></div><button class="op" id="nOpen">' + ic('crown') + 'Open PDF</button><button class="gr" id="nSet" aria-label="All tools">' + ic('gear') + '</button>';
    var art = '<svg class="art" viewBox="0 0 140 130"><ellipse cx="72" cy="78" rx="64" ry="22" fill="none" stroke="#e9d5ff" stroke-width="2" opacity=".8" transform="rotate(-16 72 78)"/><g transform="rotate(10 64 58)"><rect x="34" y="8" width="62" height="82" rx="9" fill="#ede9fe"/><rect x="45" y="24" width="38" height="5" rx="2.5" fill="#8b5cf6"/><rect x="45" y="35" width="30" height="5" rx="2.5" fill="#a78bfa"/><rect x="45" y="46" width="38" height="5" rx="2.5" fill="#a78bfa"/><rect x="45" y="57" width="26" height="5" rx="2.5" fill="#c4b5fd"/></g><rect x="74" y="66" width="46" height="36" rx="11" fill="#5b21b6"/><text x="97" y="92" text-anchor="middle" font-size="23" font-weight="800" fill="#fff" font-family="sans-serif">AI</text><path d="M14 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#f0abfc"/><path d="M126 14l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="#fde68a"/></svg>';
    var home = document.createElement('div'); home.id = 'nHome';
    home.innerHTML =
      '<div class="nTiles"><button class="nTile" data-a="#bOpen">' + ic('folder') + '<span>Edit<br>PDF</span></button><button class="nTile" data-a="#bBox">' + ic('pen') + '<span>Cover +<br>text</span></button><button class="nTile" data-a="#bImg">' + ic('image') + '<span>Add<br>image</span></button><button class="nTile nw" id="nNew"><i class="pl">' + ic('plus') + '</i><span>New ' + ic('dn') + '</span></button></div>' +
      '<div class="nHero"><div class="nSl" id="nSl">' +
      '<div class="s1">' + art + '<h2>Edit, create and report \u2014 all your PDFs in one place</h2><p>Open a PDF or let AI write a new one, or turn your output screenshots into a finished lab report.</p><div class="r"><button class="w" data-a="#bOpen">' + ic('folder') + 'Open a PDF ' + ic('arr') + '</button><button data-a="ai">' + ic('star') + 'Create with AI</button></div></div>' +
      '<div><h2>Screenshot \u2192 Report</h2><p>Upload your outputs and AI drafts the report in your lab manual format.</p><div class="r"><button class="w" data-a="#bShot">' + ic('cam') + 'Start</button><button data-a="#bTpl">Template + Results</button></div></div>' +
      '<div><h2>Photo to PDF</h2><p>Turn a photo of any page into a clean, searchable PDF.</p><div class="r"><button class="w" data-a="#bCover">' + ic('image') + 'Photo to PDF</button></div></div>' +
      '<div><h2>Word \u2192 PDF</h2><p>Convert .docx files, as an exact copy or fit and fill.</p><div class="r"><button class="w" data-a="#bDoc">' + ic('word') + 'Word \u2192 PDF</button><button data-a="#bDocQ">Exact copy</button></div></div>' +
      '</div><div class="nDots" id="nDots"><i class="on"></i><i></i><i></i><i></i></div></div>' +
      '<div class="nH"><span><em>\u26A1</em> Quick Start</span><button id="nAll">See all ' + ic('arr') + '</button></div><div class="nGrid">' + [0, 1, 2, 3, 4, 19].map(function (i, k) { return card(ALL[i], k); }).join('') + '</div>' +
      '<div class="nAI"><div class="h"><span class="av">\uD83E\uDD16<u></u></span><b>AI Assistant</b><span class="on"><u></u>Online</span><button id="nChatGo" aria-label="Open chat">' + ic('chev') + '</button></div><div class="bub">Hey! I\'m your PDF buddy \uD83D\uDC4B Tell me what you want to do \u2014 edit, create, or get a report! I can write a new PDF for you, edit one you open, or turn your output screenshots into a finished lab report.</div>' +
      '<div class="nChips"><button data-c="gen|Create a report on ">' + ic('file') + 'Generate Report</button><button data-c="edit|">' + ic('pen') + 'Edit PDF</button><button data-c="edit|Summarize this PDF in a short paragraph">' + ic('star') + 'Summarize PDF</button><button data-c="more">More\u2026</button></div>' +
      '<div class="nIn"><span class="sp">' + ic('star') + '</span><input id="nMsg" placeholder="Tell me what you want\u2026"><button class="p" id="nSend" aria-label="Send">' + ic('send') + '</button></div></div>';
    var B = [['undo', 'Undo', '#bUndo'], ['redo', 'Redo', '#bRedo'], 0, ['find', 'Find / Replace', '#bFind'], 0, ['erase', 'Erase', '#bEr'], 0, ['crop', 'Cut / Copy Image', '#bSnip'], 0, ['text', 'Add Text', '#bTxt'], 0, ['page', 'Add Page', '#bPg']];
    var bar = document.createElement('div'); bar.id = 'nBar';
    bar.innerHTML = B.map(function (b) { return b ? '<button data-a="' + b[2] + '">' + ic(b[0]) + '<span>' + b[1] + '</span></button>' : '<i class="sp2"></i>'; }).join('');
    var T = [['pen', 'Cover + text', '#bBox'], ['image', 'Add image', '#bImg'], ['move', 'Scroll', 'mode'], ['zout', 'Zoom out', '#bZo'], ['zin', 'Zoom in', '#bZi'], ['chat', 'AI chat', 'chat'], ['dl', 'Save', '#bDl']];
    var tray = document.createElement('div'); tray.id = 'nTray';
    tray.innerHTML = T.map(function (b) { return '<button data-a="' + b[2] + '"' + (b[2] === 'mode' ? ' id="nMode"' : '') + '>' + ic(b[0]) + '<span>' + b[1] + '</span></button>'; }).join('');
    var sh = document.createElement('div'); sh.id = 'nSheet';
    document.body.append(top, home, tray, bar, sh);
    var pg = $('#mPage'); if (pg) top.append(pg);

    document.body.addEventListener('click', function (e) {
      if (!mq.matches) return;
      if (e.target === sh) return closeSheet();
      var c = e.target.closest('[data-c]');
      if (c) { var v = c.dataset.c.split('|'); if (v[0] === 'more') return chatOpen(); ask(v[0], v[1] || '', false); return; }
      var b = e.target.closest('#nTop [data-a],#nHome [data-a],#nBar [data-a],#nTray [data-a],#nSheet [data-a]');
      if (!b) return;
      var a = b.dataset.a;
      if (a === 'mode') click('#mMode'); else if (a === 'chat') click('#mChat'); else act(a);
    });
    $('#nOpen').onclick = function () { click('#bOpen'); };
    $('#nSet').onclick = function () { click('#mMenu'); };
    $('#nChatGo').onclick = function () { chatOpen(); };
    $('#nNew').onclick = function () { sheet('New', [ALL[7], ALL[1], ALL[3], ALL[4], ALL[5], ALL[6], ALL[2]]); };
    $('#nAll').onclick = function () { sheet('All features', ALL); };
    $('#nSend').onclick = function () { var t = $('#nMsg').value.trim(); if (!t) return chatOpen(); ask('gen', t, true); $('#nMsg').value = ''; };
    $('#nMsg').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#nSend').click(); });
    var sl = $('#nSl'), dots = $('#nDots').children;
    sl.addEventListener('scroll', function () { var i = Math.round(sl.scrollLeft / sl.clientWidth); for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('on', k === i); }, { passive: true });
    setInterval(function () { if (!document.body.classList.contains('m-nopdf')) return; var n = Math.round(sl.scrollLeft / sl.clientWidth) + 1; sl.scrollTo({ left: (n % 4) * sl.clientWidth, behavior: 'smooth' }); }, 5000);

    function sync() { document.body.classList.toggle('m-nopdf', mq.matches && !hasPdf()); }
    new MutationObserver(sync).observe($('#pages'), { childList: true }); sync(); mq.addEventListener && mq.addEventListener('change', sync);
    new MutationObserver(function () { var on = document.body.classList.contains('m-edit'), m = $('#nMode'); m.classList.toggle('on', on); m.querySelector('span').textContent = on ? 'Select' : 'Scroll'; m.querySelector('svg').innerHTML = on ? P.cur : P.move; }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function start() { if (document.getElementById('mTop')) build(); else setTimeout(start, 50); }
  start();
})();
