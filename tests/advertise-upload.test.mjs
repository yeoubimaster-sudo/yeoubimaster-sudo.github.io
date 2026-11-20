import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../advertise.html',import.meta.url),'utf8');
const start=html.indexOf('  async function uploadImageIfNeeded()');
const end=html.indexOf('  submitButton.addEventListener',start);
assert(start>0&&end>start);
function fixture({method='POST',type='image/png',bytes=3,uploadOk=true}={}){
  const file=new File([new Uint8Array(bytes)],'photo.png',{type}),requests=[],completions=[];
  const context={image:{files:[file]},currentImageUrl:'',orderId:'own-order',applicationToken:'offline-token',FormData,
    setStatus(){},createAdImageUploadUrl:async()=>({data:{uploadMethod:method,uploadUrl:'https://example.test/upload',objectPath:'ad_creatives/own-order/creative.png',
      fields:{key:'ad_creatives/own-order/creative.png','Content-Type':type,acl:'private',policy:'offline-policy'}}}),
    fetch:async(url,request)=>{requests.push({url,request});return {ok:uploadOk,status:uploadOk?204:403};},
    completeAdImageUpload:async value=>{completions.push(value);return {data:{imageUrl:'https://example.test/verified.webp'}};}};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  return {run:()=>context.uploadImageIfNeeded(),requests,completions,context};
}
test('signed POST fields and file-last order reach Storage before completion',async()=>{
  const h=fixture();assert.equal(await h.run(),'https://example.test/verified.webp');
  const {request}=h.requests[0];assert.equal(request.method,'POST');assert.equal(request.headers,undefined);
  assert.deepEqual([...request.body.keys()],['key','Content-Type','acl','policy','file']);
  assert.equal(request.body.get('acl'),'private');assert.equal(h.completions.length,1);
});
test('updated page remains compatible with the old PUT server during rollout',async()=>{
  const h=fixture({method:undefined});h.context.createAdImageUploadUrl=async()=>({data:{uploadUrl:'https://example.test/upload',objectPath:'ad_creatives/own-order/creative.png'}});
  await h.run();assert.equal(h.requests[0].request.method,'PUT');assert.equal(h.requests[0].request.headers['Content-Type'],'image/png');
});
test('unsupported, empty and oversized files are rejected before requesting an upload',async()=>{
  for(const options of [{type:'text/html'},{type:'image/svg+xml'},{bytes:0},{bytes:5*1024*1024+1}]){
    const h=fixture(options);let issued=0;h.context.createAdImageUploadUrl=async()=>{issued++;throw Error('should not issue');};
    await assert.rejects(h.run());assert.equal(issued,0);assert.equal(h.requests.length,0);assert.equal(h.completions.length,0);
  }
});
test('failed Storage upload cannot create a published image reference',async()=>{
  const h=fixture({uploadOk:false});await assert.rejects(h.run());assert.equal(h.completions.length,0);assert.equal(h.context.currentImageUrl,'');
});
