// Run from the project folder:  node apply-mobile.mjs
// Adds the mobile layer to public/index.html (safe to run twice; makes index.html.bak first).
import fs from 'fs';

const file = 'public/index.html';
for (const f of [file, 'public/mobile.css', 'public/mobile.js']) {
  if (!fs.existsSync(f)) { console.error('Missing ' + f + '. Run this from the project folder after copying the public/ files in.'); process.exit(1); }
}
const orig = fs.readFileSync(file, 'utf8');
let s = orig;
const report = [];

// 1. viewport tag (notch support + keyboard resizes the page)
const vpNew = '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">';
if (s.includes(vpNew)) report.push('viewport: already done');
else if (/<meta name="viewport" content="[^"]*">/.test(s)) { s = s.replace(/<meta name="viewport" content="[^"]*">/, vpNew); report.push('viewport: updated'); }
else report.push('viewport: NOT FOUND (skipped; mobile.js sets it at runtime anyway)');

// 2. load mobile.js
if (s.includes('src="mobile.js"')) report.push('mobile.js tag: already done');
else if (s.includes('</body>')) { s = s.replace('</body>', '<script src="mobile.js"></script></body>'); report.push('mobile.js tag: added'); }
else { console.error('No </body> found in index.html, cannot continue.'); process.exit(1); }

// 3. sharper page canvases on high-DPI screens (no effect on desktop)
const canvasRe = /const v=pg\.getViewport\(\{scale:zoom\}\),c=document\.createElement\('canvas'\);c\.width=v\.width;c\.height=v\.height;div\.append\(c\);(\s*)await pg\.render\(\{canvasContext:c\.getContext\('2d'\),viewport:v\}\)\.promise;/;
if (s.includes('window.__pdfQuality')) report.push('sharp pages: already done');
else if (canvasRe.test(s)) {
  s = s.replace(canvasRe, (_, ws) =>
    "const v=pg.getViewport({scale:zoom}),q=window.__pdfQuality?window.__pdfQuality(v):1,v2=q>1?pg.getViewport({scale:zoom*q}):v,c=document.createElement('canvas');c.width=v2.width;c.height=v2.height;if(q>1){c.style.width=v.width+'px';c.style.height=v.height+'px'}div.append(c);" +
    ws + "await pg.render({canvasContext:c.getContext('2d'),viewport:v2}).promise;");
  report.push('sharp pages: patched');
} else report.push('sharp pages: pattern not found (skipped; everything else still works, pages may look a little soft on phones)');

if (s !== orig) {
  fs.writeFileSync('index.html.bak', orig);
  fs.writeFileSync(file, s);
  if (fs.existsSync('.gitignore') && !fs.readFileSync('.gitignore', 'utf8').includes('*.bak')) fs.appendFileSync('.gitignore', '\n*.bak\n');
}
console.log(report.join('\n'));
console.log(s !== orig ? '\nDone. Backup saved as index.html.bak' : '\nNothing to change.');
