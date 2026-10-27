export function normalizeLink(value) {
  if (!value.trim()) return '';
  let url; try { url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`); } catch (_) { throw Error('https 웹 주소를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
      (url.port && url.port !== '443')) throw Error('https 웹 주소를 입력해 주세요.');
  return url.href;
}
export function reportTotals(rows) {
  const byId = new Map();
  for (const row of rows) {
    const value = byId.get(row.creativeId) || {title: row.title, impressions: 0, clicks: 0, viewableClicks: 0};
    for (const k of ['impressions','clicks','viewableClicks']) value[k] += Number.isFinite(row[k]) ? Math.max(0,row[k]) : 0;
    byId.set(row.creativeId, value);
  }
  return [...byId.values()];
}
export async function preparePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('10MB 이하의 JPG·PNG·WebP 사진을 선택해 주세요.');
  const bitmap = await createImageBitmap(file), scale = Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const encoded = canvas.toDataURL('image/webp',.86).split(',')[1];
  if (encoded.length > 2800000) throw Error('사진 용량이 큽니다. 더 작은 사진을 선택해 주세요.');
  return encoded;
}
export function mountFreeAds({call, root=document, confirmDiscard=()=>window.confirm('저장하지 않은 내용을 버리고 이동할까요?')}) {
  const $=id=>root.getElementById(id);
  let items=[], revision=0, current=null, pendingPhoto=null, objectUrl='', dirty=false, busy=false, authorized=false, epoch=0;
  const message=text=>{$('notice').textContent=text;};
  function locked(value){busy=value;for(const node of $('workspace').querySelectorAll('button,input,textarea,select'))node.disabled=value;}
  function clearPhotoUrl(){if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl='';}}
  function preview(){
    $('previewTitle').textContent=$('title').value.trim()||'업체명';$('poster').textContent=$('previewTitle').textContent;
    $('previewBody').textContent=$('body').value;$('arrow').hidden=!$('link').value.trim();
    const url=objectUrl||current?.imageUrl||'';$('image').hidden=!url;$('poster').hidden=!!url;
    if(url)$('image').src=url;else $('image').removeAttribute('src');$('image').style.objectFit=$('fit').value;
  }
  function edit(item){
    if(busy|| (dirty&&!confirmDiscard()))return;
    clearPhotoUrl();pendingPhoto=null;dirty=false;
    current=item?{...item}:{promotionOrderId:new URLSearchParams(window.location.search).get('orderId') || '',id:crypto.randomUUID(),title:'',body:'',linkUrl:'',assetId:'',imageUrl:'',imageFit:'contain',status:'draft'};
    if ($('promotionOrderId')) $('promotionOrderId').value = current.promotionOrderId || '';
    for(const [id,k] of [['title','title'],['body','body'],['link','linkUrl'],['fit','imageFit']])$(id).value=current[k];
    $('photo').value='';$('editor').hidden=false;$('editorHeading').textContent=item?'광고 수정':'광고 작성';
    $('pause').hidden=current.status!=='published';$('publish').textContent=current.status==='published'?'수정하고 게시 유지':'게시하기';
    preview();$('title').focus();
  }
  function render(){
    $('count').textContent=`${items.length}곳 · 게시 ${items.filter(i=>i.status==='published'&&(!i.endAtMs||i.endAtMs>Date.now())).length}곳`;
    $('list').replaceChildren();$('empty').hidden=items.length>0;
    for(const item of items){
      const row=root.createElement('div');row.className='ad-row';
      const name=root.createElement('strong');name.textContent=item.title + (item.promotionOrderId ? ' · 출시 프로모션' : ' · 무료');
      const badge=root.createElement('span');badge.className=`badge ${item.status==='published'?'live':''}`;badge.textContent=item.endAtMs && item.endAtMs <= Date.now() ? '기간 종료' : ({draft:'임시 저장',published:'게시 중',paused:'중지'})[item.status]||'확인 필요';
      const button=root.createElement('button');button.textContent='수정';button.onclick=()=>edit(item);row.append(name,badge,button);
      if(item.endAtMs){const end=root.createElement('small');end.textContent=new Date(item.endAtMs).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' 종료';row.append(end);}
      const toggle=root.createElement('button');toggle.textContent=item.status==='published'?'중지':'게시';toggle.onclick=()=>{
        if(dirty&&!confirmDiscard())return;
        void store({...item,status:item.status==='published'?'paused':'published'});
      };row.append(toggle);$('list').append(row);
    }
  }
  async function guarded(task){
    if(!authorized||busy)return;const token=epoch;locked(true);
    try{await task(token);}catch(e){if(token===epoch)message(e.message||'처리하지 못했습니다. 다시 시도해 주세요.');}
    finally{if(token===epoch)locked(false);}
  }
  async function load(){await guarded(async token=>{const data=await call({action:'list'});if(token!==epoch)return;
    items=data.items;revision=data.revision;render();message('광고 목록을 불러왔습니다.');});}
  async function store(item,photo=null){await guarded(async token=>{
    if(photo){const result=await call({action:'upload',image:photo});if(token!==epoch)return;item.assetId=result.assetId;item.imageUrl=result.imageUrl;}
    const data=await call({action:'save',revision,item});if(token!==epoch)return;
    items=data.items;revision=data.revision;dirty=false;clearPhotoUrl();pendingPhoto=null;current=null;$('editor').hidden=true;render();
    message(item.status==='published'?'게시했습니다. 업데이트된 앱에 자동 반영됩니다.':item.status==='paused'?'광고를 중지했습니다.':'임시 저장했습니다. 앱에는 아직 표시되지 않습니다.');
  });}
  function save(status){
    if(!current||!$('form').reportValidity())return;
    let link;try{link=normalizeLink($('link').value);}catch(e){message(e.message);return;}
    void store({...current,promotionOrderId:$('promotionOrderId')?.value.trim() || '',title:$('title').value.trim(),body:$('body').value.trim(),linkUrl:link,imageFit:$('fit').value,status},pendingPhoto);
  }
  async function report(){await guarded(async token=>{const data=await call({action:'report',days:Number($('days').value)});if(token!==epoch)return;
    $('report').replaceChildren();const rows=reportTotals(data.rows);
    for(const row of rows){const tr=root.createElement('tr');for(const value of [row.title,row.impressions.toLocaleString(),row.clicks.toLocaleString(),row.impressions?`${(row.viewableClicks/row.impressions*100).toFixed(1)}%`:'—']){const td=root.createElement('td');td.textContent=value;tr.append(td);}$('report').append(tr);}
    $('reportStatus').textContent=data.truncated?'일부 집계만 표시됩니다. 기간을 줄여 주세요.':rows.length?`최근 ${data.days}일 실제 집계 · 추가 노출 요금 없음`:'아직 집계가 없습니다. 게시한 광고를 업데이트된 앱에서 이용하면 쌓입니다.';
  });}
  $('new').onclick=()=>edit(null);$('reload').onclick=()=>{if(!dirty||confirmDiscard()){dirty=false;$('editor').hidden=true;void load();}};
  $('form').onsubmit=e=>{e.preventDefault();save('published');};$('draft').onclick=()=>save('draft');$('pause').onclick=()=>save('paused');
  for(const id of ['title','body','link','fit','promotionOrderId'])$(id)?.addEventListener('input',()=>{dirty=true;preview();});
  $('removePhoto').onclick=()=>{clearPhotoUrl();pendingPhoto=null;current.assetId='';current.imageUrl='';$('photo').value='';dirty=true;preview();};
  $('photo').onchange=async()=>{const file=$('photo').files?.[0];if(!file||!current)return;const token=epoch,id=current.id;
    locked(true);try{const encoded=await preparePhoto(file);if(token!==epoch||current?.id!==id)return;clearPhotoUrl();objectUrl=URL.createObjectURL(file);pendingPhoto=encoded;dirty=true;preview();}
    catch(e){if(token===epoch){$('photo').value='';message(e.message);}}finally{if(token===epoch)locked(false);}};
  $('reportRefresh').onclick=report;
  return {message,async setUser(allowed){++epoch;authorized=!!allowed;busy=false;dirty=false;items=[];current=null;pendingPhoto=null;clearPhotoUrl();
    $('workspace').hidden=!allowed;$('loginPanel').hidden=!!allowed;$('logout').hidden=!allowed;$('editor').hidden=true;$('report').replaceChildren();$('list').replaceChildren();message('');
    if(allowed){locked(false);await load();}else message('관리자 계정으로 로그인해 주세요.');}};
}
