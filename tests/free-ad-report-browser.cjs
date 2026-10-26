const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), http = require('node:http'), assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const bootstrap = `<script type="module">
import {mountBusinessReport} from './free-ad-report.js';
document.getElementById('adminArea').style.display='block';
document.getElementById('loginBox').style.display='none';
window.calls=[];
window.ui=mountBusinessReport({call:async data=>{
 calls.push(data); if(data.action==='list')return {items:Array.from({length:7},(_,i)=>({id:'ad'+i,title:['글루스킨','퍼즈일레븐','세상 사는 부동산','휴베이스볼파크','따뜻한 보일러','티금융서비스','예가컴퍼니'][i],status:i===6?'paused':'published'}))};
 if(data.action==='report')return {rows:[{creativeId:'ad0',impressions:509,clicks:15,viewableClicks:11}]};
 throw Error('Unexpected mutation');
}});await ui.setUser(true);</script>`;
const server = http.createServer((req,res)=>{
 try {
  const file=req.url==='/'?'admin.html':req.url.slice(1);
  if(!['admin.html','free-ad-report.js'].includes(file)){res.statusCode=404;res.end();return;}
  let data=fs.readFileSync(root+'/'+file,'utf8');
  if(file.endsWith('.html'))data=data.replace(/<script type="module">[\s\S]*?<\/script>/,bootstrap);
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(data);
 }catch(_){res.statusCode=500;res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelectorAll('#businessRows tr').length===7);
  assert.equal(await page.locator('#businessImpressions').innerText(),'509');
  assert.equal(await page.locator('#businessClicks').innerText(),'15');
  assert.equal(await page.locator('#businessViewableClicks').innerText(),'11');
  assert.equal(await page.locator('#businessCtr').innerText(),'2.16%');
  assert.equal(await page.locator('#discoveryReport').isVisible(),false);
  assert((await page.locator('#businessRows tr').last().innerText()).includes('중지'));
  await page.locator('#businessDays').selectOption('1');
  await page.waitForFunction(()=>calls.some(c=>c.action==='report'&&c.days===1));
  await page.waitForFunction(()=>!document.getElementById('businessRefresh').disabled);
  const out=process.env.PREVIEW_DIR || '/tmp';
  await page.screenshot({path:out+'/ad-report-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:out+'/ad-report-mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.evaluate(()=>calls.every(c=>['list','report'].includes(c.action))));
  await page.evaluate(()=>ui.setUser(false));
  assert.equal(await page.locator('#businessRows tr').count(),0);
  assert.equal(await page.locator('#businessCtr').innerText(),'—');
  assert.deepEqual(errors,[]);
  console.log('PASS: seven advertisers, zero rows, CTR numerator, periods, separate discovery, mobile, logout; read-only calls');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
