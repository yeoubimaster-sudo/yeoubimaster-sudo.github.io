const labels = {pending:'검토 대기',approved:'승인 완료',changes_requested:'수정 요청',rejected:'반려',stopped:'공개 중지',withdrawn:'철회'};
export function safeCameraUrl(value, media = false) {
  try {
    if (typeof value !== 'string' || value.length > 1500) return null;
    const u = new URL(value), host = u.hostname;
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/.test(host) ||
      /(^|\.)(localhost|local|internal|lan|test|invalid|example|home|onion)$/.test(host) ||
      [...u.searchParams.keys()].some(k => /^(token|access_token|auth|password|passwd|key|api_key|signature|sig)$/i.test(k))) return null;
    if (!media) return u.href;
    if (u.hostname === 'www.youtube.com' && u.pathname === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') || '')) return u.href;
    return u.pathname.toLowerCase().endsWith('.m3u8') && !u.search && !u.hash ? u.href : null;
  } catch {return null;}
}
export function mountCameraAdmin({call, document:doc = document, login, logout, Hls = globalThis.Hls}) {
  const $ = id => doc.getElementById(id);
  let uid = null, epoch = 0, busy = false, enabled = false, items = [], selected = null, cursor = null, stopMedia = () => {};
  const el = (tag, text, className) => {const node = doc.createElement(tag);if (text !== undefined) node.textContent = text;if(className)node.className=className;return node;};
  const button = (label, action, className) => {const b=el('button',label,className);b.type='button';b.addEventListener('click',action);return b;};
  const message = value => {$('message').textContent=value;};
  const disposePreview = () => {stopMedia();stopMedia=()=>{};};
  const error = e => /[가-힣]/.test(e?.message || '') ? e.message : '처리하지 못했습니다. 연결과 로그인 상태를 확인한 뒤 새로 불러와 주세요.';
  function lock() {
    for(const b of $('workspace').querySelectorAll('button,input,textarea')) b.disabled=busy || !uid || b.dataset.unavailable==='true';
  }
  async function request(data) {
    if (!uid || busy) return;
    const owner=uid, generation=epoch;busy=true;lock();
    try {
      const result=await call({...data,expectedUid:owner});
      if(owner!==uid || generation!==epoch) return;
      return result;
    } catch(e) {if(owner===uid && generation===epoch) message(error(e));}
    finally {if(generation===epoch){busy=false;lock();}}
  }
  async function load(more = false) {
    const data=await request({op:'list',...(more && cursor ? {cursor} : {})});
    if(!data) return;
    enabled=data.enabled===true;cursor=data.cursor;items=more?[...items,...data.items]:data.items;
    // Refresh may change versions; never carry checkboxes over to another review.
    selected=null;disposePreview();$('detail').replaceChildren(el('p','목록에서 신청을 선택해 주세요.'));
    $('availability').textContent=enabled?'신청 접수 중':'신청 접수 준비 중 · 기존 공개 중지는 가능합니다.';
    renderList();message(`${items.length}개 신청을 불러왔습니다.`);
  }
  function renderList() {
    $('items').replaceChildren(...items.map(item=>{
      const b=button(`${item.draft.title} · ${labels[item.status] || item.status}${item.published?' · 공개 중':''}`,()=>select(item));
      b.setAttribute('aria-pressed',String(item.id===selected?.id));return b;
    }));$('more').hidden=!cursor;lock();
  }
  function link(value, title) {
    const url=safeCameraUrl(value);if(!url)return el('span','없음');
    const a=el('a',title || url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
  }
  function select(item) {
    if(busy)return;disposePreview();selected=item;renderList();const root=$('detail');root.replaceChildren();
    const d=item.draft, heading=el('h2',d.title);heading.tabIndex=-1;root.append(heading,el('p',`영상 제공 · ${d.providerName}`),el('p',d.description || ''),
      el('p',`위치: ${d.lat}, ${d.lon}`),link(d.website,'제공자 홈페이지·예약 안내'),el('p',`신청 상태: ${labels[item.status]} / ${item.published?'기존 승인본 공개 중':'비공개'}`));
    if(item.reason)root.append(el('p',`지난 검토: ${item.reason}`,'notice'));
    const preview=el('div',undefined,'preview');const url=safeCameraUrl(d.media?.url,true);
    const previewButton=button('신청 영상 재생',()=>{
      disposePreview();preview.replaceChildren();if(!url){preview.append(el('p','지원하지 않는 주소입니다.'));return;}
      const u=new URL(url);
      if(u.hostname==='www.youtube.com'){
        const frame=el('iframe');frame.title='신청 카메라 실시간 영상';frame.src=`https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}?autoplay=1`;frame.allow='autoplay; encrypted-media; picture-in-picture';frame.allowFullscreen=true;preview.append(frame);stopMedia=()=>frame.remove();
      }else{
        const video=el('video');video.controls=true;video.playsInline=true;preview.append(video);
        let hls;
        if(Hls?.isSupported()){hls=new Hls();hls.loadSource(url);hls.attachMedia(video);hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)message('영상 연결을 확인할 수 없습니다. 재생 확인 없이 승인하지 마세요.');});}
        else if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=url;
        else preview.append(el('p','이 브라우저에서 HLS를 재생할 수 없습니다. Safari에서 다시 확인해 주세요.'));
        video.addEventListener('error',()=>message('영상 연결에 실패했습니다. 주소와 실제 재생을 확인해 주세요.'));
        void video.play().catch(()=>{});stopMedia=()=>{hls?.destroy();video.pause();video.removeAttribute('src');video.load();video.remove();};
      }
    });previewButton.dataset.unavailable=String(!url);root.append(el('p',d.media?.url || ''),previewButton,preview);
    const checks={};for(const [key,text]of Object.entries({rights:'제공 권한을 확인했습니다',live:'영상이 현재 풍경으로 계속 재생됩니다',location:'지도 위치와 영상 장소가 일치합니다',privacy:'얼굴·차량 번호 등 개인정보 노출이 없습니다'})){
      const label=el('label'),input=el('input');input.type='checkbox';input.dataset.check=key;label.append(input,doc.createTextNode(text));root.append(label);checks[key]=input;
    }
    const reasonLabel=el('label','검토 사유 (수정 요청·반려·중지 시 필수)'),reason=el('textarea');reason.maxLength=300;reason.rows=3;reasonLabel.append(reason);root.append(reasonLabel);
    async function act(op,extra={}) {
      if(selected!==item || !uid)return;
      const result=await request({op,id:item.id,version:item.version,reason:reason.value,...extra});
      if(!result)return;
      items=items.map(row=>row.id===result.id?result:row);select(result);message('처리했습니다. 공개 상태와 안내 문구를 확인해 주세요.');
    }
    const actions=el('div',undefined,'actions');
    for(const [decision,title]of [['approve','승인·지도 공개'],['request_changes','수정 요청'],['reject','반려']]){
      const b=button(title,()=>{
        if(decision==='approve'&&!Object.values(checks).every(c=>c.checked)){message('검토 항목 네 가지를 모두 확인해 주세요.');return;}
        if(decision!=='approve'&&!reason.value.trim()){message('검토 사유를 적어 주세요.');return;}
        return act('review',{decision,checks:Object.fromEntries(Object.entries(checks).map(([k,c])=>[k,c.checked]))});
      },decision==='approve'?'primary':undefined);b.dataset.unavailable=String(!enabled||item.status!=='pending');actions.append(b);
    }
    const stop=button('공개 중지',()=>{if(!reason.value.trim()){message('중지 사유를 적어 주세요.');return;}return act('stop');},'danger');
    stop.dataset.unavailable=String(!item.published && item.status!=='pending');actions.append(stop);root.append(actions);
    root.append(el('h3','초기 파트너 배너 · 10일'));
    if(item.benefit){root.append(el('p',`${item.benefit.status==='stopped'?'중지':item.benefit.endAtMs<=Date.now()?'기간 종료':'게시 중'} · ${new Date(item.benefit.startAtMs).toLocaleString('ko-KR')}부터 ${new Date(item.benefit.endAtMs).toLocaleString('ko-KR')}까지`));}
    else {
      root.append(el('p','계정당 1회. 실제 게시일부터 10일이며, 중지해도 기간이 늘어나지 않습니다. 기존 승인본의 홈페이지를 연결합니다.'));
      const titleLabel=el('label','배너 제목'),title=el('input');title.maxLength=40;title.value=d.providerName;titleLabel.append(title);
      const bodyLabel=el('label','배너 소개'),body=el('input');body.maxLength=80;bodyLabel.append(body);root.append(titleLabel,bodyLabel);
      const publish=button('10일 배너 게시',()=>act('publish_benefit',{title:title.value,body:body.value}),'primary');publish.dataset.unavailable=String(!enabled||!item.published);root.append(publish);
    }
    lock();heading.focus();
  }
  async function setUser(user) {
    epoch++;busy=false;disposePreview();items=[];selected=null;cursor=null;
    uid=user?.emailVerified===true && user.email?.toLowerCase()==='yeoubi.master@gmail.com'?user.uid:null;
    $('workspace').hidden=!uid;$('login').hidden=!!uid;$('logout').hidden=!user;
    $('items').replaceChildren();$('detail').replaceChildren();message(uid?'신청을 불러오는 중…':user?'관리자 계정으로 로그인해 주세요.':'관리자 로그인이 필요합니다.');
    if(uid)await load();
  }
  $('login').addEventListener('click',()=>Promise.resolve().then(login).catch(e=>message(error(e))));
  $('logout').addEventListener('click',()=>{void setUser(null);Promise.resolve().then(logout).catch(e=>message(error(e)));});
  $('reload').addEventListener('click',()=>load());$('more').addEventListener('click',()=>load(true));
  return {setUser,dispose:()=>{epoch++;uid=null;disposePreview();},load};
}
