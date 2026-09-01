/* Pixel-parity: does the Astro route render the same picture as the
   standalone version-H build it was ported from?

     node design/version-h/build/parity.js                  # all pairs
     node design/version-h/build/parity.js coming-soon      # one pair

   The requirement this exists to prove is "100% identical, content and
   styling". A screenshot comparison is the only honest way to check that:
   the HTML necessarily differs (Astro adds its own attributes, the CSS
   arrives as one bundled sheet rather than six links) while the rendered
   page must not.

   Both sides are captured under `reducedMotion: 'reduce'`, which is what
   makes the comparison deterministic rather than a race: it removes the
   preloader, lands every [data-r] reveal in its final state, and freezes
   the drift and contour animations. Applied to both sides equally, so it
   hides no difference that a visitor could see — it only removes the
   clock. Fonts are awaited explicitly for the same reason.

   No image library: the two PNGs are decoded and differenced by the
   browser that took them, on a canvas.

   Requires both servers up:
     pnpm dev --port 4321
     python3 -m http.server 4319 --directory design/version-h/dist   (+ /img from public/)
*/
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VH = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(VH));
const DIST = path.join(VH, 'dist');
const ROOTS = [DIST, path.join(REPO, 'public')];
const OUT = path.join(DIST, '_parity');
const ASTRO = process.env.ASTRO_URL || 'http://localhost:4321';

/* the pairs that must match, and the viewports they must match at */
const PAIRS = [
  { name: 'coming-soon', astro: '/coming-soon', built: '/soon/' },
];
const VIEWPORTS = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]];

/* the same two-root static server smoke.js uses */
const MIME = { '.html': 'text/html', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const srv = http.createServer((rq, rs) => {
  let f = decodeURIComponent(rq.url.split('?')[0]);
  if (f.endsWith('/')) f += 'index.html';
  let abs = null;
  for (const root of ROOTS) {
    const cand = path.join(root, path.normalize(f));
    if (cand.startsWith(root) && fs.existsSync(cand) && !fs.statSync(cand).isDirectory()) { abs = cand; break; }
  }
  if (!abs) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(rs);
});

async function shoot(browser, url, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
  const buf = await p.screenshot({ fullPage: true });
  await ctx.close();
  return { buf, errs };
}

/* decode + difference both PNGs on a canvas, in the browser */
async function diff(browser, a, b) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const res = await p.evaluate(async ([da, db]) => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [ia, ib] = await Promise.all([load(da), load(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }
    const px = (img) => {
      const c = new OffscreenCanvas(img.width, img.height);
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, img.width, img.height).data;
    };
    const A = px(ia), B = px(ib);
    let differing = 0, maxDelta = 0;
    const out = new Uint8ClampedArray(A.length);
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > maxDelta) maxDelta = d;
      if (d > 2) {                       /* >2/255 — below that is AA noise */
        differing++;
        out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
      } else {
        out[i] = A[i]; out[i + 1] = A[i + 1]; out[i + 2] = A[i + 2]; out[i + 3] = 60;
      }
    }
    const c = new OffscreenCanvas(ia.width, ia.height);
    c.getContext('2d').putImageData(new ImageData(out, ia.width, ia.height), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return { total: A.length / 4, differing, maxDelta, pct: (differing / (A.length / 4)) * 100, diffPng: b64 };
  }, ['data:image/png;base64,' + a.toString('base64'), 'data:image/png;base64,' + b.toString('base64')]);
  await ctx.close();
  return res;
}

const only = process.argv[2];
const pairs = only ? PAIRS.filter(p => p.name === only) : PAIRS;
if (!pairs.length) { console.error('no such pair: ' + only); process.exit(2); }

fs.mkdirSync(OUT, { recursive: true });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BUILT = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch();
let fail = 0;

for (const pair of pairs) {
  for (const [prof, vp] of VIEWPORTS) {
    const a = await shoot(browser, ASTRO + pair.astro, vp);
    const b = await shoot(browser, BUILT + pair.built, vp);
    const d = await diff(browser, a.buf, b.buf);
    const label = `${pair.name} · ${prof}`.padEnd(24);
    if (d.sizeMismatch) {
      fail++; console.log('  ✗ ' + label + 'SIZE MISMATCH ' + d.sizeMismatch);
      continue;
    }
    const ok = d.differing === 0 && !a.errs.length && !b.errs.length;
    if (!ok) fail++;
    console.log((ok ? '  ✓ ' : '  ✗ ') + label +
      `${d.differing}/${d.total} px differ (${d.pct.toFixed(4)}%), max channel Δ ${d.maxDelta}` +
      (a.errs.length ? '  ASTRO ERR ' + a.errs[0] : '') +
      (b.errs.length ? '  BUILT ERR ' + b.errs[0] : ''));
    if (!ok) {
      const f = path.join(OUT, `${pair.name}-${prof}`);
      fs.writeFileSync(f + '-astro.png', a.buf);
      fs.writeFileSync(f + '-built.png', b.buf);
      fs.writeFileSync(f + '-diff.png', Buffer.from(d.diffPng.split(',')[1], 'base64'));
      console.log('      wrote ' + path.relative(REPO, f) + '-{astro,built,diff}.png');
    }
  }
}

console.log(fail ? `\n${fail} comparison(s) differ` : '\nastro output is pixel-identical to the standalone build');
await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
