import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','..');
const PORT=8166; const BASE=`http://localhost:${PORT}`;
function cp(){const c=path.join(os.homedir(),'.cache','ms-playwright');for(const d of fs.readdirSync(c).filter(x=>x.startsWith('chromium-'))){const p=path.join(c,d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}
const s=spawn(process.execPath,['server.mjs','--port',String(PORT),'--no-open'],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
for(let i=0;i<80;i++){try{if((await fetch(BASE+'/index.html')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
const b=await chromium.launch({headless:true,executablePath:cp()});
const p=await b.newPage({viewport:{width:1200,height:800}});
p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('CONSOLE',m.type(),m.text().slice(0,500));});
p.on('pageerror',e=>console.log('PAGEERROR',String(e.stack).slice(0,900)));
await p.goto(BASE+'/',{waitUntil:'load'});
await p.waitForTimeout(2500);
console.log('menu', await p.evaluate(()=>({menu:!!document.querySelector('#menu:not(.hidden)'), hm:!!window.HM, nature:!!window.HM?.nature, gfx:!!window.HM?.gfx})));
await p.evaluate(()=>{const r=HM.gfx.renderer; const o=r.render.bind(r); r.render=(...a)=>{try{return o(...a)}catch(e){console.error('RENDERSTACK '+e.stack);throw e;}}; const c=HM.gfx.composer; if(c){const oo=c.render.bind(c);c.render=(...a)=>{try{return oo(...a)}catch(e){console.error('COMPOSERSTACK '+e.stack);throw e;}};}});
await p.evaluate(()=>localStorage.clear());
await p.reload({waitUntil:'load'}); await p.waitForTimeout(1000);
await p.evaluate(()=>{const r=HM.gfx.renderer; const o=r.render.bind(r); r.render=(...a)=>{try{return o(...a)}catch(e){console.error('RENDERSTACK '+e.stack);throw e;}}; const c=HM.gfx.composer; if(c){const oo=c.render.bind(c);c.render=(...a)=>{try{return oo(...a)}catch(e){console.error('COMPOSERSTACK '+e.stack);throw e;}};}});
await p.click('[data-action="menu-new"]'); await p.waitForTimeout(500);
await p.click('[data-action="ng-start"]');
for(let i=0;i<30;i++){await p.waitForTimeout(2000);const st=await p.evaluate(()=>({inGame:!!window.HM?.main?.inGame, loading:!!window.HM?.main?.loading, step:document.querySelector('#load-step')?.textContent, err:document.querySelector('#load-error')?.textContent, boot:document.querySelector('#boot-error')?.textContent}));console.log(i,st);if(st.inGame||st.err||st.boot)break;}
await b.close(); s.kill();
