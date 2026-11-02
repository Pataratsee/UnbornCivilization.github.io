import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const ROOT='/home/christian/Desktop/LittleProjects/hollowmere';
const PORT=8162; const BASE=`http://localhost:${PORT}`;
function cp(){const c=path.join(os.homedir(),'.cache','ms-playwright');for(const d of fs.readdirSync(c).filter(x=>x.startsWith('chromium-'))){const p=path.join(c,d,'chrome-linux','chrome');if(fs.existsSync(p))return p;}}
const s=spawn(process.execPath,['server.mjs','--port',String(PORT),'--no-open'],{cwd:ROOT,stdio:['ignore','pipe','pipe']});
for(let i=0;i<60;i++){try{if((await fetch(BASE+'/models.html')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
const b=await chromium.launch({headless:true,executablePath:cp()});
const p=await b.newPage();
p.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
p.on('pageerror',e=>console.log('PAGEERROR',e.stack));
await p.goto(BASE+'/models.html',{waitUntil:'load'});
await p.waitForTimeout(500);
console.log(await p.evaluate(()=>({nature: !!window.HM.nature, keys: Object.keys(window.HM.nature||{}), gfx: !!window.HM.gfx, viewer: !!window.HM.viewer})));
await b.close(); s.kill();
