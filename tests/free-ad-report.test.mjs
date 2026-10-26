import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../free-ad-report.js',import.meta.url),'utf8');
const {businessReport,businessCtr,mountBusinessReport}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Element {
 constructor(){this.children=[];this.textContent='';this.hidden=false;this.disabled=false;this.value='7';this.events=new Map();}
 replaceChildren(){this.children=[];this.textContent='';}append(v){this.children.push(v);}addEventListener(k,f){this.events.set(k,f);}
}
class Root {constructor(){this.nodes=new Map();}getElementById(id){if(!this.nodes.has(id))this.nodes.set(id,new Element());return this.nodes.get(id);}createElement(){return new Element();}}
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};};
const inventory={items:[{id:'a',title:'현재 이름',status:'published'},{id:'b',title:'미노출 업체',status:'paused'}]};
const report={days:7,rows:[{creativeId:'a',title:'이전 이름',impressions:10,clicks:3,viewableClicks:2}]};
test('stable ID aggregates days, uses current name and includes zero-exposure campaigns',()=>{
 const rows=businessReport(inventory.items,[...report.rows,{creativeId:'a',impressions:5,clicks:1,viewableClicks:1}]);
 assert.equal(rows.length,2);assert.equal(rows[0].title,'현재 이름');assert.equal(rows[0].impressions,15);assert.equal(businessCtr(rows[0]),'20.00%');
 assert.equal(rows[1].impressions,0);assert.equal(rows[1].status,'중지');assert.equal(businessCtr(rows[1]),'—');
});
test('malformed numbers cannot poison totals and historical IDs remain separate',()=>{
 const rows=businessReport(inventory.items,[{creativeId:'a',impressions:-1,clicks:NaN,viewableClicks:'7'}, {creativeId:'old',title:'지난 업체',impressions:1,clicks:0,viewableClicks:0}]);
 assert.equal(rows[0].impressions,0);assert.equal(rows[0].viewableClicks,0);assert.equal(rows[2].status,'이전 기록');
});
test('administrator summary is readonly and logout removes pending/loaded data',async()=>{
 const root=new Root(), wait=pending(),calls=[];
 const ui=mountBusinessReport({root,call:async data=>{calls.push(data.action);return data.action==='list'?inventory:wait.promise;}});
 await ui.load();assert.equal(calls.length,0);
 const load=ui.setUser(true);await ui.setUser(false);wait.resolve(report);await load;
 assert.equal(root.getElementById('businessRows').children.length,0);assert.equal(root.getElementById('businessImpressions').textContent,'—');
 assert.deepEqual(calls,['list','report']);
});
test('latest period wins and failed refresh clears previous totals',async()=>{
 const root=new Root(), old=pending();let mode='slow';
 const ui=mountBusinessReport({root,call:async data=>data.action==='list'?inventory:mode==='slow'?old.promise:mode==='fail'?Promise.reject(Error()):report});
 const first=ui.setUser(true);mode='fast';root.getElementById('businessDays').value='1';await ui.load();
 old.resolve({rows:[{creativeId:'a',impressions:999}]});await first;
 assert.equal(root.getElementById('businessImpressions').textContent,'10');
 assert.equal(root.getElementById('businessRows').children.length,2);
 mode='fail';await ui.load();assert.equal(root.getElementById('businessImpressions').textContent,'—');
 assert.equal(root.getElementById('businessRows').children.length,0);
});
test('untrusted advertiser text is assigned as text, not HTML',async()=>{
 const root=new Root();const ui=mountBusinessReport({root,call:async data=>data.action==='list'?{items:[{id:'a',title:'<img onerror=bad()>',status:'draft'}]}:report});
 await ui.setUser(true);assert.equal(root.getElementById('businessRows').children[0].children[0].textContent,'<img onerror=bad()>');
});
