const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright-core');
const WS='C:/Users/Administrator/WorkBuddy/2026-09-16-10-33-55';
const PORT=8811;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
fs.readFile(path.normalize(path.join(WS,p)),(e,d)=>{if(e){res.writeHead(404);return res.end();}
res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});res.end(d);});}).listen(PORT,run);
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
function mockShare(){window.__shares=[];
Object.defineProperty(navigator,'share',{value:o=>{window.__shares.push(1);return Promise.resolve();},configurable:true});
Object.defineProperty(navigator,'canShare',{value:o=>!!(o&&o.files&&o.files.length),configurable:true});}
function run(){(async()=>{
const b=await chromium.launch({executablePath:'C:/Users/Administrator/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const ctx=await b.newContext({userAgent:UA,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
await ctx.addInitScript(mockShare);
const p=await ctx.newPage();
const IMG=path.join(WS,'_dev/out/csp-probe.png');
await p.goto('http://localhost:'+PORT+'/localphototool/compress/',{waitUntil:'load'});
await p.setInputFiles('#fileInput',[{name:'first.png',mimeType:'image/png',buffer:fs.readFileSync(IMG)},{name:'second.png',mimeType:'image/png',buffer:fs.readFileSync(IMG)}]);
await p.waitForFunction(()=>document.querySelectorAll('.result [data-act="download"]').length>=2,{timeout:180000});
await p.waitForTimeout(800);
await p.evaluate(()=>document.querySelector('#actionBar').scrollIntoView({block:'end'}));
await p.waitForTimeout(300);
await p.screenshot({path:path.join(WS,'_dev/out/ios-bar.png')});
await p.click('#barDownload');
await p.waitForTimeout(500);
await p.screenshot({path:path.join(WS,'_dev/out/ios-guide.png')});
console.log('screenshots done');
await b.close();srv.close();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});}
