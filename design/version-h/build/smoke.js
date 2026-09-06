/* Render every built version-H page at 1440 and 390 and fail on anything
   that means the page is broken rather than merely different.

     python3 design/version-h/build/build-page.py html/coming-soon.html design/version-h/dist/soon/
     node design/version-h/build/smoke.js

   ── PORTED FOR THE curevanails REPO ───────────────────────────────────
   Three edits, all mechanical; every assertion below is the upstream one.

     1 · ESM, not CommonJS. This package is `"type": "module"`, so a .js
         file cannot `require()`. Same imports, same order.
     2 · chromium comes from `@playwright/test`, which is this repo's own
         devDependency, rather than a bare `playwright` that only resolved
         out of a home-directory node_modules on one machine.
     3 · Two document roots instead of one. Built pages reference their
         photography as `../img/…`, i.e. `/img/…` from the server root;
         upstream that was one `dist/public` tree holding both. Here the
         pages are generated into design/version-h/dist/ and the 28 assets
         live at public/img/, which Astro serves at /img/ — so the server
         tries the build output first and public/ second, which is exactly
         what the deployed site does.
   ─────────────────────────────────────────────────────────────────────── */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VH = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(VH));
const DIST = path.join(VH, 'dist');
const ROOTS = [DIST, path.join(REPO, 'public')];
const OUT = process.env.SMOKE_OUT || path.join(DIST, '_screens');
const MIME={'.html':'text/html','.webp':'image/webp','.svg':'image/svg+xml'};
const srv=http.createServer((rq,rs)=>{let f=decodeURIComponent(rq.url.split('?')[0]);if(f.endsWith('/'))f+='index.html';
 let abs=null;
 for (const root of ROOTS) {
  const cand=path.join(root,path.normalize(f));
  if(cand.startsWith(root)&&fs.existsSync(cand)&&!fs.statSync(cand).isDirectory()){abs=cand;break;}
 }
 if(!abs){rs.writeHead(404);return rs.end();}
 rs.writeHead(200,{'content-type':MIME[path.extname(abs)]||'application/octet-stream'});fs.createReadStream(abs).pipe(rs);});
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+srv.address().port;
 const b=await chromium.launch();
 let fail=0;
 for (const [name,url] of [['coming-soon','/soon/'],['careers','/careers/'],['skeleton','/_skeleton/']]) {
  for (const [prof,vp] of [['desktop',{width:1440,height:900}],['phone',{width:390,height:844}]]) {
   const p=await(await b.newContext({viewport:vp,deviceScaleFactor:1})).newPage();
   const errs=[],bad=[];
   p.on('pageerror',e=>errs.push(e.message));
   p.on('response',r=>{if(r.status()>=400) bad.push(r.status()+' '+r.url().split('/').pop());});
   await p.goto(base+url,{waitUntil:'load'}); await p.waitForTimeout(3600);
   await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){
     scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,70));}
     scrollTo({top:0,behavior:'instant'});await new Promise(r=>setTimeout(r,400));});
   const r=await p.evaluate(()=>({
     hscroll:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
     preGone:!document.getElementById('pre'),
     reveals:document.querySelectorAll('[data-r]:not(.in)').length,
     /* laid out only, and never the closed menu panel: it is clip-path'd
        shut, so its photograph is legitimately deferred. The landing
        page's own suite excludes it for the same reason. */
     imgsBroken:[...document.images].filter(i=>i.getClientRects().length
        && !i.closest('#menuPanel') && (!i.complete||i.naturalWidth===0)).length,
     tokenOK:/^[0-9.]+ [0-9.]+% [0-9.]+%$/.test(getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()),
     btn:!!document.querySelector('.btn'),
     nav:!!document.getElementById('nav')}));
   const ok = !errs.length && !bad.length && !r.hscroll && r.preGone &&
              r.reveals===0 && r.imgsBroken===0 && r.tokenOK && r.nav;
   if(!ok) fail++;
   console.log((ok?'  ✓ ':'  ✗ ')+(name+' · '+prof).padEnd(24)+JSON.stringify(r)+
     (errs.length?'  ERR '+errs[0]:'')+(bad.length?'  HTTP '+bad[0]:''));
   if(prof==='desktop') await p.screenshot({path:OUT+'/pg-'+name+'.png'});
   await p.close();
  }
 }
 console.log(fail?('\n'+fail+' profile(s) failed'):'\nall pages render clean');
 await b.close(); srv.close(); process.exit(fail?1:0);})();
