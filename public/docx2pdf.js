/* Word (.docx) -> PDF converter with "fit & fill" layout.
 *
 * Runs fully in the browser (no server, no API key). Uses:
 *   - mammoth.js  (public/vendor/mammoth.browser.min.js) to read the .docx in document order
 *   - pdf-lib     (already used by the editor) to write the PDF
 *
 * What "fit & fill" means:
 *   1. Everything stays in the original order (text, lists, tables, images).
 *   2. One global scale is searched so text AND images are resized together and the last page
 *      ends near the bottom instead of leaving half a blank page (or spilling 2 lines onto a new one).
 *   3. An image that does not fit under the previous content is shrunk to the space left
 *      (down to 55 %), otherwise it moves to the next page.
 *   4. Any space still left at the bottom of a page is absorbed: images on that page grow a little,
 *      then the gaps between blocks grow, then line spacing grows. No big blank areas remain.
 */
(function (root) {
  'use strict';

  const PAPER = { A4: [595.28, 841.89], Letter: [612, 792] };
  const MIN_IMG_SHRINK = 0.55;   // an image may shrink to 55 % of its wanted size to fill the page bottom
  const LH = 1.28;               // line height factor

  /* ---------- text sanitising (standard PDF fonts only know WinAnsi) ---------- */
  const WIN_OK = /[\x20-\x7E\xA0-\xFF\u2018\u2019\u201A\u201C\u201D\u201E\u2022\u2013\u2014\u2026\u20AC\u2122\u2020\u2021\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2030\u2039\u203A]/;
  const MAP = {
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '-', '\u2212': '-',
    '\u2192': '->', '\u2190': '<-', '\u21D2': '=>', '\u2265': '>=', '\u2264': '<=', '\u2260': '!=', '\u2248': '~',
    '\u2713': 'v', '\u2714': 'v', '\u2717': 'x', '\u25CF': '\u2022', '\u25AA': '\u2022', '\u25AB': '\u2022', '\u2023': '\u2022',
    '\u25E6': '\u2022', '\u2043': '-', '\uF0B7': '\u2022', '\uF0A7': '\u2022', '\uF0D8': '>', '\uF0FC': 'v', '\u00A0': ' ',
    '\u0394': 'delta', '\u03B4': 'delta', '\u03B7': 'eta', '\u03B8': 'theta', '\u03B1': 'alpha', '\u03B2': 'beta', '\u03B3': 'gamma',
    '\u03BB': 'lambda', '\u03BC': 'mu', '\u03C0': 'pi', '\u03C3': 'sigma', '\u03A3': 'sum', '\u2211': 'sum', '\u03C9': 'omega',
    '\u221A': 'sqrt', '\u221E': 'inf', '\u2219': '*', '\u00B5': '\u00B5'
  };
  function sane(t) {
    let o = '';
    for (const ch of t) {
      if (MAP[ch] !== undefined) o += MAP[ch];
      else if (WIN_OK.test(ch)) o += ch;
      else if (/[\u200B-\u200D\uFEFF\u2060\u00AD\uE000-\uE0FF]/.test(ch)) { /* invisible: drop */ }
      else o += '?';
    }
    return o;
  }

  /* ---------- image header parsing (works without a browser) ---------- */
  function b64ToBytes(b64) {
    if (typeof atob === 'function') { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function imgInfo(u8) {
    if (u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      return { type: 'png', w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (u8.length > 4 && u8[0] === 0xFF && u8[1] === 0xD8) {
      let i = 2;
      while (i + 9 < u8.length) {
        if (u8[i] !== 0xFF) { i++; continue; }
        const m = u8[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { type: 'jpg', h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
        i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
      }
    }
    return null;
  }
  // Browser only: re-draw gif/bmp/webp (or huge pictures) onto a canvas so PDF can embed them.
  async function viaCanvas(bytes, mime, asJpeg, maxSide) {
    if (typeof document === 'undefined') return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const im = new Image();
      await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = url; });
      const k = Math.min(1, (maxSide || 1e9) / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, asJpeg ? 'image/jpeg' : 'image/png', 0.9));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: asJpeg ? 'jpg' : 'png', w: c.width, h: c.height };
    } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- HTML (from mammoth) -> block model ---------- */
  const INLINE = new Set(['a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sup', 'sub', 'span', 'code', 'img', 'br', 'small', 'font', 'mark', 'ins', 'abbr', 'cite', 'q', 'kbd', 'tt', 'big']);

  function inlineItems(node, st, out) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.push(Object.assign({ text: n.nodeValue }, st)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') out.push({ br: true });
      else if (tag === 'img') out.push({ img: n.getAttribute('src') || '' });
      else if (tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'div' || tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'blockquote') out.push({ nested: n });
      else {
        const s2 = Object.assign({}, st);
        if (tag === 'strong' || tag === 'b') s2.b = true;
        else if (tag === 'em' || tag === 'i' || tag === 'cite') s2.i = true;
        else if (tag === 'u' || tag === 'ins') s2.u = true;
        else if (tag === 's' || tag === 'strike' || tag === 'del') s2.s = true;
        else if (tag === 'sup') s2.sup = true;
        else if (tag === 'sub') s2.sub = true;
        else if (tag === 'code' || tag === 'kbd' || tag === 'tt') s2.mono = true;
        else if (tag === 'a') { if (n.getAttribute('href')) { s2.link = true; s2.u = true; } }
        inlineItems(n, s2, out);
      }
    }
  }

  // items -> blocks. Splits at images / nested blocks so the ORIGINAL ORDER is kept.
  function itemsToBlocks(items, kind, ctx, list, cls) {
    const blocks = []; let runs = []; let firstList = list;
    const flush = () => {
      if (!runs.length) return;
      const hasText = runs.some(r => r.br || (r.text && /\S/.test(r.text)));
      if (hasText) {
        let align = null;
        const f = runs[0];
        if (f && f.text && f.text.charCodeAt(0) === 0xE000) { align = ({ c: 'center', r: 'right' })[f.text[1]] || null; runs[0] = Object.assign({}, f, { text: f.text.slice(2) }); }
        if (!align && cls && /doc-title|center/.test(cls)) align = 'center';
        blocks.push({ t: 'p', kind, runs, align, list: firstList, cls }); firstList = null;
      }
      runs = [];
    };
    for (const it of items) {
      if (it.img !== undefined) { flush(); blocks.push({ t: 'img', src: it.img }); }
      else if (it.nested) { flush(); blocks.push(...blocksOf(it.nested, ctx, list ? list.level + 1 : 0)); }
      else runs.push(it);
    }
    flush();
    return blocks;
  }

  function listBlocks(el, ctx, level) {
    const out = []; const ordered = el.tagName.toLowerCase() === 'ol'; let idx = (parseInt(el.getAttribute('start'), 10) || 1) - 1;
    const lis = [...el.children].filter(c => c.tagName.toLowerCase() === 'li');
    lis.forEach((li, k) => {
      idx++;
      const items = []; inlineItems(li, {}, items);
      const bl = itemsToBlocks(items, 'li', ctx, { level, ordered, index: idx }, '');
      if (!bl.length) { // empty bullet: keep numbering stable, nothing to draw
        return;
      }
      if (k === lis.length - 1 && level === 0) { for (let j = bl.length - 1; j >= 0; j--) if (bl[j].t === 'p') { bl[j].listEnd = true; break; } }
      out.push(...bl);
    });
    return out;
  }

  function tableBlock(tbl, ctx) {
    const rows = [], occ = [];
    const trs = [...tbl.querySelectorAll('tr')].filter(tr => tr.closest('table') === tbl);
    trs.forEach((tr, r) => {
      occ[r] = occ[r] || []; const cells = []; let c = 0;
      for (const td of [...tr.children].filter(x => /^t[dh]$/i.test(x.tagName))) {
        while (occ[r][c]) { cells.push({ blocks: [], span: 1, empty: true }); c++; }
        const span = Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1), rs = Math.max(1, parseInt(td.getAttribute('rowspan'), 10) || 1);
        const sub = Object.assign({}, ctx, { inCell: true });
        cells.push({ blocks: blocksOf(td, sub, 0), span, th: td.tagName.toLowerCase() === 'th' });
        for (let k = 0; k < span; k++) { for (let q = 1; q < rs; q++) { occ[r + q] = occ[r + q] || []; occ[r + q][c + k] = true; } }
        c += span;
      }
      rows.push(cells);
    });
    return { t: 'table', rows };
  }

  function blocksOf(container, ctx, level) {
    const out = []; let group = [];
    const flushGroup = () => { if (group.length) { const items = []; group.forEach(n => inlineItems({ childNodes: [n] }, {}, items)); out.push(...itemsToBlocks(items, 'p', ctx, null, '')); group = []; } };
    for (const n of container.childNodes) {
      if (n.nodeType === 3) { if (/\S/.test(n.nodeValue) || group.length) group.push(n); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (INLINE.has(tag)) { group.push(n); continue; }
      flushGroup();
      if (tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'blockquote') {
        const items = []; inlineItems(n, {}, items);
        out.push(...itemsToBlocks(items, tag === 'p' ? 'p' : tag, ctx, null, n.getAttribute('class') || ''));
      } else if (tag === 'ul' || tag === 'ol') out.push(...listBlocks(n, ctx, level || 0));
      else if (tag === 'table') {
        if (ctx.inCell) { // nested table: flatten to text lines so nothing is lost
          [...n.querySelectorAll('tr')].forEach(tr => { const txt = [...tr.children].map(td => td.textContent.trim()).filter(Boolean).join('  |  '); if (txt) out.push({ t: 'p', kind: 'p', runs: [{ text: txt }], align: null, list: null }); });
        } else out.push(tableBlock(n, ctx));
      } else if (tag === 'img') out.push({ t: 'img', src: n.getAttribute('src') || '' });
      else if (tag === 'hr') { /* ignore */ }
      else out.push(...blocksOf(n, ctx, level)); // div, section ...
    }
    flushGroup();
    return out;
  }

  /* ---------- fonts / measuring ---------- */
  function makeFonts(doc, SF, fam) {
    const names = {
      Helvetica: [[SF.Helvetica, SF.HelveticaOblique], [SF.HelveticaBold, SF.HelveticaBoldOblique]],
      Times: [[SF.TimesRoman, SF.TimesRomanItalic], [SF.TimesRomanBold, SF.TimesRomanBoldItalic]],
      Courier: [[SF.Courier, SF.CourierOblique], [SF.CourierBold, SF.CourierBoldOblique]]
    };
    const F = {};
    return (async () => {
      for (const k of Object.keys(names)) { F[k] = [[null, null], [null, null]]; for (let b = 0; b < 2; b++) for (let i = 0; i < 2; i++) F[k][b][i] = await doc.embedFont(names[k][b][i]); }
      return F;
    })();
  }
  const CW = new Map();
  function chW(font, ch) {
    let m = CW.get(font); if (!m) { m = new Map(); CW.set(font, m); }
    let w = m.get(ch);
    if (w === undefined) { try { w = font.widthOfTextAtSize(ch, 1000) / 1000; } catch (e) { w = 0.55; } m.set(ch, w); }
    return w;
  }
  const strW = (font, t, size) => { let w = 0; for (const ch of t) w += chW(font, ch); return w * size; };

  /* ---------- paragraph wrapping ---------- */
  const KINDS = {
    p: { m: 1, b: false, i: false, bf: 0, af: 0.55, lh: LH },
    li: { m: 1, b: false, i: false, bf: 0, af: 0.28, lh: LH },
    h1: { m: 1.9, b: true, i: false, bf: 0.75, af: 0.35, lh: 1.18 },
    h2: { m: 1.55, b: true, i: false, bf: 0.7, af: 0.33, lh: 1.18 },
    h3: { m: 1.3, b: true, i: false, bf: 0.65, af: 0.3, lh: 1.2 },
    h4: { m: 1.15, b: true, i: false, bf: 0.6, af: 0.28, lh: 1.22 },
    h5: { m: 1.05, b: true, i: false, bf: 0.55, af: 0.25, lh: 1.25 },
    h6: { m: 1, b: true, i: true, bf: 0.5, af: 0.25, lh: 1.25 },
    blockquote: { m: 1, b: false, i: true, bf: 0.1, af: 0.6, lh: LH }
  };

  function toWords(runs) {
    const words = []; let cur = null;
    const lastW = () => words[words.length - 1];
    for (const r of runs) {
      if (r.br) { if (cur) { words.push(cur); cur = null; } words.push({ br: true }); continue; }
      const text = sane(r.text || '');
      for (const part of text.split(/(\s+)/)) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) {
          if (cur) { cur.sp = r; words.push(cur); cur = null; }
          else if (words.length && !lastW().br && !lastW().sp) lastW().sp = r;
        } else { if (!cur) cur = { pieces: [], sp: null }; cur.pieces.push({ text: part, st: r }); }
      }
    }
    if (cur) words.push(cur);
    return words;
  }

  // -> { lines:[{segs,natW,nSp,h,maxSize,last}], }
  function wrap(runs, maxW, def, baseSize, ctx) {
    const F = ctx.F, lhf = def.lh;
    const fontOf = st => F[st.mono ? 'Courier' : ctx.fam][(st.b || def.b) ? 1 : 0][(st.i || def.i) ? 1 : 0];
    const sizeOf = st => baseSize * ((st.sup || st.sub) ? 0.7 : 1);
    const colorOf = st => st.link ? ctx.C.link : ctx.C.text;
    const words = toWords(runs);
    const entries = []; // flatten with measured widths
    for (const w of words) {
      if (w.br) { entries.push({ br: true }); continue; }
      let ww = 0; const pcs = w.pieces.map(p => { const f = fontOf(p.st), s = sizeOf(p.st), pw = strW(f, p.text, s); ww += pw; return { text: p.text, st: p.st, font: f, size: s, w: pw }; });
      const sp = w.sp ? { st: w.sp, font: fontOf(w.sp), size: sizeOf(w.sp) } : null;
      if (sp) sp.w = strW(sp.font, ' ', sp.size);
      if (ww > maxW && maxW > 10) { // very long word: split by characters
        let acc = [], aw = 0;
        for (const p of pcs) for (const ch of p.text) {
          const cwid = chW(p.font, ch) * p.size;
          if (acc.length && aw + cwid > maxW) { entries.push({ pieces: mergeP(acc), w: aw, sp: null }); acc = []; aw = 0; }
          acc.push({ text: ch, st: p.st, font: p.font, size: p.size, w: cwid }); aw += cwid;
        }
        if (acc.length) entries.push({ pieces: mergeP(acc), w: aw, sp });
      } else entries.push({ pieces: pcs, w: ww, sp });
    }
    function mergeP(arr) { const o = []; for (const p of arr) { const l = o[o.length - 1]; if (l && l.st === p.st && l.font === p.font) { l.text += p.text; l.w += p.w; } else o.push(Object.assign({}, p)); } return o; }

    const lines = []; let cur = [], lw = 0;
    const emptyH = baseSize * lhf;
    function end(last) {
      let maxS = 0; for (const e of cur) for (const p of e.pieces) maxS = Math.max(maxS, p.size);
      if (!cur.length) maxS = baseSize;
      // build segments (coalesce neighbours with the same look so text stays selectable / searchable)
      const segs = []; let nSp = 0, nat = 0;
      const add = (text, font, size, st, isSp) => {
        const key = font.name + '|' + size + '|' + (st.link ? 1 : 0) + (st.u ? 1 : 0) + (st.s ? 1 : 0) + (st.sup ? 1 : 0) + (st.sub ? 1 : 0);
        const l = segs[segs.length - 1];
        if (l && l.key === key) { l.text += text; } else segs.push({ key, text, font, size, st, spaces: 0 });
        if (isSp) segs[segs.length - 1].spaces++;
      };
      cur.forEach((e, k) => { for (const p of e.pieces) add(p.text, p.font, p.size, p.st, false); if (k < cur.length - 1 && e.sp) { add(' ', e.sp.font, e.sp.size, e.sp.st, true); nSp++; } });
      for (const s of segs) { s.w = strW(s.font, s.text, s.size); nat += s.w; s.color = colorOf(s.st); s.rise = s.st.sup ? maxS * 0.36 : s.st.sub ? -maxS * 0.12 : 0; }
      lines.push({ segs, natW: nat, nSp, h: maxS * lhf, maxSize: maxS, last });
      cur = []; lw = 0;
    }
    for (const e of entries) {
      if (e.br) { end(true); continue; }
      if (cur.length && lw + e.w > maxW + 0.01) end(false);
      cur.push(e); lw += e.w + (e.sp ? e.sp.w : 0);
    }
    if (cur.length) end(true);
    if (!lines.length) lines.push({ segs: [], natW: 0, nSp: 0, h: emptyH, maxSize: baseSize, last: true });
    return lines;
  }

  function minContentW(runs, def, baseSize, ctx) {
    const lines = wrap(runs, 1e6, def, baseSize, ctx); let natW = 0; for (const l of lines) natW = Math.max(natW, l.natW);
    let longest = 0;
    for (const w of toWords(runs)) { if (w.br) continue; let ww = 0; for (const p of w.pieces) { const f = ctx.F[p.st.mono ? 'Courier' : ctx.fam][(p.st.b || def.b) ? 1 : 0][(p.st.i || def.i) ? 1 : 0]; ww += strW(f, p.text, baseSize); } longest = Math.max(longest, ww); }
    return { natW, longest };
  }

  /* ---------- phase 1: blocks -> laid-out blocks (depends on scale) ---------- */
  function layoutBlocks(blocks, W, ctx, inCell) {
    const out = []; const fs = ctx.fs;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.t === 'p') {
        const kd = KINDS[b.kind] || KINDS.p, size = fs * kd.m;
        let indent = 0, bullet = null;
        if (b.list) {
          const step = fs * 1.7; indent = step * (b.list.level + 1);
          const F = ctx.F[ctx.fam][0][0], FB = ctx.F[ctx.fam][0][0];
          const label = b.list.ordered ? b.list.index + '.' : (b.list.level % 2 ? '-' : '\u2022');
          bullet = { text: label, font: F, size: fs, x: indent - fs * 0.35 - strW(F, label, fs), ordered: b.list.ordered };
        } else if (b.kind === 'blockquote') indent = fs * 2;
        const lines = wrap(b.runs, Math.max(20, W - indent), kd, size, ctx);
        const isH = /^h\d$/.test(b.kind);
        let before = kd.bf * (isH ? size : fs), after = kd.af * (isH ? size : fs);
        if (b.list && b.listEnd) after = 0.6 * fs;
        if (inCell) { before = 0; after = 0.2 * fs; }
        out.push({ t: 'text', lines, indent, bullet, align: b.align, before, after, keepNext: isH && !inCell, justify: !isH && !b.align && !b.list && ctx.justify && !inCell, W: W });
      } else if (b.t === 'img') {
        if (!b.embed) continue;
        let w = Math.min(W, b.embed.w * 0.75 * ctx.s * ctx.imgBoost), h = w * b.embed.h / b.embed.w;
        const maxH = (inCell ? ctx.H * 0.5 : ctx.H * 0.92);
        if (h > maxH) { h = maxH; w = h * b.embed.w / b.embed.h; }
        if (w < 24 && !inCell) { w = Math.min(W, 24); h = w * b.embed.h / b.embed.w; }
        out.push({ t: 'img', w, h, embed: b.embed, before: inCell ? 0 : 0.35 * fs, after: inCell ? 0.2 * fs : 0.7 * fs, W });
      } else if (b.t === 'table') {
        const tb = layoutTable(b, W, ctx);
        if (tb) out.push(tb);
      }
    }
    return out;
  }

  function layoutTable(b, W, ctx) {
    const fs = ctx.fs * 0.94, pad = Math.max(2.5, fs * 0.38);
    const ncol = Math.max(1, ...b.rows.map(r => r.reduce((a, c) => a + c.span, 0)));
    if (!b.rows.length) return null;
    const subCtx = Object.assign({}, ctx, { fs });
    const minW = new Array(ncol).fill(18), maxW = new Array(ncol).fill(18);
    for (const r of b.rows) {
      let c = 0;
      for (const cell of r) {
        let mn = 0, mx = 0;
        for (const blk of cell.blocks) {
          if (blk.t === 'p') { const kd = KINDS[blk.kind] || KINDS.p, sz = fs * kd.m, d = minContentW(blk.runs, Object.assign({}, kd, { b: kd.b || cell.th }), sz, subCtx); mn = Math.max(mn, d.longest); mx = Math.max(mx, d.natW + (blk.list ? fs * 1.7 : 0)); }
          else if (blk.t === 'img' && blk.embed) { mn = Math.max(mn, 30); mx = Math.max(mx, blk.embed.w * 0.75 * ctx.s); }
        }
        mn += 2 * pad + 1; mx += 2 * pad + 1;
        const per = 1 / cell.span;
        for (let k = 0; k < cell.span; k++) { minW[c + k] = Math.max(minW[c + k], mn * per); maxW[c + k] = Math.max(maxW[c + k], mx * per); }
        c += cell.span;
      }
    }
    // column widths: fill the whole width, never overflow it
    let cw; const sMin = minW.reduce((a, x) => a + x, 0), sMax = maxW.reduce((a, x) => a + x, 0);
    if (sMax <= W) cw = maxW.map(x => x + (W - sMax) * (x / sMax));
    else if (sMin >= W) cw = minW.map(x => x * W / sMin);
    else { const spare = W - sMin, flex = sMax - sMin; cw = minW.map((x, i) => x + spare * ((maxW[i] - minW[i]) / flex)); }
    const x0 = []; let acc = 0; for (const w of cw) { x0.push(acc); acc += w; }
    const rows = b.rows.map(r => {
      let c = 0, rh = 0; const cells = [];
      for (const cell of r) {
        const w = cw.slice(c, c + cell.span).reduce((a, x) => a + x, 0), inner = Math.max(10, w - 2 * pad);
        const blocks = cell.blocks.map(x => x.t === 'p' && cell.th ? Object.assign({}, x, { kind: /^h/.test(x.kind) ? x.kind : 'h5' }) : x);
        const subs = layoutBlocks(blocks, inner, subCtx, true);
        let h = 0; subs.forEach((s, i) => { s.gapB = i ? Math.max(subs[i - 1].after, s.before) : 0; h += s.gapB + (s.t === 'text' ? s.lines.reduce((a, l) => a + l.h, 0) : s.h); });
        cells.push({ x: x0[c], w, subs, h, th: cell.th, empty: cell.empty });
        rh = Math.max(rh, h + 2 * pad); c += cell.span;
      }
      return { h: Math.max(rh, fs * LH + 2 * pad), cells };
    });
    const limit = ctx.H * 0.96, outRows = [];
    for (const r of rows) { if (r.h > limit) outRows.push(...splitRow(r, limit, pad)); else outRows.push(r); }
    return { t: 'table', rows: outRows, pad, before: 0.35 * ctx.fs, after: 0.8 * ctx.fs, W };
  }

  // A table row taller than a whole page is cut line by line into several rows so that no text is lost.
  function splitRow(row, limit, pad) {
    const inner = limit - 2 * pad;
    const units = row.cells.map(c => { const u = []; c.subs.forEach(sb => { if (sb.t === 'text') sb.lines.forEach((l, i) => u.push({ sub: sb, line: l, h: l.h, gap: i ? 0 : sb.gapB, first: i === 0 })); else u.push({ sub: sb, img: true, h: sb.h, gap: sb.gapB, first: true }); }); return u; });
    const idx = units.map(() => 0), out = [];
    while (units.some((u, k) => idx[k] < u.length)) {
      let rh = 0;
      const cells = row.cells.map((c, k) => {
        let used = 0; const picked = [];
        while (idx[k] < units[k].length) {
          const un = units[k][idx[k]], g = picked.length ? un.gap : 0;
          if (picked.length && used + g + un.h > inner) break;
          picked.push({ un, g }); used += g + un.h; idx[k]++;
        }
        const subs = [];
        for (const pk of picked) {
          const last = subs[subs.length - 1];
          if (pk.un.img) subs.push(Object.assign({}, pk.un.sub, { gapB: subs.length ? pk.g : 0 }));
          else if (last && last.t === 'text' && last._src === pk.un.sub) last.lines.push(pk.un.line);
          else subs.push(Object.assign({}, pk.un.sub, { lines: [pk.un.line], gapB: subs.length ? pk.g : 0, bullet: pk.un.first ? pk.un.sub.bullet : null, _src: pk.un.sub }));
        }
        rh = Math.max(rh, used);
        return { x: c.x, w: c.w, subs, h: used, th: c.th, empty: c.empty };
      });
      out.push({ h: rh + 2 * pad, cells });
    }
    return out;
  }

  // A one-line paragraph next to a picture belongs to it. "Figure 1 ..." stays under the picture before it;
  // anything else ("Output of ping:") stays above the picture that follows (keepNext, same rule as headings).
  const FIG = /^\s*(fig\.?|figure|image|screenshot|photo)\b/i;
  function pairCaptions(laid) {
    laid.forEach((b, i) => {
      if (b.t !== 'text' || b.keepNext || b.bullet || b.lines.length !== 1 || b.lines[0].natW > b.W * 0.9) return;
      const prev = laid[i - 1], next = laid[i + 1], txt = b.lines[0].segs.map(sg => sg.text).join('');
      const prevImg = prev && prev.t === 'img', nextImg = next && next.t === 'img';
      if (prevImg && nextImg) { if (FIG.test(txt)) b.isCaption = true; else b.keepNext = true; }
      else if (nextImg) b.keepNext = true;
      else if (prevImg) b.isCaption = true;
    });
  }

  /* ---------- phase 2: flow into pages ---------- */
  function flow(laid, geo, ctx) {
    const pages = [[]]; let used = 0; let prevAfter = 0;
    const cur = () => pages[pages.length - 1];
    const newPage = () => { pages.push([]); used = 0; };
    const put = (frag, gapBefore, adj) => { const pg = cur(); const gap = pg.length ? gapBefore : 0; frag.gap = gap; frag.adj = adj; pg.push(frag); used += gap + fragH(frag); };
    const rem = gap => geo.H - used - (cur().length ? gap : 0);
    const minNext = nb => {
      if (!nb) return 0;
      if (nb.t === 'text') return nb.lines.slice(0, 2).reduce((a, l) => a + l.h, 0);
      if (nb.t === 'img') return nb.h * MIN_IMG_SHRINK;
      if (nb.t === 'table') return nb.rows[0].h;
      return 0;
    };
    for (let bi = 0; bi < laid.length; bi++) {
      const b = laid[bi], gap = bi ? Math.max(prevAfter, b.before) : 0;
      if (b.t === 'text') {
        const L = b.lines; let i = 0, first = true;
        if (b.keepNext) {
          const need = L.reduce((a, l) => a + l.h, 0) + minNext(laid[bi + 1]) + gap + Math.max(b.after, (laid[bi + 1] || {}).before || 0);
          if (cur().length && need > rem(0) + 0.01) newPage();
        }
        while (i < L.length) {
          const g = first ? gap : 0, avail = rem(g);
          let n = 0, h = 0; while (i + n < L.length && h + L[i + n].h <= avail + 0.01) { h += L[i + n].h; n++; }
          const remaining = L.length - i;
          if (n < remaining) { // must split
            if (first && n < 2 && remaining > 1 && cur().length) n = 0;           // orphan control
            else if (remaining - n === 1 && n >= 3) n -= 1;                          // widow control
          }
          if (n === 0) { if (cur().length) { newPage(); continue; } n = 1; }
          put({ kind: 'text', blk: b, lines: L.slice(i, i + n), first: i === 0, lineExtra: 0 }, g, first);
          i += n; first = false;
          if (i < L.length) newPage();
        }
      } else if (b.t === 'img') {
        let w = b.w, h = b.h;
        const nx = laid[bi + 1], cap = !!(nx && nx.t === 'text' && nx.isCaption);
        const reserve = cap ? Math.max(b.after, nx.before) + nx.lines[0].h : 0; // a one-line caption stays with its picture
        const avail = rem(gap) - reserve;
        if (h > avail + 0.01) {
          if (avail >= h * MIN_IMG_SHRINK && avail > 36) { const f = avail / h; w *= f; h = avail; }   // shrink to the space that is left
          else if (cur().length) { newPage(); if (h > geo.H) { const f = geo.H / h; w *= f; h = geo.H; } }
          else if (h > geo.H) { const f = geo.H / h; w *= f; h = geo.H; }
        }
        put({ kind: 'img', blk: b, w, h, lineExtra: 0, capNext: cap }, gap, true);
      } else if (b.t === 'table') {
        const totalH = b.rows.reduce((a, r) => a + r.h, 0);
        if (cur().length && totalH <= geo.H * 0.55 && totalH + gap > rem(0) + 0.01) newPage();   // a small table is not split over two pages
        b.rows.forEach((row, ri) => {
          const g = ri === 0 ? gap : 0, nxt = b.rows[ri + 1];
          if (row.h > rem(g) + 0.01 && cur().length) newPage();
          else if (ri === 0 && nxt && cur().length && row.h + nxt.h > rem(g) + 0.01) newPage();                       // never leave a lone header row at the page bottom
          else if (ri === b.rows.length - 2 && nxt && cur().length > 1 && row.h + nxt.h > rem(g) + 0.01 && ri > 0) { /* last two rows stay together */ newPage(); }
          put({ kind: 'row', blk: b, row, h: row.h, lineExtra: 0 }, ri === 0 ? gap : 0, ri === 0);
        });
      }
      prevAfter = b.after;
    }
    if (pages.length > 1 && !cur().length) pages.pop();
    return pages;
  }
  const fragH = f => f.kind === 'text' ? f.lines.reduce((a, l) => a + l.h + f.lineExtra, 0) : f.h;

  /* ---------- phase 3: absorb the blank space left at the bottom of each page ---------- */
  function fillPage(pg, geo, ctx) {
    const sum = () => pg.reduce((a, f, i) => a + (i ? f.gap : 0) + fragH(f), 0);
    let L = geo.H - sum(); if (L < 1 || !pg.length) return { blank: 0, stretch: 0 };
    const L0 = L;
    // 1. let images on this page grow (keeps their proportions, never wider than the text area)
    for (let pass = 0; pass < 3 && L > 1; pass++) {
      const imgs = pg.filter(f => f.kind === 'img' && f.w < geo.W - 0.5);
      if (!imgs.length) break;
      const tot = imgs.reduce((a, f) => a + f.h, 0), want = Math.min(L, tot * 0.6);
      const k = 1 + want / tot; let got = 0;
      for (const f of imgs) { const kf = Math.min(k, geo.W / f.w, 1.9 / (f.grown || 1)); const nh = f.h * kf; got += nh - f.h; f.w *= kf; f.h = nh; f.grown = (f.grown || 1) * kf; }
      L -= got; if (got < 0.5) break;
    }
    const afterImg = L;
    // 2. open up line spacing a little (even, so the page still looks like one piece)
    const tf = pg.filter(f => f.kind === 'text'), nl = tf.reduce((a, f) => a + f.lines.length, 0);
    if (L > 1 && nl) { const per = Math.min(L / nl, ctx.fs * 0.2); tf.forEach(f => f.lineExtra += per); L -= per * nl; }
    // 3. spread the rest between blocks (not between a heading / intro / picture and what belongs to it)
    const gapsIdx = pg.map((f, i) => (i && f.adj && !(pg[i - 1].kind === 'text' && pg[i - 1].blk.keepNext) && !pg[i - 1].capNext) ? i : -1).filter(i => i > 0);
    if (L > 1 && gapsIdx.length) { const per = Math.min(ctx.fs * 1.6, L / gapsIdx.length); for (const i of gapsIdx) pg[i].gap += per; L -= per * gapsIdx.length; }
    // 4. last resort: a bit more line spacing, then wider gaps (still capped so a nearly empty page is not stretched into nonsense)
    if (L > 1 && nl) { const per = Math.min(L / nl, ctx.fs * 0.45); tf.forEach(f => f.lineExtra += per); L -= per * nl; }
    if (L > 1 && gapsIdx.length) { const per = Math.min(L / gapsIdx.length, ctx.fs * 4); for (const i of gapsIdx) pg[i].gap += per; L -= per * gapsIdx.length; }
    return { blank: Math.max(0, L), stretch: Math.max(0, afterImg - Math.max(0, L)) + (L0 - afterImg) * 0.3 };
  }

  /* ---------- drawing ---------- */
  function drawLine(page, line, x0, topY, W, o, PL) {
    const by = o.pageH - (topY + (line.h - line.maxSize) / 2 + line.maxSize * 0.8);
    let off = 0, ex = 0;
    if (o.align === 'center') off = Math.max(0, (W - line.natW) / 2);
    else if (o.align === 'right') off = Math.max(0, W - line.natW);
    else if (o.justify && !line.last && line.nSp > 0) { const e = (W - line.natW) / line.nSp; if (e > 0 && e < line.maxSize * 0.9) ex = e; }
    let x = x0 + off;
    for (const s of line.segs) {
      const y = by + s.rise;
      if (s.text.trim() || s.st.u || s.st.s) {
        if (s.text) {
          if (ex) page.pushOperators(PL.pushGraphicsState(), PL.setWordSpacing(ex));
          page.drawText(s.text, { x, y, size: s.size, font: s.font, color: s.color });
          if (ex) page.pushOperators(PL.popGraphicsState());
        }
        const sw = s.w + s.spaces * ex;
        if (s.st.u) page.drawLine({ start: { x, y: y - s.size * 0.13 }, end: { x: x + sw, y: y - s.size * 0.13 }, thickness: Math.max(0.4, s.size * 0.055), color: s.color });
        if (s.st.s) page.drawLine({ start: { x, y: y + s.size * 0.3 }, end: { x: x + sw, y: y + s.size * 0.3 }, thickness: Math.max(0.4, s.size * 0.055), color: s.color });
        x += sw;
      } else x += s.w + s.spaces * ex;
    }
  }

  function drawTextBlock(page, blk, lines, x, topY, W, o, PL, firstOfBlock, lineExtra) {
    let y = topY;
    lines.forEach((l, k) => {
      if (blk.bullet && firstOfBlock && k === 0) {
        const bl = blk.bullet, by = o.pageH - (y + (l.h - bl.size) / 2 + bl.size * 0.8);
        page.drawText(bl.text, { x: x + bl.x, y: by, size: bl.size, font: bl.font, color: o.C.text });
      }
      drawLine(page, l, x + blk.indent, y, W - blk.indent, { pageH: o.pageH, align: blk.align, justify: blk.justify }, PL);
      y += l.h + lineExtra;
    });
    return y;
  }

  function drawFrag(page, f, topY, geo, o, PL) {
    if (f.kind === 'text') drawTextBlock(page, f.blk, f.lines, geo.left, topY, geo.W, o, PL, f.first, f.lineExtra);
    else if (f.kind === 'img') page.drawImage(f.blk.embed.img, { x: geo.left + (geo.W - f.w) / 2, y: o.pageH - topY - f.h, width: f.w, height: f.h });
    else if (f.kind === 'row') {
      const t = f.blk, pad = t.pad;
      for (const c of f.row.cells) {
        const cx = geo.left + c.x;
        page.drawRectangle({ x: cx, y: o.pageH - topY - f.row.h, width: c.w, height: f.row.h, borderColor: o.C.border, borderWidth: 0.6, color: c.th ? o.C.head : undefined });
        let y = topY + pad;
        c.subs.forEach((s, i) => {
          y += s.gapB;
          if (s.t === 'text') y = drawTextBlock(page, s, s.lines, cx + pad, y, c.w - 2 * pad, o, PL, true, 0);
          else { page.drawImage(s.embed.img, { x: cx + pad, y: o.pageH - y - s.h, width: s.w, height: s.h }); y += s.h; }
        });
      }
    }
  }

  /* ---------- main ---------- */
  async function convert(input, opts) {
    const rawOpts = opts || {};
    // exact mode: copy the Word file as it is (page size, margins, picture sizes, no fit & fill). Not used for .txt / .md.
    if (rawOpts.exact && !/\.(txt|md)$/i.test(rawOpts.name || '')) return EX.convert(input, Object.assign({ paper: 'Auto', pageNumbers: false, uniformImages: true }, rawOpts));
    opts = Object.assign({ paper: 'A4', font: 'Helvetica', fontSize: 11, margin: 48, fill: true, justify: true, pageNumbers: true, name: 'document', onProgress: null }, opts || {});
    const PL = root.PDFLib; if (!PL) throw new Error('pdf-lib is not loaded.');
    const progress = t => { if (opts.onProgress) opts.onProgress(t); };
    const notes = [];
    const ab = input instanceof ArrayBuffer ? input : (input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input);

    /* 1. read the document */
    let html;
    const isTxt = /\.(txt|md)$/i.test(opts.name || '');
    if (isTxt) {
      const txt = new TextDecoder('utf-8').decode(new Uint8Array(ab));
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = txt.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
    } else {
      const mam = root.mammoth; if (!mam) throw new Error('mammoth.js is not loaded (public/vendor/mammoth.browser.min.js).');
      progress('Reading the Word document...');
      const arg = typeof window === 'undefined' && typeof Buffer !== 'undefined' ? { buffer: Buffer.from(new Uint8Array(ab)) } : { arrayBuffer: ab };
      const mopts = {
        styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => h3.doc-title:fresh", 'u => u', 'strike => s'],
        convertImage: mam.images.imgElement(img => img.read('base64').then(b64 => ({ src: 'data:' + img.contentType + ';base64,' + b64 })))
      };
      try { // remember centred / right-aligned paragraphs
        mopts.transformDocument = mam.transforms.paragraph(p => {
          if (p.alignment === 'center' || p.alignment === 'right') return Object.assign({}, p, { children: [{ type: 'run', children: [{ type: 'text', value: '\uE000' + (p.alignment === 'center' ? 'c' : 'r') }] }].concat(p.children) });
          return p;
        });
      } catch (e) { /* alignment is optional */ }
      let res;
      try { res = await mam.convertToHtml(arg, mopts); }
      catch (e) { throw new Error('Could not read this file as a .docx Word document (' + (e.message || e) + '). Legacy .doc files must be saved as .docx first.'); }
      html = res.value;
    }
    const dom = new (root.DOMParser || (typeof window !== 'undefined' ? window.DOMParser : null))().parseFromString('<body>' + html + '</body>', 'text/html');
    const blocks = blocksOf(dom.body, {}, 0);
    if (!blocks.length) throw new Error('No text or images were found in this document.');

    /* 2. prepare PDF + fonts + images */
    const doc = await PL.PDFDocument.create();
    doc.setTitle((opts.name || 'document').replace(/\.[^.]+$/, '')); doc.setProducer('AI PDF Editor'); doc.setCreator('AI PDF Editor');
    const F = await makeFonts(doc, PL.StandardFonts, opts.font);
    const cache = new Map(); let skipped = 0;
    async function embed(src) {
      if (cache.has(src)) return cache.get(src);
      let res = null;
      try {
        const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
        if (m) {
          let bytes = m[2] ? b64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])), info = imgInfo(bytes);
          if (!info || Math.max(info.w, info.h) > 2800) { const c = await viaCanvas(bytes, m[1], !info || info.type === 'jpg' || Math.max(info.w, info.h) > 2800, 2400); if (c) { bytes = c.bytes; info = { type: c.type, w: c.w, h: c.h }; } else if (!info) info = null; }
          if (info && info.w > 0 && info.h > 0) { const img = info.type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); res = { img, w: info.w, h: info.h }; }
        }
      } catch (e) { res = null; }
      if (!res) skipped++;
      cache.set(src, res); return res;
    }
    const walk = async list => { for (const b of list) { if (b.t === 'img') b.embed = await embed(b.src); else if (b.t === 'table') for (const r of b.rows) for (const c of r) await walk(c.blocks); } };
    progress('Preparing images...'); await walk(blocks);
    if (skipped) notes.push(skipped + ' image(s) in a format PDF cannot embed (e.g. EMF/WMF vector) were skipped.');

    /* 3. layout with fit & fill */
    progress('Laying out pages...');
    const [PW, PH] = PAPER[opts.paper] || PAPER.A4, mg = Math.max(18, +opts.margin || 48);
    const geo = { left: mg, W: PW - 2 * mg, top: mg, H: PH - 2 * mg };
    const base = Math.max(6, +opts.fontSize || 11);
    const C = { text: PL.rgb(0.08, 0.08, 0.1), link: PL.rgb(0.05, 0.25, 0.75), border: PL.rgb(0.55, 0.55, 0.58), head: PL.rgb(0.93, 0.94, 0.97) };
    const build = (s, fill) => {
      const ctx = { F, fam: opts.font, fs: base * s, s, H: geo.H, justify: opts.justify, imgBoost: 1, C };
      const laid = layoutBlocks(blocks, geo.W, ctx, false);
      pairCaptions(laid);
      const pages = flow(laid, geo, ctx);
      let blank = 0, stretch = 0;
      if (fill) pages.forEach(pg => { const r = fillPage(pg, geo, ctx); blank += r.blank; stretch += r.stretch; });
      return { pages, ctx, blank, stretch };
    };
    let scale = 1;
    if (opts.fill) {
      // Try many text/image scales; keep the one that leaves the least blank space (and stretches spacing least) while staying close to the original size.
      const smin = Math.max(0.8, 8 / base), smax = Math.min(1.3, 15 / base);
      const evalS = async s => { if (typeof setTimeout === 'function' && typeof window !== 'undefined') await new Promise(r => setTimeout(r, 0)); const r = build(s, true); return { s, cost: (r.blank + r.stretch * 0.8) / geo.H + 1.6 * Math.abs(Math.log(s)) + 0.03 * r.pages.length }; };
      let best = null;
      for (let s = smin; s <= smax + 1e-9; s += 0.05) { const e = await evalS(s); if (!best || e.cost < best.cost - 1e-9) best = e; }
      const e1 = await evalS(1); if (e1.cost <= best.cost + 1e-9) best = e1;
      for (const d of [0.025, 0.0125, 0.006, 0.003]) for (const s of [best.s - d, best.s + d]) if (s >= smin && s <= smax) { const e = await evalS(s); if (e.cost < best.cost - 1e-9) best = e; }
      scale = best.s;
    }
    const { pages, ctx, blank } = build(scale, opts.fill);

    /* 4. draw */
    progress('Writing the PDF...');
    const numFont = F.Helvetica[0][0], total = pages.length;
    pages.forEach((pg, pi) => {
      const page = doc.addPage([PW, PH]); let y = 0;
      pg.forEach((f, k) => { if (k) y += f.gap; drawFrag(page, f, geo.top + y, geo, { pageH: PH, C }, PL); y += fragH(f); });
      if (opts.pageNumbers) { const t = (pi + 1) + ' / ' + total; page.drawText(t, { x: PW / 2 - strW(numFont, t, 9) / 2, y: Math.min(mg * 0.45, 26), size: 9, font: numFont, color: PL.rgb(0.45, 0.45, 0.5) }); }
    });
    const bytes = await doc.save();
    return { bytes, pages: total, scale, fontPt: +(base * scale).toFixed(1), blankPt: Math.round(blank), notes };
  }

  /* =====================================================================================
   *  EXACT MODE  -  "looks like the Word file"
   *  Reads the .docx package itself (JSZip) instead of re-flowing it:
   *    - page size + margins come from the Word file (Letter stays Letter)
   *    - pictures keep the size they have in Word (EMU extents); pictures that are (almost) as wide
   *      as the text area are all snapped to exactly the same full width
   *    - nothing is shrunk / grown to "fill" a page: pages break where Word breaks them
   *    - font sizes, bold / italic / underline / colour, alignment, spacing, indents, lists, tabs,
   *      tables (grid widths, borders, shading, column spans) are taken from the file
   * ===================================================================================== */
  const EX = (function () {
    const q = (e, n) => { if (!e) return null; for (let c = e.firstChild; c; c = c.nextSibling) if (c.nodeName === n) return c; return null; };
    const qa = (e, n) => { const o = []; if (!e) return o; for (let c = e.firstChild; c; c = c.nextSibling) if (c.nodeName === n) o.push(c); return o; };
    const at = (e, n) => (e && e.hasAttribute && e.hasAttribute(n)) ? e.getAttribute(n) : null;
    const tog = (p, n) => { const e = q(p, n); if (!e) return undefined; const v = at(e, 'w:val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); };
    const nv = (e, n, a) => { const x = q(e, n); const v = x ? at(x, a || 'w:val') : null; return v === null || v === '' || isNaN(+v) ? undefined : +v; };
    const merge = (...os) => { const r = {}; for (const o of os) if (o) for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; };
    const HL = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000' };

    function parseR(rp) {
      const r = {}; if (!rp) return r; let v;
      if ((v = tog(rp, 'w:b')) !== undefined) r.b = v;
      if ((v = tog(rp, 'w:i')) !== undefined) r.i = v;
      if ((v = tog(rp, 'w:strike')) !== undefined) r.s = v;
      if ((v = tog(rp, 'w:caps')) !== undefined) r.caps = v;
      if ((v = tog(rp, 'w:vanish')) !== undefined) r.hide = v;
      const u = q(rp, 'w:u'); if (u) r.u = at(u, 'w:val') !== 'none';
      if ((v = nv(rp, 'w:sz')) !== undefined) r.sz = v / 2;
      const c = q(rp, 'w:color'); if (c) { const cv = at(c, 'w:val'); if (cv && cv !== 'auto' && /^[0-9a-f]{6}$/i.test(cv)) r.color = cv; else if (cv === 'auto') r.color = '000000'; }
      const h = q(rp, 'w:highlight'); if (h) { const hv = at(h, 'w:val'); if (HL[hv]) r.hl = HL[hv]; }
      const sh = q(rp, 'w:shd'); if (sh) { const f = at(sh, 'w:fill'); if (f && /^[0-9a-f]{6}$/i.test(f)) r.hl = f; }
      const rf = q(rp, 'w:rFonts'); if (rf) { r.font = at(rf, 'w:ascii') || at(rf, 'w:hAnsi') || undefined; r.theme = at(rf, 'w:asciiTheme') || at(rf, 'w:hAnsiTheme') || undefined; if (r.font) r.theme = undefined; }
      const va = q(rp, 'w:vertAlign'); if (va) { const vv = at(va, 'w:val'); if (vv === 'superscript') r.sup = true; else if (vv === 'subscript') r.sub = true; }
      const rs = q(rp, 'w:rStyle'); if (rs) r.rStyle = at(rs, 'w:val');
      return r;
    }
    function parseP(pp) {
      const p = {}; if (!pp) return p; let v;
      const jc = q(pp, 'w:jc'); if (jc) { const j = at(jc, 'w:val'); p.jc = ({ left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'both', distribute: 'both' })[j] || 'left'; }
      const sp = q(pp, 'w:spacing'); if (sp) {
        const f = k => { const x = at(sp, k); return x === null || isNaN(+x) ? undefined : +x; };
        p.before = f('w:before') !== undefined ? f('w:before') / 20 : undefined; p.after = f('w:after') !== undefined ? f('w:after') / 20 : undefined;
        if (f('w:line') !== undefined) { p.line = f('w:line'); p.rule = at(sp, 'w:lineRule') || 'auto'; }
      }
      const ind = q(pp, 'w:ind'); if (ind) {
        const f = (...ks) => { for (const k of ks) { const x = at(ind, k); if (x !== null && !isNaN(+x)) return +x / 20; } return undefined; };
        p.left = f('w:left', 'w:start'); p.right = f('w:right', 'w:end'); p.first = f('w:firstLine'); p.hang = f('w:hanging');
        if (p.hang !== undefined && p.first === undefined) p.first = -p.hang; if (p.first !== undefined && p.first >= 0) p.hang = undefined;
      }
      if ((v = tog(pp, 'w:pageBreakBefore')) !== undefined) p.pbb = v;
      if ((v = tog(pp, 'w:keepNext')) !== undefined) p.keepNext = v;
      if ((v = tog(pp, 'w:keepLines')) !== undefined) p.keepLines = v;
      if ((v = tog(pp, 'w:widowControl')) !== undefined) p.widow = v;
      if ((v = tog(pp, 'w:contextualSpacing')) !== undefined) p.ctx = v;
      const np = q(pp, 'w:numPr'); if (np) { const ni = nv(np, 'w:numId'); if (ni !== undefined) p.numId = ni; const il = nv(np, 'w:ilvl'); if (il !== undefined) p.ilvl = il; }
      const ps = q(pp, 'w:pStyle'); if (ps) p.pStyle = at(ps, 'w:val');
      const tabs = q(pp, 'w:tabs'); if (tabs) p.tabs = qa(tabs, 'w:tab').filter(t => at(t, 'w:val') !== 'clear').map(t => ({ pos: +at(t, 'w:pos') / 20, val: at(t, 'w:val') || 'left' })).filter(t => !isNaN(t.pos));
      const sh = q(pp, 'w:shd'); if (sh) { const f = at(sh, 'w:fill'); if (f && /^[0-9a-f]{6}$/i.test(f)) p.shd = f; }
      if (q(pp, 'w:sectPr')) p.sect = true;
      return p;
    }
    function parseBorders(el) {
      if (!el) return null; const o = {}; let any = false;
      for (const k of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'start', 'end']) {
        const b = q(el, 'w:' + k); if (!b) continue; const val = at(b, 'w:val');
        const key = k === 'start' ? 'left' : k === 'end' ? 'right' : k;
        if (!val || val === 'nil' || val === 'none') o[key] = { none: true };
        else { const sz = +at(b, 'w:sz'); const c = at(b, 'w:color'); o[key] = { w: Math.max(0.25, (isNaN(sz) ? 4 : sz) / 8), color: c && /^[0-9a-f]{6}$/i.test(c) ? c : '000000' }; }
        any = true;
      }
      return any ? o : null;
    }

    function loadStyles(xml, themeXml) {
      const S = { defR: {}, defP: {}, byId: {}, defPara: null, defTable: null, minor: 'Calibri', major: 'Calibri' };
      if (themeXml) { let m = /<a:minorFont>\s*<a:latin typeface="([^"]*)"/.exec(themeXml); if (m && m[1]) S.minor = m[1]; m = /<a:majorFont>\s*<a:latin typeface="([^"]*)"/.exec(themeXml); if (m && m[1]) S.major = m[1]; }
      if (!xml) return S;
      const d = xml.documentElement || xml;
      const dd = q(d, 'w:docDefaults');
      if (dd) { S.defR = parseR(q(q(dd, 'w:rPrDefault'), 'w:rPr')); S.defP = parseP(q(q(dd, 'w:pPrDefault'), 'w:pPr')); }
      for (const st of qa(d, 'w:style')) {
        const id = at(st, 'w:styleId'); if (!id) continue;
        const type = at(st, 'w:type'), bo = q(st, 'w:basedOn');
        const tp = q(st, 'w:tblPr');
        S.byId[id] = { type, based: bo ? at(bo, 'w:val') : null, r: parseR(q(st, 'w:rPr')), p: parseP(q(st, 'w:pPr')), borders: tp ? parseBorders(q(tp, 'w:tblBorders')) : null, mar: tp ? parseMar(q(tp, 'w:tblCellMar')) : null };
        if (at(st, 'w:default') === '1' || at(st, 'w:default') === 'true') { if (type === 'paragraph') S.defPara = id; else if (type === 'table') S.defTable = id; }
      }
      return S;
    }
    function parseMar(m) {
      if (!m) return null; const o = {}; for (const [k, n] of [['t', 'w:top'], ['l', 'w:left'], ['b', 'w:bottom'], ['r', 'w:right'], ['l', 'w:start'], ['r', 'w:end']]) { const e = q(m, n); if (e) { const w = +at(e, 'w:w'); if (!isNaN(w)) o[k] = w / 20; } }
      return o;
    }
    function styleChain(S, id, memo) {
      if (!id || !S.byId[id]) return { r: {}, p: {}, borders: null, mar: null };
      if (memo[id]) return memo[id];
      const st = S.byId[id]; memo[id] = { r: {}, p: {}, borders: null, mar: null };
      const base = st.based && st.based !== id ? styleChain(S, st.based, memo) : { r: {}, p: {}, borders: null, mar: null };
      return (memo[id] = { r: merge(base.r, st.r), p: merge(base.p, st.p), borders: st.borders || base.borders, mar: st.mar || base.mar });
    }

    function loadNumbering(xml) {
      const N = { abs: {}, nums: {}, counters: {} }; if (!xml) return N; const d = xml.documentElement || xml;
      for (const a of qa(d, 'w:abstractNum')) {
        const id = at(a, 'w:abstractNumId'), lv = {};
        for (const l of qa(a, 'w:lvl')) {
          const il = +at(l, 'w:ilvl'), fmt = at(q(l, 'w:numFmt'), 'w:val') || 'decimal', txt = at(q(l, 'w:lvlText'), 'w:val'), st = nv(l, 'w:start');
          lv[il] = { fmt, text: txt === null ? '%' + (il + 1) + '.' : txt, start: st === undefined ? 1 : st, p: parseP(q(l, 'w:pPr')), r: parseR(q(l, 'w:rPr')) };
        }
        N.abs[id] = lv;
      }
      for (const n of qa(d, 'w:num')) { const id = at(n, 'w:numId'), ab = at(q(n, 'w:abstractNumId'), 'w:val'); N.nums[id] = ab; }
      return N;
    }
    const roman = n => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, t] of m) while (n >= v) { s += t; n -= v; } return s; };
    const alpha = n => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return s; };
    function fmtNum(f, n) {
      switch (f) { case 'lowerLetter': return alpha(n); case 'upperLetter': return alpha(n).toUpperCase(); case 'lowerRoman': return roman(n); case 'upperRoman': return roman(n).toUpperCase(); case 'decimalZero': return (n < 10 ? '0' : '') + n; case 'none': return ''; default: return String(n); }
    }
    function numLabel(N, numId, ilvl) {
      const ab = N.nums[numId]; if (ab === undefined || !N.abs[ab]) return null;
      const lv = N.abs[ab], L = lv[ilvl]; if (!L) return null;
      const key = ab, c = N.counters[key] || (N.counters[key] = []);
      c[ilvl] = (c[ilvl] === undefined ? L.start : c[ilvl] + 1);
      for (let k = ilvl + 1; k < 10; k++) c[k] = undefined;
      let label;
      if (L.fmt === 'bullet') label = L.text || '\u2022';
      else label = L.text.replace(/%(\d)/g, (m, d) => { const k = +d - 1, l2 = lv[k]; const val = c[k] === undefined ? (l2 ? l2.start : 1) : c[k]; return fmtNum(l2 ? l2.fmt : 'decimal', val); });
      return { text: label, lvl: L, bullet: L.fmt === 'bullet' };
    }

    /* ---------- fonts ---------- */
    function famOf(name) {
      const n = (name || 'Calibri').toLowerCase();
      if (/courier|consolas|mono|lucida console|menlo|fixed/.test(n)) return { key: 'Courier', hs: /consolas/.test(n) ? 0.92 : 1, F: 1.13, A: 0.83, D: 0.3 };
      if (/times|cambria|georgia|garamond|palatino|book antiqua|century|minion|baskerville|serif/.test(n) && !/sans/.test(n)) return { key: 'Times', hs: 1, F: 1.15, A: 0.89, D: 0.22 };
      if (/calibri|carlito/.test(n)) return { key: 'Helvetica', hs: 0.9, F: 1.22, A: 0.75, D: 0.25 };
      if (/verdana/.test(n)) return { key: 'Helvetica', hs: 1.08, F: 1.215, A: 1.0, D: 0.21 };
      return { key: 'Helvetica', hs: 1, F: 1.15, A: 0.905, D: 0.212 };
    }

    /* ---------- convert ---------- */
    async function convert(input, opts) {
      const PL = root.PDFLib; if (!PL) throw new Error('pdf-lib is not loaded.');
      const JZ = root.JSZip; if (!JZ) throw new Error('JSZip is not loaded (public/vendor/jszip.min.js).');
      const DP = root.DOMParser || (typeof window !== 'undefined' ? window.DOMParser : null); if (!DP) throw new Error('No XML parser available.');
      const progress = t => { if (opts.onProgress) opts.onProgress(t); };
      const notes = [];
      progress('Reading the Word file...');
      let zip;
      try { zip = await JZ.loadAsync(input); } catch (e) { throw new Error('Could not read this file as a .docx Word document (' + (e.message || e) + '). Legacy .doc files must be saved as .docx first.'); }
      const readText = async p => { const f = zip.file(p); return f ? await f.async('string') : null; };
      const parseXml = s => { if (!s) return null; const d = new DP().parseFromString(s, 'application/xml'); if (d.getElementsByTagName && d.getElementsByTagName('parsererror').length) return null; return d; };
      const docXml = parseXml(await readText('word/document.xml'));
      if (!docXml) throw new Error('This is not a valid .docx (word/document.xml is missing).');
      const S = loadStyles(parseXml(await readText('word/styles.xml')), await readText('word/theme/theme1.xml'));
      const N = loadNumbering(parseXml(await readText('word/numbering.xml')));
      const setXml = await readText('word/settings.xml') || '';
      const compatM = /compatibilityMode"[^>]*w:val="(\d+)"/.exec(setXml); const compat = compatM ? +compatM[1] : 12;
      const relsXml = parseXml(await readText('word/_rels/document.xml.rels'));
      const rels = {}; if (relsXml) for (const r of Array.from(relsXml.getElementsByTagName('Relationship'))) rels[r.getAttribute('Id')] = r.getAttribute('Target');
      const body = q(docXml.documentElement, 'w:body');
      const memo = {};

      /* ----- section (page) geometry, taken from the last sectPr of the body ----- */
      const sect = q(body, 'w:sectPr');
      let PW = 612, PH = 792, mt = 72, mb = 72, ml = 72, mr = 72;
      if (sect) {
        const sz = q(sect, 'w:pgSz'); if (sz) { const w = +at(sz, 'w:w'), h = +at(sz, 'w:h'); if (w > 0 && h > 0) { PW = w / 20; PH = h / 20; } }
        const pm = q(sect, 'w:pgMar'); if (pm) { const g = k => { const v = +at(pm, k); return isNaN(v) ? undefined : v / 20; }; mt = g('w:top') ?? mt; mb = g('w:bottom') ?? mb; ml = g('w:left') ?? ml; mr = g('w:right') ?? mr; if (mt < 0) mt = -mt; if (mb < 0) mb = -mb; ml += (g('w:gutter') || 0); }
        if (q(sect, 'w:headerReference') || q(sect, 'w:footerReference')) notes.push('Headers / footers of the Word file are not drawn.');
      }
      if (opts.paper && opts.paper !== 'Auto' && PAPER[opts.paper]) { [PW, PH] = PAPER[opts.paper]; }
      const TW = PW - ml - mr, TH = PH - mt - mb;
      if (TW < 50 || TH < 50) throw new Error('The page margins in this Word file leave no room for content.');

      /* ----- document model ----- */
      const media = {};  // rId -> { path }
      const stats = { textbox: 0 };
      const themeFont = r => r.font || (r.theme ? (/major/i.test(r.theme) ? S.major : S.minor) : null);

      function drawingItem(d) {
        const host = q(d, 'wp:inline') || q(d, 'wp:anchor'); if (!host) return null;
        const ex = q(host, 'wp:extent'); const cx = ex ? +at(ex, 'cx') : 0, cy = ex ? +at(ex, 'cy') : 0;
        const blip = host.getElementsByTagName('a:blip')[0];
        if (!blip) { stats.textbox++; return null; }
        const rid = at(blip, 'r:embed') || at(blip, 'r:link'); if (!rid || !cx || !cy) return null;
        let crop = null; const sr = host.getElementsByTagName('a:srcRect')[0];
        if (sr) { const g = k => (+at(sr, k) || 0) / 100000; const c = { l: g('l'), t: g('t'), r: g('r'), b: g('b') }; if (c.l || c.t || c.r || c.b) crop = c; }
        return { k: 'img', rid, w: cx / 12700, h: cy / 12700, crop };
      }
      function pictItem(pc) {
        const im = pc.getElementsByTagName('v:imagedata')[0]; if (!im) return null; const rid = at(im, 'r:id'); if (!rid) return null;
        const sh = pc.getElementsByTagName('v:shape')[0]; const st = sh ? (at(sh, 'style') || '') : '';
        const w = /width:\s*([\d.]+)pt/.exec(st), h = /height:\s*([\d.]+)pt/.exec(st); if (!w || !h) return null;
        return { k: 'img', rid, w: +w[1], h: +h[1], crop: null };
      }
      function runChildren(node, r, items) {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          const n = c.nodeName;
          if (n === 'w:t') items.push({ k: 't', text: c.textContent, r });
          else if (n === 'w:tab') items.push({ k: 'tab', r });
          else if (n === 'w:br') { const t = at(c, 'w:type'); items.push(t === 'page' || t === 'column' ? { k: 'pb', r } : { k: 'br', r }); }
          else if (n === 'w:cr') items.push({ k: 'br', r });
          else if (n === 'w:noBreakHyphen') items.push({ k: 't', text: '-', r });
          else if (n === 'w:drawing') { const it = drawingItem(c); if (it) items.push(it); }
          else if (n === 'w:pict') { const it = pictItem(c); if (it) items.push(it); else if (c.getElementsByTagName('w:txbxContent').length) stats.textbox++; }
          else if (n === 'mc:AlternateContent') { const ch = q(c, 'mc:Choice') || q(c, 'mc:Fallback'); if (ch) runChildren(ch, r, items); }
        }
      }
      function walkInline(node, r0, rStyleP, items) {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          const n = c.nodeName;
          if (n === 'w:r') {
            const rp = parseR(q(c, 'w:rPr')); const cs = rp.rStyle ? styleChain(S, rp.rStyle, memo).r : null;
            const r = merge(r0, cs, rp); if (r.hide) continue;
            runChildren(c, r, items);
          } else if (n === 'w:hyperlink' || n === 'w:ins' || n === 'w:smartTag' || n === 'w:fldSimple' || n === 'w:customXml' || n === 'w:sdtContent' || n === 'w:moveTo') walkInline(c, r0, rStyleP, items);
          else if (n === 'w:sdt') walkInline(q(c, 'w:sdtContent') || c, r0, rStyleP, items);
          else if (n === 'mc:AlternateContent') { const ch = q(c, 'mc:Choice') || q(c, 'mc:Fallback'); if (ch) walkInline(ch, r0, rStyleP, items); }
        }
      }
      function buildPara(p, inTable, tst) {
        const ppr = q(p, 'w:pPr'), dp = parseP(ppr);
        const pst = styleChain(S, dp.pStyle || S.defPara, memo);
        const tP = tst ? tst.p : null, tR = tst ? tst.r : null;
        let pp = merge(S.defP, tP, pst.p, dp);
        const baseR = merge(S.defR, tR, pst.r);
        let label = null;
        if (pp.numId !== undefined && pp.numId !== 0) {
          const lb = numLabel(N, pp.numId, pp.ilvl || 0);
          if (lb) { label = lb; const lp = lb.lvl.p; pp = merge(S.defP, tP, pst.p, { left: lp.left, first: lp.first, hang: lp.hang }, dp.left !== undefined || dp.first !== undefined || dp.hang !== undefined ? dp : merge(dp, { left: undefined, first: undefined, hang: undefined })); if (dp.left === undefined && lp.left !== undefined) pp.left = lp.left; if (dp.first === undefined && lp.first !== undefined) { pp.first = lp.first; pp.hang = lp.hang; } }
        }
        const markR = merge(baseR, parseR(q(ppr, 'w:rPr')));
        const items = []; walkInline(p, baseR, pp, items);
        return { t: 'p', pp, baseR, markR, items, label, style: dp.pStyle || S.defPara, sectEnd: !!dp.sect, inTable: !!inTable };
      }
      function buildBlocks(container, inTable, tst) {
        const out = [];
        for (let c = container.firstChild; c; c = c.nextSibling) {
          const n = c.nodeName;
          if (n === 'w:p') out.push(buildPara(c, inTable, tst));
          else if (n === 'w:tbl') out.push(buildTable(c, inTable));
          else if (n === 'w:sdt') { const sc = q(c, 'w:sdtContent'); if (sc) out.push(...buildBlocks(sc, inTable, tst)); }
          else if (n === 'mc:AlternateContent') { const ch = q(c, 'mc:Choice'); if (ch) out.push(...buildBlocks(ch, inTable, tst)); }
        }
        return out;
      }
      function buildTable(t, inTable) {
        const tp = q(t, 'w:tblPr'); const sid = tp && q(tp, 'w:tblStyle') ? at(q(tp, 'w:tblStyle'), 'w:val') : S.defTable;
        const st = styleChain(S, sid, memo);
        const borders = merge(st.borders || {}, parseBorders(tp && q(tp, 'w:tblBorders')) || {});
        const mar = merge({ l: 5.4, r: 5.4, t: 0, b: 0 }, st.mar, parseMar(tp && q(tp, 'w:tblCellMar')));
        const grid = qa(q(t, 'w:tblGrid'), 'w:gridCol').map(g => (+at(g, 'w:w') || 0) / 20);
        const ind = tp && q(tp, 'w:tblInd') ? (+at(q(tp, 'w:tblInd'), 'w:w') || 0) / 20 : 0;
        const jc = tp && q(tp, 'w:jc') ? at(q(tp, 'w:jc'), 'w:val') : 'left';
        const rows = [];
        for (const tr of qa(t, 'w:tr')) {
          const trp = q(tr, 'w:trPr'); const hEl = trp && q(trp, 'w:trHeight');
          const row = { h: hEl ? (+at(hEl, 'w:val') || 0) / 20 : 0, hRule: hEl ? (at(hEl, 'w:hRule') || 'atLeast') : 'auto', cells: [], header: !!(trp && q(trp, 'w:tblHeader')) };
          let col = 0;
          const addCell = tc => {
            const tcp = q(tc, 'w:tcPr'); const span = tcp && q(tcp, 'w:gridSpan') ? (+at(q(tcp, 'w:gridSpan'), 'w:val') || 1) : 1;
            const vm = tcp && q(tcp, 'w:vMerge') ? (at(q(tcp, 'w:vMerge'), 'w:val') === 'restart' ? 'restart' : 'cont') : null;
            const shd = tcp && q(tcp, 'w:shd') ? at(q(tcp, 'w:shd'), 'w:fill') : null;
            const cm = tcp ? parseMar(q(tcp, 'w:tcMar')) : null;
            const va = tcp && q(tcp, 'w:vAlign') ? at(q(tcp, 'w:vAlign'), 'w:val') : 'top';
            row.cells.push({ col, span, vm, shade: shd && /^[0-9a-f]{6}$/i.test(shd) ? shd : null, borders: tcp ? parseBorders(q(tcp, 'w:tcBorders')) : null, mar: cm, valign: va, blocks: buildBlocks(tc, true, st) });
            col += span;
          };
          for (const tc of qa(tr, 'w:tc')) addCell(tc);
          rows.push(row);
        }
        return { t: 'tbl', grid, ind, jc, borders, mar, rows };
      }

      const blocks = buildBlocks(body, false);
      if (!blocks.length) throw new Error('No text or images were found in this document.');

      /* ----- images ----- */
      const doc = await PL.PDFDocument.create();
      doc.setTitle((opts.name || 'document').replace(/\.[^.]+$/, '')); doc.setProducer('AI PDF Editor'); doc.setCreator('AI PDF Editor');
      const fonts = {};
      const getFont = async (key, b, i) => { const k = key + (b ? 'B' : '') + (i ? 'I' : ''); if (fonts[k]) return fonts[k]; const SF = PL.StandardFonts; const nm = { Helvetica: [['Helvetica', 'HelveticaOblique'], ['HelveticaBold', 'HelveticaBoldOblique']], Times: [['TimesRoman', 'TimesRomanItalic'], ['TimesRomanBold', 'TimesRomanBoldItalic']], Courier: [['Courier', 'CourierOblique'], ['CourierBold', 'CourierBoldOblique']] }[key][b ? 1 : 0][i ? 1 : 0]; return (fonts[k] = await doc.embedFont(SF[nm])); };
      for (const key of ['Helvetica', 'Times', 'Courier']) for (const b of [0, 1]) for (const i of [0, 1]) await getFont(key, b, i);
      const imgCache = {}; let skipped = 0;
      const embedRid = async rid => {
        if (rid in imgCache) return imgCache[rid];
        let res = null;
        try {
          let tgt = rels[rid]; if (tgt) { tgt = tgt.replace(/^\//, ''); const path = tgt.startsWith('word/') ? tgt : 'word/' + tgt.replace(/^\.\//, ''); const f = zip.file(path); if (f) {
            let bytes = await f.async('uint8array'), info = imgInfo(bytes);
            if (!info) { const ext = (path.split('.').pop() || '').toLowerCase(); const mime = { gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext]; const c = mime ? await viaCanvas(bytes, mime, false, 4000) : null; if (c) { bytes = c.bytes; info = { type: c.type, w: c.w, h: c.h }; } }
            if (info) res = { img: info.type === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes) };
          } }
        } catch (e) { res = null; }
        if (!res) skipped++;
        imgCache[rid] = res; return res;
      };
      const prep = async list => { for (const b of list) { if (b.t === 'p') { for (const it of b.items) if (it.k === 'img') it.emb = await embedRid(it.rid); } else if (b.t === 'tbl') for (const r of b.rows) for (const c of r.cells) await prep(c.blocks); } };
      progress('Preparing pictures...'); await prep(blocks);
      if (skipped) notes.push(skipped + ' picture(s) in a format PDF cannot embed (e.g. EMF/WMF vector) were skipped.');
      if (stats.textbox) notes.push(stats.textbox + ' text box / shape(s) are not included (only normal text, pictures and tables are drawn).');

      /* ----- layout of one paragraph -> lines ----- */
      const colorOf = hex => { const h = hex || '000000'; return PL.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255); };
      const wStr = (font, t, size, hs) => strW(font, t, size) * hs;
      function pieceOf(text, r) {
        const fam = famOf(themeFont(r) || S.minor); const size0 = r.sz || 11; const size = size0 * ((r.sup || r.sub) ? 0.65 : 1);
        const font = fonts[fam.key + (r.b ? 'B' : '') + (r.i ? 'I' : '')];
        const t = sane(r.caps ? text.toUpperCase() : text);
        return { text: t, r, fam, size, font, w: wStr(font, t, size, fam.hs) };
      }
      function layoutPara(b, W, fullPage) {
        const pp = b.pp, left = pp.left || 0, right = pp.right || 0;
        const firstOff = b.label ? 0 : (pp.first || 0);
        const lineW = Math.max(20, W - left - right);
        const units = []; let cur = null; const flushW = () => { if (cur) { units.push(cur); cur = null; } };
        for (const it of b.items) {
          if (it.k === 't') {
            for (const part of it.text.split(/(\s+)/)) {
              if (part === '') continue;
              if (/^\s+$/.test(part)) { flushW(); const pc = pieceOf(' ', it.r); for (let i = 0; i < part.length; i++) units.push({ sp: true, p: pc, w: pc.w }); }
              else { if (!cur) cur = { word: true, pieces: [], w: 0 }; const pc = pieceOf(part, it.r); cur.pieces.push(pc); cur.w += pc.w; }
            }
          } else if (it.k === 'tab') { flushW(); units.push({ tab: true, r: it.r }); }
          else if (it.k === 'br') { flushW(); units.push({ br: true, r: it.r }); }
          else if (it.k === 'pb') { flushW(); units.push({ pb: true, r: it.r }); }
          else if (it.k === 'img') {
            flushW(); if (!it.emb) continue;
            let w = it.w, h = it.h;
            if (!b.inTable && opts.uniformImages !== false && w >= 0.97 * lineW && w <= lineW * 1.0 + 0.5) { const f = lineW / w; w = lineW; h *= f; }  // all nearly-full-width pictures get exactly the same width
            if (w > lineW) { const f = lineW / w; w = lineW; h *= f; }
            const maxH = fullPage ? TH - 4 : 1e9; if (h > maxH) { const f = maxH / h; h = maxH; w *= f; }
            units.push({ img: true, w, h, emb: it.emb, crop: it.crop });
          }
        }
        flushW();
        // split over-long words
        const flat = [];
        for (const u of units) {
          if (u.word && u.w > lineW) {
            let acc = { word: true, pieces: [], w: 0 };
            for (const pc of u.pieces) for (const ch of pc.text) { const cw = wStr(pc.font, ch, pc.size, pc.fam.hs); if (acc.pieces.length && acc.w + cw > lineW) { flat.push(acc); acc = { word: true, pieces: [], w: 0 }; } const lp = acc.pieces[acc.pieces.length - 1]; if (lp && lp.r === pc.r) { lp.text += ch; lp.w += cw; } else acc.pieces.push(Object.assign({}, pc, { text: ch, w: cw })); acc.w += cw; }
            flat.push(acc);
          } else flat.push(u);
        }
        const emptyP = pieceOf(' ', b.markR);
        const lines = []; let row = [], x = firstOff, lineStart = left + firstOff;
        const tabStops = (pp.tabs || []).map(t => t.pos).sort((a, b2) => a - b2);
        const stopAfter = xAbs => { for (const s of tabStops) if (s > xAbs + 0.01) return s; const step = 36; return (Math.floor((xAbs + 0.01) / step) + 1) * step; };
        function endLine(forced, pbAfter) {
          while (row.length && row[row.length - 1].sp) row.pop();
          let natH = 0, asc = 0, desc = 0, imgH = 0, hasText = false, nat = 0, nSp = 0;
          const items = []; let px = left + (lines.length ? 0 : firstOff);
          const startX = px;
          let seg = null;
          const closeSeg = () => { seg = null; };
          const addText = (pc, text) => {
            const key = pc.font.name + '|' + pc.size + '|' + (pc.r.color || '') + '|' + (pc.r.u ? 1 : 0) + (pc.r.s ? 1 : 0) + '|' + (pc.r.hl || '') + (pc.r.sup ? 's' : pc.r.sub ? 'b' : '');
            if (seg && seg.key === key && Math.abs(seg.x + seg.w - px) < 0.01) { seg.text += text; const w = wStr(pc.font, text, pc.size, pc.fam.hs); seg.w += w; px += w; }
            else { const w = wStr(pc.font, text, pc.size, pc.fam.hs); seg = { type: 'seg', key, text, font: pc.font, size: pc.size, hs: pc.fam.hs, color: pc.r.color, u: !!pc.r.u, s: !!pc.r.s, hl: pc.r.hl, rise: pc.r.sup ? pc.size * 0.55 : pc.r.sub ? -pc.size * 0.2 : 0, x: px, w, nsp: 0 }; items.push(seg); px += w; }
            for (const ch of text) if (ch === ' ') { seg.nsp++; nSp++; }
            const fm = pc.fam; natH = Math.max(natH, pc.size * fm.F); asc = Math.max(asc, pc.size * fm.A); desc = Math.max(desc, pc.size * fm.D); hasText = true;
          };
          for (const u of row) {
            if (u.word) for (const pc of u.pieces) addText(pc, pc.text);
            else if (u.sp) addText(u.p, ' ');
            else if (u.tab) { closeSeg(); const nx = Math.min(stopAfter(px), left + lineW + 0.001 > px ? Math.max(px, Math.min(stopAfter(px), left + lineW)) : px); px = Math.max(px, nx); }
            else if (u.img) { closeSeg(); items.push({ type: 'img', x: px, w: u.w, h: u.h, emb: u.emb, crop: u.crop }); px += u.w; imgH = Math.max(imgH, u.h); }
          }
          const nat0 = px - startX; nat = px - startX;
          if (!hasText) { const fm = emptyP.fam; desc = emptyP.size * fm.D; asc = emptyP.size * fm.A; natH = emptyP.size * fm.F; }
          let h;
          const pr = pp.rule || 'auto', pl = pp.line === undefined ? 240 : pp.line;
          const mult = pr === 'auto' ? pl / 240 : 1;
          let textH = pr === 'auto' ? natH * mult : pr === 'exact' ? pl / 20 : Math.max(natH, pl / 20);
          if (imgH) h = pr === 'exact' ? pl / 20 : Math.max(imgH + desc, hasText ? textH : 0);
          else h = textH;
          const baseOff = imgH ? h - desc : (h - (asc + desc)) / 2 + asc;
          lines.push({ items, h, base: baseOff, natW: nat, nSp, last: forced, pbAfter: !!pbAfter, startX: lines.length ? left : left + firstOff, width: lines.length ? lineW : lineW - firstOff });
          row = []; x = 0;
        }
        const lineLimit = () => lineW - (lines.length ? 0 : firstOff);
        const rowW = () => { let w = 0; for (const u of row) w += u.w || 0; return w; };
        let xcur = 0; const curX = () => rowW() + (lines.length ? 0 : firstOff);
        for (const u of flat) {
          if (u.br) { endLine(true); continue; }
          if (u.pb) { endLine(true, true); continue; }
          if (u.tab) {
            const absX = left + curX(); let nx = stopAfter(absX); if (nx > left + lineLimit() + (lines.length ? 0 : firstOff) && row.length) { /* tab beyond the line: wrap */ }
            const tw = Math.max(0, Math.min(nx, left + lineW + 0.01) - absX); u.w = tw; row.push(u); continue;
          }
          if (u.sp) { row.push(u); continue; }
          if (row.length && curX() + u.w > lineLimit() + 0.01) {
            // trailing spaces do not count
            while (row.length && row[row.length - 1].sp) row.pop();
            if (row.length && curX() + u.w > lineLimit() + 0.01) { endLine(false); } 
          }
          row.push(u);
        }
        const lastWasPb = flat.length && flat[flat.length - 1].pb;
        if (row.length || !lines.length || lastWasPb) endLine(true);
        // paragraph mark: spacing
        const dpb = pp.before === undefined ? 0 : pp.before, dpa = pp.after === undefined ? 0 : pp.after;
        return { t: 'p', b, lines, before: dpb, after: dpa, left, W, align: pp.jc || 'left', shd: pp.shd, label: b.label, ctx: !!pp.ctx, style: b.style, keepNext: !!pp.keepNext, keepLines: !!pp.keepLines, pbb: !!pp.pbb, widow: pp.widow !== false, sectEnd: b.sectEnd, markR: b.markR };
      }

      function layoutTable(b, W) {
        let grid = b.grid.slice();
        if (!grid.length) { const nc = Math.max(1, ...b.rows.map(r => r.cells.reduce((a, c) => a + c.span, 0))); grid = new Array(nc).fill(W / nc); }
        let tw = grid.reduce((a, x) => a + x, 0);
        const padL = b.mar.l;
        let x0 = b.ind - (compat < 15 ? padL : 0);
        if (b.jc === 'center') x0 = (W - tw) / 2; else if (b.jc === 'right') x0 = W - tw;
        const maxW = W + (compat < 15 ? padL : 0) - (x0 > 0 ? x0 : 0) + 2;
        if (tw > maxW + 1) { const f = maxW / tw; grid = grid.map(g => g * f); tw = maxW; }
        const cx = [0]; grid.forEach((g, i) => cx.push(cx[i] + g));
        const rows = [];
        b.rows.forEach((r, ri) => {
          const cells = r.cells.map(c => {
            const col = Math.min(c.col, grid.length - 1), end = Math.min(c.col + c.span, grid.length);
            const x = cx[col], w = cx[end] - cx[col];
            const m = merge(b.mar, c.mar);
            const inner = Math.max(10, w - m.l - m.r);
            const laid = c.vm === 'cont' ? [] : layoutBlocks(c.blocks, inner);
            const h = stackH(laid) + m.t + m.b;
            return { x, w, m, laid, h, c };
          });
          let h = Math.max(...cells.map(c => c.h), 0);
          if (r.hRule === 'exact') h = r.h; else h = Math.max(h, r.h, 4);
          rows.push({ h, cells, header: r.header, ri });
        });
        // vertical merges: the starting cell grows over the rows below
        rows.forEach((r, ri) => r.cells.forEach(cl => {
          if (cl.c.vm === 'restart') { let k = ri + 1, extra = 0; const col = cl.c.col; while (k < rows.length) { const nxt = rows[k].cells.find(z => z.c.col === col && z.c.vm === 'cont'); if (!nxt) break; extra += rows[k].h; k++; } cl.span_rows = k - ri; cl.extra = extra; if (cl.h > r.h + extra) { const add = cl.h - r.h - extra; r.h += add; if (k - 1 > ri) { /* give the surplus to the last merged row */ rows[k - 1].h += 0; } } }
        }));
        return { t: 'tbl', b, rows, x0, tw, borders: b.borders };
      }

      function layoutBlocks(list, W) { const out = []; for (const b of list) { if (b.t === 'p') out.push(layoutPara(b, W, false)); else out.push(layoutTable(b, W)); } return out; }
      const gapBetween = (a, b2) => { if (!a) return b2.t === 'p' ? b2.before : 0; const aft = a.t === 'p' ? a.after : 0, bef = b2.t === 'p' ? b2.before : 0; if (a.t === 'p' && b2.t === 'p' && a.ctx && b2.ctx && a.style === b2.style) return 0; return aft + bef; };
      const parH = p => p.lines.reduce((a, l) => a + l.h, 0);
      const tblH = t => t.rows.reduce((a, r) => a + r.h, 0);
      function stackH(laid) { let h = 0; laid.forEach((b, i) => { h += gapBetween(laid[i - 1], b) + (b.t === 'p' ? parH(b) : tblH(b)); }); return h; }

      /* ----- drawing ----- */
      let page = null;
      const PY = topY => PH - topY;
      function drawLine(L, p, x0, topY, W) {
        const base = PY(topY + L.base);
        let off = 0, extra = 0;
        if (p.align === 'center') off = Math.max(0, (L.width - L.natW) / 2);
        else if (p.align === 'right') off = Math.max(0, L.width - L.natW);
        else if (p.align === 'both' && !L.last && L.nSp > 0) { const e = (L.width - L.natW) / L.nSp; if (e > 0 && e < 12) extra = e; }
        let cum = 0;
        for (const it of L.items) {
          const x = x0 + it.x + off + cum;
          if (it.type === 'seg') {
            const w = it.w + it.nsp * extra, y = base + it.rise;
            if (it.hl) page.drawRectangle({ x, y: base - it.size * 0.22, width: w, height: it.size * 1.15, color: colorOf(it.hl) });
            if (it.text.trim() || it.u || it.s) {
              if (it.text.trim()) {
                const sq = it.hs !== 1, ws = extra > 0 && it.nsp;
                if (sq || ws) page.pushOperators(PL.pushGraphicsState());
                if (sq) page.pushOperators(PL.setCharacterSqueeze(it.hs * 100));
                if (ws) page.pushOperators(PL.setWordSpacing(extra));
                page.drawText(it.text, { x, y, size: it.size, font: it.font, color: colorOf(it.color) });
                if (sq || ws) page.pushOperators(PL.popGraphicsState());
              }
              const th = Math.max(0.4, it.size * 0.05);
              if (it.u) page.drawLine({ start: { x, y: y - it.size * 0.12 }, end: { x: x + w, y: y - it.size * 0.12 }, thickness: th, color: colorOf(it.color) });
              if (it.s) page.drawLine({ start: { x, y: y + it.size * 0.28 }, end: { x: x + w, y: y + it.size * 0.28 }, thickness: th, color: colorOf(it.color) });
            }
            cum += it.nsp * extra;
          } else if (it.type === 'img') {
            drawImg(it, x, base);
          }
        }
      }
      function drawImg(it, x, baseY) {
        const c = it.crop;
        if (!c) { page.drawImage(it.emb.img, { x, y: baseY, width: it.w, height: it.h }); return; }
        const fw = it.w / Math.max(0.05, 1 - c.l - c.r), fh = it.h / Math.max(0.05, 1 - c.t - c.b);
        page.pushOperators(PL.pushGraphicsState(), PL.rectangle(x, baseY, it.w, it.h), PL.clip(), PL.endPath());
        page.drawImage(it.emb.img, { x: x - c.l * fw, y: baseY - c.b * fh, width: fw, height: fh });
        page.pushOperators(PL.popGraphicsState());
      }
      function drawLabel(p, topY, x0, L0) {
        const lb = p.label; if (!lb || !lb.text) return;
        const r = merge(p.b.baseR, lb.lvl.r); const pc = pieceOf(lb.text, r); const hang = p.b.pp.hang || 0;
        const x = x0 + Math.max(0, p.left - hang) + (hang ? 0 : 0);
        const base = PY(topY + L0.base); page.drawText(pc.text, { x, y: base, size: pc.size, font: pc.font, color: colorOf(r.color) });
      }
      function drawStack(laid, x, topY) {
        let y = topY;
        laid.forEach((b, i) => {
          y += gapBetween(laid[i - 1], b) - (i === 0 ? b.t === 'p' ? 0 : 0 : 0);
          if (b.t === 'p') y = drawParaFull(b, x, y); else y = drawTable(b, x, y, false);
        });
        return y;
      }
      function drawParaFull(p, x, y) {
        if (p.shd) page.drawRectangle({ x: x + p.left, y: PY(y + parH(p)), width: p.W - p.left, height: parH(p), color: colorOf(p.shd) });
        p.lines.forEach((L, k) => { if (k === 0) drawLabel(p, y, x, L); drawLine(L, p, x, y, p.W); y += L.h; });
        return y;
      }
      function drawTable(T, x, topY, _) {
        let y = topY;
        for (const r of T.rows) { drawRow(T, r, x, y); y += r.h; }
        return y;
      }
      function drawRow(T, r, x, y) {
        const bd = T.borders || {};
        const nrows = T.rows.length;
        for (const cl of r.cells) {
          const cx = x + T.x0 + cl.x;
          let h = r.h; if (cl.c.vm === 'restart' && cl.extra) h = r.h + cl.extra;
          if (cl.c.vm === 'cont') { /* drawn by the restarting cell */ }
          if (cl.c.shade) page.drawRectangle({ x: cx, y: PY(y + h), width: cl.w, height: h, color: colorOf(cl.c.shade) });
          const own = cl.c.borders || {};
          const edge = (name, inside, isOuter) => { const o = own[name]; if (o) return o.none ? null : o; const t = bd[name] || (isOuter ? null : bd[inside]); if (!t || t.none) { return null; } return t; };
          const first = cl.c.col === 0, last = cl.c.col + cl.c.span >= (T.b.grid.length || cl.c.col + cl.c.span);
          const top = edge('top', 'insideH', r.ri === 0), bot = edge('bottom', 'insideH', r.ri === nrows - 1), lf = edge('left', 'insideV', first), rt = edge('right', 'insideV', last);
          const ln = (b2, x1, y1, x2, y2) => { if (b2 && cl.c.vm !== 'cont') page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: b2.w, color: colorOf(b2.color) }); };
          const yb = PY(y), ye = PY(y + h);
          ln(top, cx, yb, cx + cl.w, yb); ln(bot, cx, ye, cx + cl.w, ye); ln(lf, cx, yb, cx, ye); ln(rt, cx + cl.w, yb, cx + cl.w, ye);
          if (cl.c.vm !== 'cont') { let off = cl.m.t; if (cl.c.valign === 'center') off = Math.max(cl.m.t, (h - (cl.h - cl.m.t - cl.m.b)) / 2); else if (cl.c.valign === 'bottom') off = Math.max(cl.m.t, h - (cl.h - cl.m.b)); drawStack(cl.laid, cx + cl.m.l, y + off); }
        }
      }

      /* ----- flow into pages (Word-like: lines never split below 2, headings keep with next, no stretching) ----- */
      progress('Laying out pages...');
      const top0 = mt, bottomY = PH - mb;
      let y = top0, pageEmpty = true, afterHard = true, prev = null, pages = 0;
      const fresh = (hard) => { page = doc.addPage([PW, PH]); pages++; y = top0; pageEmpty = true; afterHard = !!hard; prev = null; };
      fresh(true);
      const laid = [];
      for (const b of blocks) laid.push(b.t === 'p' ? layoutPara(b, TW, true) : layoutTable(b, TW));
      for (let bi = 0; bi < laid.length; bi++) {
        const b = laid[bi], nb = laid[bi + 1];
        if (b.t === 'p') {
          if (b.pbb && !pageEmpty) fresh(true);
          let gap = gapBetween(prev, b);
          if (pageEmpty && !afterHard) gap = 0;
          if (pageEmpty && afterHard && prev === null) gap = b.before;
          const H = parH(b);
          if (b.keepNext && nb && !pageEmpty) {
            const nextFirst = nb.t === 'p' ? nb.lines[0].h : nb.rows[0].h;
            if (y + gap + H + gapBetween(b, nb) + nextFirst > bottomY + 0.01) { fresh(false); gap = 0; }
          }
          let i = 0, first = true;
          while (i < b.lines.length) {
            const g = first ? gap : 0; let avail = bottomY - y - g;
            let n = 0, h = 0; while (i + n < b.lines.length && h + b.lines[i + n].h <= avail + 0.01) { h += b.lines[i + n].h; n++; }
            // keep-lines: put the whole paragraph on the next page
            if (n < b.lines.length - i && b.keepLines && first && !pageEmpty) n = 0;
            else if (n < b.lines.length - i && b.widow && b.lines.length >= 4) {
              const rest = b.lines.length - i - n;
              if (first && n === 1 && !pageEmpty) n = 0;                       // orphan
              else if (rest === 1 && n >= 3) n -= 1;                          // widow
            } else if (n < b.lines.length - i && b.widow && first && n === 1 && b.lines.length === 2 && !pageEmpty) n = 0;
            if (n === 0) { if (!pageEmpty) { fresh(false); gap = 0; first = first; continue; } n = 1; }
            const yy = y + (first ? gap : 0);
            let ty = yy;
            if (b.shd) { let hh = 0; for (let k = 0; k < n; k++) hh += b.lines[i + k].h; page.drawRectangle({ x: ml + b.left, y: PY(ty + hh), width: TW - b.left, height: hh, color: colorOf(b.shd) }); }
            let breakNow = false;
            for (let k = 0; k < n; k++) { const L = b.lines[i + k]; if (i + k === 0) drawLabel(b, ty, ml, L); drawLine(L, b, ml, ty, TW); ty += L.h; if (L.pbAfter) { breakNow = true; n = k + 1; break; } }
            y = ty; pageEmpty = false; i += n; first = false;
            if (breakNow) { if (i < b.lines.length || bi < laid.length - 1 || true) { if (i < b.lines.length || bi < laid.length - 1) { fresh(true); } } if (i >= b.lines.length) break; else continue; }
            if (i < b.lines.length) { fresh(false); }
          }
          prev = b.lines.length && b.lines[b.lines.length - 1].pbAfter ? null : b;
          if (b.sectEnd && bi < laid.length - 1) { fresh(true); }
        } else {
          let gap = gapBetween(prev, b); if (pageEmpty && !afterHard) gap = 0;
          const th = tblH(b);
          if (!pageEmpty && th <= TH * 0.4 && y + gap + th > bottomY + 0.01) { fresh(false); gap = 0; }
          let first = true;
          for (let ri = 0; ri < b.rows.length; ri++) {
            const r = b.rows[ri]; const g = first ? gap : 0; let rh = r.h; if (r.cells.some(c => c.extra)) rh += Math.max(...r.cells.map(c => c.extra || 0));
            if (y + g + rh > bottomY + 0.01 && !pageEmpty) { fresh(false); const hdr = b.rows.filter(z => z.header && z !== r); if (hdr.length && !r.header) for (const hr of hdr) { drawRow(b, hr, ml, y); y += hr.h; pageEmpty = false; } }
            const yy = y + (first && !pageEmpty ? g : 0);
            drawRow(b, r, ml, yy); y = yy + r.h; pageEmpty = false; first = false;
          }
          prev = Object.assign({ t: 'p', after: 0, before: 0 }, {});
        }
      }
      if (opts.pageNumbers) {
        const nf = fonts.Helvetica; const all = doc.getPages(); all.forEach((pg, i) => { const t = (i + 1) + ' / ' + all.length; pg.drawText(t, { x: PW / 2 - strW(nf, t, 9) / 2, y: Math.max(10, mb * 0.4), size: 9, font: nf, color: PL.rgb(0.45, 0.45, 0.5) }); });
      }
      const bytes = await doc.save();
      return { bytes, pages, exact: true, page: { w: PW, h: PH }, notes, scale: 1, fontPt: null, blankPt: 0 };
    }
    return { convert };
  })();

  const api = { convert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocxToPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
