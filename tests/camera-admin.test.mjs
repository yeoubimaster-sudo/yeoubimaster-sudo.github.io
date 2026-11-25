import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../camera-admin-core.js',import.meta.url),'utf8');
const {mountCameraAdmin,safeCameraUrl}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.events=new Map();this.dataset={};this.attributes={};this._text='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set innerHTML(_){throw Error('Unsafe HTML write');}
  append(...children){for(const c of children)c.parent=this;this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,f){this.events.set(k,f);}async click(){if(!this.disabled)return this.events.get('click')?.();}
  querySelectorAll(selector){const tags=selector.toUpperCase().split(',');return this.children.flatMap(c=>[...(tags.includes(c.tagName)?[c]:[]),...c.querySelectorAll(selector)]);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}focus(){}pause(){}load(){}
}
class Document {constructor(){this.nodes=new Map();}getElementById(id){if(!this.nodes.has(id))this.nodes.set(id,new Element());return this.nodes.get(id);}createElement(tag){return new Element(tag);}createTextNode(text){const e=new Element('text');e.textContent=text;return e;}}
const admin={uid:'admin',emailVerified:true,email:'yeoubi.master@gmail.com'};
const row=()=>({id:'12345678-1234-1234-1234-123456789abc',version:1,status:'pending',published:false,draft:{title:'<img src=x onerror=alert(1)>',providerName:'해변 캠핑',website:'https://example.com',description:'현재 바다',lat:35,lon:129,media:{url:'https://www.youtube.com/watch?v=abcDEF012_-'}}});
function setup(override){const document=new Document(),calls=[];let current=row();
  document.getElementById('workspace').append(...['items','detail','reload','more'].map(x=>document.getElementById(x)));
  const ui=mountCameraAdmin({document,login:async()=>{},logout:async()=>{},call:async data=>{calls.push(data);if(override)return override(data);
    if(data.op==='list')return {enabled:true,items:[current],cursor:null};
    if(data.op==='review')current={...current,version:2,status:'approved',published:true};
    if(data.op==='stop')current={...current,version:3,status:'stopped',published:false};
    if(data.op==='publish_benefit')current={...current,benefit:{status:'published',startAtMs:Date.now(),endAtMs:Date.now()+864000000}};
    return current;}});
  const buttons=()=>document.getElementById('workspace').querySelectorAll('button');
  const button=text=>buttons().find(b=>b.textContent===text);
  return {document,calls,ui,button};}
test('camera links block script, credentials and nonpublic media',()=>{for(const s of ['javascript:alert(1)','https://u:p@example.com/a.m3u8','https://127.0.0.1/a.m3u8','https://x.local/a.m3u8','https://example.com/a.m3u8?token=x','https://evil.com/watch?v=abcDEF012_-'])assert.equal(safeCameraUrl(s,true),null);assert(safeCameraUrl('https://example.com/a.m3u8',true));});
test('unverified and unrelated users never load applications',async()=>{const h=setup();await h.ui.setUser({...admin,emailVerified:false});await h.ui.setUser({...admin,email:'other@example.com'});assert.equal(h.calls.length,0);assert.equal(h.document.getElementById('workspace').hidden,true);});
test('review requires all checks; safe text remains text; versioned approve, benefit and stop stay connected',async()=>{
  const h=setup();await h.ui.setUser(admin);await h.document.getElementById('items').children[0].click();
  assert(h.document.getElementById('detail').textContent.includes('<img src=x'));assert.equal(h.document.getElementById('detail').querySelectorAll('img').length,0);
  await h.button('승인·지도 공개').click();assert.equal(h.calls.length,1);
  for(const input of h.document.getElementById('detail').querySelectorAll('input'))if(input.dataset.check)input.checked=true;
  await h.button('승인·지도 공개').click();assert.equal(h.calls.at(-1).version,1);assert.equal(h.calls.at(-1).expectedUid,'admin');
  await h.button('10일 배너 게시').click();assert.equal(h.calls.at(-1).op,'publish_benefit');assert.equal(h.button('10일 배너 게시'),undefined);
  h.document.getElementById('detail').querySelectorAll('textarea')[0].value='제공자 요청';await h.button('공개 중지').click();assert.equal(h.calls.at(-1).op,'stop');assert.equal(h.button('공개 중지').disabled,true);
});
test('logout cancels an in-flight list and discards private rows',async()=>{
  let resolve;const h=setup(()=>new Promise(r=>resolve=r));const pending=h.ui.setUser(admin);
  await h.ui.setUser(null);resolve({enabled:true,items:[row()]});await pending;
  assert.equal(h.document.getElementById('items').children.length,0);assert.equal(h.document.getElementById('workspace').hidden,true);
});
test('review failure leaves current row intact and restores buttons for refresh',async()=>{
  const h=setup(async data=>{if(data.op==='list')return {enabled:true,items:[row()]};throw Error('신청 내용이 바뀌었습니다. 새로 불러오세요.');});
  await h.ui.setUser(admin);await h.document.getElementById('items').children[0].click();
  h.document.getElementById('detail').querySelectorAll('textarea')[0].value='수정해 주세요.';await h.button('수정 요청').click();
  assert(h.document.getElementById('message').textContent.includes('바뀌었습니다'));assert.equal(h.button('수정 요청').disabled,false);
});

test('website HTTP stays clickable while camera media remains HTTPS only',()=>{
  assert.equal(safeCameraUrl('http://example.com/book'),'http://example.com/book');
  assert.equal(safeCameraUrl('http://example.com/camera.m3u8',true),null);
});
test('YouTube review links directly to the official watch page without an embed',async()=>{
  const h=setup();await h.ui.setUser(admin);await h.document.getElementById('items').children[0].click();
  const detail=h.document.getElementById('detail');
  const video=detail.querySelectorAll('a').find(a=>a.textContent==='YouTube에서 영상 확인');
  assert.equal(video.href,row().draft.media.url);assert.equal(video.rel,'noopener noreferrer');
  assert.equal(detail.querySelectorAll('iframe').length,0);
  assert.equal(h.button('신청 영상 재생'),undefined);
});
