const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB42uqx7kLei3dE3uLZBUNQgP_uLAzuFkQ",
    authDomain: "horizon-4be45.firebaseapp.com",
    projectId: "horizon-4be45",
    storageBucket: "horizon-4be45.firebasestorage.app",
    messagingSenderId: "955109054720",
    appId: "1:955109054720:web:2b155899d4e14efa377be5",
    measurementId: "G-HD1CMEL7CN"
  };

const STATUS_LABELS = Object.freeze({
  pending_upload: '업로드 대기 · 비공개', processing: '파일 처리 중 · 비공개',
  pending_review: '이전 검토 대기 · 비공개', published: '공개 중', hidden: '운영자 비공개', rejected: '이전 거절·내림',
  expired: '공개 만료', failed: '파일 처리 실패', deleted: '삭제됨', open: '확인 필요', resolved: '처리 완료'
});
const REPORT_LABELS = Object.freeze({
  inappropriate: '부적절한 내용', sexual: '선정적인 내용', violence: '폭력적인 내용',
  privacy: '개인정보·초상권', copyright: '저작권', false_information: '잘못된 정보',
  misleading: '오해를 유발하는 정보', spam: '스팸·광고', other: '기타'
});
const SAFE_REASONS = Object.freeze({
  'operator-rejected': '운영자 검토 후 비공개', 'invalid-media': '파일 기준에 맞지 않음',
  'processing-failed': '파일 처리 실패', 'upload-expired': '업로드 시간 만료',
  'operator-hidden': '운영자 비공개', 'operator-deleted': '운영자 삭제'
});

export function safeMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 16000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' ||
        url.username || url.password || url.port || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function effectiveStatus(item, now = Date.now()) {
  const status = typeof item?.status === 'string' ? item.status : 'unknown';
  const expiry = Number(item?.expiresAtMs);
  return expiry > 0 && expiry <= now && !['rejected', 'deleted', 'failed'].includes(status)
    ? 'expired' : status;
}

export function canApprove(config, item, now = Date.now()) {
  return config?.enabled === true && config?.manualReviewRequired === true &&
    config?.paidModerationEnabled === false && effectiveStatus(item, now) === 'pending_review';
}

export function canRestore(config, item, now = Date.now()) {
  const expiry = Number(item?.expiresAtMs);
  return config?.enabled === true && config?.paidModerationEnabled === false &&
    effectiveStatus(item, now) === 'hidden' && Number.isFinite(expiry) && expiry > now;
}

export function reviewPolicy(config) {
  if (config?.reviewPolicy === 'auto_publish' && config?.manualReviewRequired === false) return 'auto_publish';
  if (config?.reviewPolicy === 'manual_review' || config?.manualReviewRequired === true) return 'manual_review';
  return 'unknown';
}

export function previewLifetime(expiresAtMs, serverNow = Date.now()) {
  const remaining = Number(expiresAtMs) - serverNow;
  return Number.isFinite(remaining) ? Math.max(0, Math.min(60000, remaining)) : 0;
}

export function reviewReason(value, required = false) {
  const text = String(value || '').normalize('NFC').trim();
  if (required && !text) return {valid: false, text, message: '처리 사유를 적어 주세요.'};
  if ([...text].length > 300) return {valid: false, text, message: '처리 사유는 300자 이내로 적어 주세요.'};
  return {valid: true, text, message: ''};
}

function errorCode(error) { return String(error?.code || '').replace(/^functions\//, ''); }
function errorMessage(error) {
  return ({
    'permission-denied': '이 계정에는 현장 소식 관리 권한이 없습니다. 관리자 계정을 확인해 주세요.',
    unauthenticated: '관리자 로그인을 다시 확인해 주세요.',
    'failed-precondition': '게시물 상태가 바뀌었거나 운영 준비가 끝나지 않았습니다. 새로고침해 주세요.',
    aborted: '다른 검토자가 게시물 상태를 바꿨습니다. 새 목록에서 다시 확인해 주세요.',
    'not-found': '항목이 삭제되었거나 관리 서버가 준비 중입니다. 새로고침해 주세요.',
    unimplemented: '현장 소식 관리 서버를 준비하고 있습니다.',
    'resource-exhausted': '현재 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    'auth/popup-closed-by-user': '로그인을 취소했습니다.',
    'auth/popup-blocked': '로그인 팝업이 차단됐습니다. 팝업 허용 후 다시 시도해 주세요.'
  })[errorCode(error)] || '연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function mountCommunityAdmin({api, auth, onAuthStateChanged, login, logout, document: doc = document}) {
  const el = id => doc.getElementById(id);
  const state = {authorized: false, user: null, authEpoch: 0, viewEpoch: 0,
    view: 'reports', config: null, nextCursor: null, items: [], loading: false,
    busy: false, modal: null, serverOffset: 0};
  const previews = new Map();
  const now = () => Date.now() - state.serverOffset;
  const text = (tag, value, className) => {
    const node = doc.createElement(tag);
    node.textContent = String(value ?? '');
    if (className) node.className = className;
    return node;
  };
  const date = value => Number(value) > 0
    ? new Date(Number(value)).toLocaleString('ko-KR', {hour12: false}) : '—';
  const statusLabel = value => STATUS_LABELS[value] || '확인 필요';
  function setError(message) {
    el('errorNotice').textContent = message || '';
    el('errorNotice').hidden = !message;
  }
  function clearPreview(key, message = '미디어 주소가 만료됐어요. 다시 확인해 주세요.') {
    const entry = previews.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    clearInterval(entry.interval);
    entry.cancelled = true;
    for (const media of entry.container.querySelectorAll('img, video')) {
      if (media.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.removeAttribute('poster'); media.load(); }
      else media.removeAttribute('src');
    }
    entry.container.replaceChildren(text('p', message, 'preview-message'));
    previews.delete(key);
  }
  function clearPreviews(message) {
    for (const key of [...previews.keys()]) clearPreview(key, message);
  }
  function controls() {
    const disabled = !state.authorized || state.loading || state.busy;
    for (const id of ['postsTab', 'reportsTab', 'refreshButton', 'postStatus', 'reportStatus', 'loadMoreButton']) el(id).disabled = disabled;
    el('logoutButton').disabled = state.busy;
    el('loadMoreButton').hidden = !state.nextCursor || !state.authorized;
    el('items').setAttribute('aria-busy', String(state.loading));
  }
  function closeDialog(force = false) {
    if (state.busy && !force) return;
    state.modal = null;
    if (el('reviewDialog').open) el('reviewDialog').close();
  }
  function lock(message) {
    state.authorized = false;
    state.viewEpoch++;
    state.loading = false;
    state.nextCursor = null;
    state.items = [];
    clearPreviews('관리자 연결이 종료됐어요.');
    closeDialog(true);
    el('items').replaceChildren();
    el('workspace').hidden = true;
    el('loginPanel').hidden = false;
    el('verifyButton').hidden = !state.user;
    el('logoutButton').hidden = !state.user;
    el('accountStatus').textContent = state.user ? '관리 권한 확인 필요' : '로그인 필요';
    el('pageStatus').textContent = message || '등록된 관리자 계정으로 로그인해 주세요.';
    controls();
  }
  function handleError(error) {
    const code = errorCode(error);
    if (['permission-denied', 'unauthenticated'].includes(code)) lock(errorMessage(error));
    setError(errorMessage(error));
  }
  function featureNotice() {
    const active = state.config?.enabled === true && state.config?.paidModerationEnabled === false;
    el('featureNotice').classList.toggle('off', !active);
    el('featureNotice').textContent = !active
      ? '현장 소식 공개 기능은 꺼져 있거나 준비 중입니다. 신고 확인·비공개 전환·삭제는 가능하며 다시 공개는 제한됩니다.'
      : reviewPolicy(state.config) === 'auto_publish'
        ? '파일 기준을 통과한 게시물은 바로 공개됩니다. 사전 승인은 하지 않으며 신고된 내용만 확인해 공개 유지·비공개 전환·삭제를 결정합니다. 유료 자동 검수는 꺼져 있습니다.'
        : reviewPolicy(state.config) === 'manual_review'
          ? '서버에 이전 수동 공개 정책이 설정돼 있습니다. 자동 공개 운영 설정을 확인해 주세요. 유료 자동 검수는 꺼져 있습니다.'
          : '서버 공개 정책을 확인하지 못했습니다. 공개 상태를 새로고침해 확인해 주세요.';
  }
  async function verify() {
    const epoch = state.authEpoch;
    if (!state.user) return;
    lock('서버에서 관리자 권한을 확인하고 있어요.');
    setError('');
    el('verifyButton').disabled = true;
    try {
      const result = await api.overview({});
      if (epoch !== state.authEpoch || !state.user) return;
      if (result?.isAdmin !== true) {
        handleError({code: 'permission-denied'});
        return;
      }
      state.authorized = true;
      state.config = result.config || null;
      el('loginPanel').hidden = true;
      el('workspace').hidden = false;
      el('accountStatus').textContent = '관리자 확인 완료';
      el('pageStatus').textContent = '미처리 신고부터 확인합니다. 신고 내용과 비공개 게시물은 관리자에게만 표시됩니다.';
      viewControls();
      featureNotice();
      await loadItems();
    } catch (error) {
      if (epoch === state.authEpoch) handleError(error);
    } finally {
      if (epoch === state.authEpoch) el('verifyButton').disabled = false;
    }
  }
  async function loadItems(append = false) {
    if (!state.authorized || state.busy) return;
    const epoch = state.authEpoch, generation = ++state.viewEpoch;
    const cursor = append ? state.nextCursor : null;
    clearPreviews();
    closeDialog();
    state.loading = true;
    if (!append) { state.items = []; el('items').replaceChildren(); state.nextCursor = null; }
    el('emptyState').hidden = true;
    el('listStatus').textContent = '목록을 불러오는 중…';
    setError(''); controls();
    const view = state.view;
    const filter = el(view === 'posts' ? 'postStatus' : 'reportStatus').value;
    el('listHeading').textContent = view === 'posts' ? statusLabel(filter) + ' 게시물' : (filter === 'open' ? '미처리 신고' : '처리 완료 신고');
    try {
      const result = await (view === 'posts'
        ? api.list({status: filter, limit: 20, ...(cursor ? {cursor} : {})})
        : api.reports({state: filter, limit: 20, ...(cursor ? {cursor} : {})}));
      if (epoch !== state.authEpoch || generation !== state.viewEpoch || !state.authorized) return;
      if (!Array.isArray(result?.items)) throw new Error('invalid response');
      if (Number(result.serverNowMs) > 0) state.serverOffset = Date.now() - Number(result.serverNowMs);
      const prior = append ? state.items : [];
      const unique = new Map(prior.map(item => [String(item.id || item.reportId), item]));
      for (const item of result.items) if (item && typeof (item.id || item.reportId) === 'string') unique.set(item.id || item.reportId, item);
      state.items = [...unique.values()];
      state.nextCursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null;
      renderItems();
      el('listStatus').textContent = state.items.length.toLocaleString('ko-KR') + '개 · ' + date(now()) + ' 기준';
      el('emptyState').hidden = state.items.length !== 0;
    } catch (error) {
      if (epoch === state.authEpoch && generation === state.viewEpoch) {
        handleError(error);
        el('listStatus').textContent = '목록을 불러오지 못했어요. 새로고침해 주세요.';
      }
    } finally {
      if (epoch === state.authEpoch && generation === state.viewEpoch) { state.loading = false; controls(); }
    }
  }
  function metadata(rows) {
    const list = doc.createElement('dl'); list.className = 'metadata';
    for (const [label, value] of rows) { list.append(text('dt', label), text('dd', value)); }
    return list;
  }
  function button(label, className, click, disabled = false) {
    const node = text('button', label, className); node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', click); return node;
  }
  function renderItems() {
    clearPreviews(); el('items').replaceChildren();
    for (const item of state.items) el('items').append(state.view === 'posts' ? postCard(item) : reportCard(item));
  }
  function cardShell(item, status, title) {
    const card = doc.createElement('article'); card.className = 'item';
    const body = doc.createElement('div'); body.className = 'item-body';
    const top = doc.createElement('div'); top.className = 'item-top';
    const heading = doc.createElement('div'); heading.append(text('h3', title), text('div', '번호 ' + String(item.id || item.reportId).slice(0, 12), 'item-id'));
    top.append(heading, text('span', statusLabel(status), 'badge ' + (Object.hasOwn(STATUS_LABELS, status) ? status : 'unknown')));
    body.append(top); card.append(body);
    const actions = doc.createElement('div'); actions.className = 'item-actions'; card.append(actions);
    return {card, body, actions};
  }
  function mediaArea(body, item, key) {
    const container = doc.createElement('div'); container.className = 'preview';
    container.append(text('p', '필요할 때만 미디어를 불러옵니다. 주소는 최대 60초 뒤 만료됩니다.', 'preview-message'));
    body.append(container);
    return button('사진·영상 확인', 'secondary', () => loadPreview(item, key, container));
  }
  function postCard(item) {
    const status = effectiveStatus(item, now());
    const {card, body, actions} = cardShell(item, status, item.placeLabel || '장소 정보 없음');
    body.append(text('p', item.caption || '설명 없음', 'caption'));
    const tags = doc.createElement('div'); tags.className = 'tag-list';
    for (const tag of Array.isArray(item.tags) ? item.tags.slice(0, 5) : []) tags.append(text('span', '#' + tag, 'tag'));
    body.append(tags, metadata([
      ['종류', item.mediaType === 'video' ? '영상 · 최대 5초' : '사진'],
      ['접수', date(item.uploadedAtMs || item.createdAtMs)], ['공개 만료', date(item.expiresAtMs)],
      ['신고', String(Number(item.reportCount) || 0) + '건'],
      ['처리 상태', SAFE_REASONS[item.safeReason] || statusLabel(status)],
      ...(item.moderationReason ? [['검토 사유', item.moderationReason]] : [])
    ]));
    if (['pending_review', 'published', 'hidden'].includes(status)) actions.append(mediaArea(body, item, 'post:' + item.id));
    if (status === 'pending_review' && canApprove(state.config, item, now())) {
      actions.append(button('승인', 'approve', () => openReview('approve', item), !canApprove(state.config, item, now())));
    }
    if (status === 'published') actions.append(button('비공개 전환', 'secondary', () => openReview('hide', item)));
    if (status === 'hidden') actions.append(button('다시 공개', 'primary', () => openReview('restore', item), !canRestore(state.config, item, now())));
    if (['pending_review', 'published', 'hidden', 'rejected', 'expired', 'failed', 'processing', 'pending_upload'].includes(status)) {
      actions.append(button('삭제', 'danger', () => openReview('delete', item)));
    }
    return card;
  }
  function reportCard(item) {
    const status = item.status || item.state || 'open';
    const {card, body, actions} = cardShell(item, status, REPORT_LABELS[item.reason] || '신고 내용 확인');
    body.append(text('p', item.details || '추가 설명 없음', 'report-details'));
    body.append(metadata([['신고 접수', date(item.createdAtMs)],
      ['게시물', String(item.postId || '').slice(0, 12)], ['현재 게시 상태', statusLabel(item.postStatus)],
      ...(status === 'resolved' ? [['검토 메모', item.resolutionNote || '—']] : [])]));
    body.append(text('p', '신고 처리 상태와 게시물 공개 상태는 별개입니다.', 'report-state-note'));
    if (item.postId && ['published', 'hidden', 'pending_review'].includes(item.postStatus)) {
      actions.append(mediaArea(body, {...item, id: item.postId}, 'report:' + (item.id || item.reportId)));
    }
    if (status === 'open') {
      actions.append(button(item.postStatus === 'published' ? '공개 유지 · 신고 처리 완료' : '신고 처리 완료', 'primary', () => openReview('resolve', item)));
      const post = {id: item.postId, status: item.postStatus};
      const reportId = item.id || item.reportId;
      if (item.postId && item.postStatus === 'published') actions.append(button('비공개 전환', 'secondary', () => openReview('hide', post, reportId)));
      if (item.postId && ['pending_review', 'published', 'hidden', 'rejected', 'expired', 'failed', 'processing', 'pending_upload'].includes(item.postStatus)) {
        actions.append(button('삭제', 'danger', () => openReview('delete', post, reportId)));
      }
    }
    return card;
  }
  async function loadPreview(item, key, container) {
    if (!state.authorized || state.busy || state.loading) return;
    clearPreview(key);
    const epoch = state.authEpoch, generation = state.viewEpoch;
    const entry = {container, cancelled: false, timer: null, interval: null};
    previews.set(key, entry);
    container.replaceChildren(text('p', '미디어를 불러오는 중…', 'preview-message'));
    try {
      const result = await api.media({postId: item.id});
      if (entry.cancelled || epoch !== state.authEpoch || generation !== state.viewEpoch || !state.authorized || doc.hidden) return;
      const url = safeMediaUrl(result?.url), thumbnail = safeMediaUrl(result?.thumbnailUrl);
      const ttl = previewLifetime(result?.expiresAtMs, now());
      if (!url || ttl <= 0 || !['image', 'video'].includes(result?.mediaType)) throw new Error('invalid preview');
      const media = doc.createElement(result.mediaType === 'video' ? 'video' : 'img');
      if (result.mediaType === 'video') { media.controls = true; media.playsInline = true; media.preload = 'none'; if (thumbnail) media.poster = thumbnail; }
      else { media.alt = '검토용 현장 사진'; media.referrerPolicy = 'no-referrer'; }
      media.src = url;
      const note = text('p', '미디어 주소는 최대 60초 뒤 만료됩니다. 다시 확인하려면 버튼을 눌러 주세요.', 'preview-note');
      media.addEventListener('error', () => { if (previews.get(key) === entry) clearPreview(key, '미디어를 표시하지 못했어요. 사진·영상 확인을 다시 눌러 주세요.'); }, {once: true});
      container.replaceChildren(media, note);
      entry.timer = setTimeout(() => clearPreview(key), ttl);
    } catch (error) {
      if (!entry.cancelled && epoch === state.authEpoch && generation === state.viewEpoch) {
        clearPreview(key, '미디어를 불러오지 못했어요. 만료·삭제 여부를 새로고침해 확인해 주세요.');
        if (['permission-denied', 'unauthenticated'].includes(errorCode(error))) handleError(error);
      }
    }
  }
  function openReview(action, item, reportId = null) {
    if (!state.authorized || state.busy || state.loading) return;
    if (action === 'approve' && !canApprove(state.config, item, now())) return;
    if (action === 'restore' && !canRestore(state.config, item, now())) return;
    state.modal = {action, item, reportId, epoch: state.authEpoch};
    const titles = {approve: '게시물을 공개할까요?', hide: '게시물을 비공개로 바꿀까요?', restore: '게시물을 다시 공개할까요?', delete: '게시물과 미디어를 삭제할까요?', resolve: '이 신고를 처리 완료할까요?'};
    const descriptions = {
      approve: '사진·영상과 설명을 검토한 후 승인해 주세요. 공개 기간이 남아 있을 때만 공개됩니다.',
      hide: '공개 목록과 새 공유에서 내립니다. 파일은 남겨 두며 원래 공개 기간이 끝나기 전에 다시 공개할 수 있습니다.',
      restore: '원래 공개 기간이 남아 있을 때만 다시 공개합니다. 공개 종료 시각은 늘어나지 않습니다.',
      delete: '공개와 새 공유를 차단하고 사진·영상 파일 삭제를 진행합니다. 관리 화면에서 되돌릴 수 없고 이미 받은 화면이나 파일까지 회수할 수는 없습니다.',
      resolve: item.postStatus === 'published' ? '현재 공개 상태를 유지하고 이 신고만 처리 완료로 옮깁니다. 게시물을 비공개로 바꾸거나 삭제하지 않습니다.' : '현재 게시물 상태를 유지하고 이 신고만 처리 완료로 옮깁니다. 게시물을 다시 공개하지 않습니다.'
    };
    el('dialogTitle').textContent = titles[action]; el('dialogDescription').textContent = descriptions[action] + (reportId ? ' 게시물 조치가 확인된 뒤 이 신고도 처리 완료로 옮깁니다.' : '');
    el('reviewReason').value = ''; el('reasonCount').textContent = '0'; el('dialogError').hidden = true;
    el('reasonRequirement').textContent = ['hide', 'delete'].includes(action) ? '(필수)' : '(선택)';
    el('deleteConfirmationField').hidden = action !== 'delete';
    el('deleteConfirmation').checked = false;
    el('deleteConfirmation').required = action === 'delete';
    el('dialogConfirm').textContent = {approve: '승인·공개', hide: '비공개 전환', restore: '다시 공개', delete: '삭제 실행', resolve: '신고 처리 완료'}[action];
    el('dialogConfirm').className = action === 'delete' ? 'danger' : 'primary';
    el('dialogConfirm').disabled = false; el('dialogCancel').disabled = false; el('reviewReason').disabled = false;
    el('deleteConfirmation').disabled = false;
    el('reviewDialog').showModal(); el('reviewReason').focus();
  }
  async function submitReview(event) {
    event.preventDefault();
    const modal = state.modal;
    if (!modal || state.busy || !state.authorized || modal.epoch !== state.authEpoch) return;
    const reason = reviewReason(el('reviewReason').value, ['hide', 'delete'].includes(modal.action));
    if (!reason.valid) { el('dialogError').textContent = reason.message; el('dialogError').hidden = false; return; }
    if (modal.action === 'delete' && !el('deleteConfirmation').checked) {
      el('dialogError').textContent = '삭제 내용을 확인하고 확인란을 선택해 주세요.'; el('dialogError').hidden = false; return;
    }
    if (modal.action === 'approve' && !canApprove(state.config, modal.item, now())) {
      el('dialogError').textContent = '공개 기간 또는 운영 상태를 새로고침해 주세요.'; el('dialogError').hidden = false; return;
    }
    if (modal.action === 'restore' && !canRestore(state.config, modal.item, now())) {
      el('dialogError').textContent = '공개 기간 또는 운영 상태가 바뀌었습니다. 새로고침해 주세요.'; el('dialogError').hidden = false; return;
    }
    state.busy = true; controls();
    for (const id of ['dialogConfirm', 'dialogCancel', 'reviewReason', 'deleteConfirmation']) el(id).disabled = true;
    el('dialogConfirm').textContent = '처리 중…';
    let postChanged = false, filesPending = false;
    try {
      if (modal.action !== 'resolve') {
        const result = await api.moderate({postId: modal.item.id, decision: modal.action, reason: reason.text,
          ...(modal.item.status ? {expectedStatus: modal.item.status} : {})});
        if (modal.epoch !== state.authEpoch || !state.authorized) return;
        const expected = {approve: 'published', restore: 'published', hide: 'hidden', delete: 'deleted'}[modal.action];
        if (result?.ok !== true || result.status !== expected) throw new Error('unconfirmed response');
        postChanged = true;
        filesPending = modal.action === 'delete' && result.filesPending === true;
        clearPreviews('게시물 상태가 변경되어 미디어 표시를 종료했어요.');
      }
      if (modal.action === 'resolve' || modal.reportId) {
        const resolutionNote = modal.action === 'resolve' ? reason.text :
          (modal.action === 'hide' ? '비공개 전환: ' : '삭제: ') + reason.text;
        const result = await api.resolve({reportId: modal.reportId || modal.item.id || modal.item.reportId, resolutionNote});
        if (modal.epoch !== state.authEpoch || !state.authorized) return;
        if (result?.ok !== true) throw new Error('unconfirmed response');
      }
      if (modal.epoch !== state.authEpoch || !state.authorized) return;
      clearPreviews('처리가 완료되어 미디어 표시를 종료했어요.');
      state.busy = false; closeDialog();
      await loadItems();
      if (modal.epoch !== state.authEpoch || !state.authorized) return;
      el('pageStatus').textContent = filesPending
        ? '게시물 공개 차단을 저장했습니다. 파일 삭제는 재시도 중이며 신고 처리 결과는 새 목록에서 확인할 수 있습니다.'
        : '처리 결과를 저장하고 목록을 새로 불러왔습니다.';
    } catch (error) {
      if (modal.epoch === state.authEpoch) {
        state.busy = false; closeDialog(); handleError(error);
        if (state.authorized) await loadItems();
        if (modal.epoch !== state.authEpoch) return;
        setError(postChanged && modal.reportId
          ? (modal.action === 'hide' ? '게시물 비공개 전환은 완료됐지만' : '게시물 삭제의 공개 차단은 완료됐지만') + ' 신고 처리 완료를 저장하지 못했습니다. ' + (filesPending ? '파일 삭제도 재시도 중입니다. ' : '') + '현재 게시 상태를 확인하고 신고 처리를 다시 완료해 주세요.'
          : errorMessage(error));
      }
    } finally {
      if (modal.epoch === state.authEpoch) { state.busy = false; controls(); }
    }
  }
  function viewControls() {
    for (const [id, active] of [['postsTab', state.view === 'posts'], ['reportsTab', state.view === 'reports']]) {
      el(id).classList.toggle('selected', active); el(id).setAttribute('aria-pressed', String(active));
    }
    el('postFilterField').hidden = state.view !== 'posts'; el('reportFilterField').hidden = state.view !== 'reports';
  }
  function setView(view) {
    if (state.busy || !state.authorized) return;
    state.view = view;
    viewControls();
    void loadItems();
  }
  el('postsTab').addEventListener('click', () => setView('posts'));
  el('reportsTab').addEventListener('click', () => setView('reports'));
  el('postStatus').addEventListener('change', () => { void loadItems(); });
  el('reportStatus').addEventListener('change', () => { void loadItems(); });
  el('refreshButton').addEventListener('click', () => { void verify(); });
  el('verifyButton').addEventListener('click', () => { void verify(); });
  el('loadMoreButton').addEventListener('click', () => { void loadItems(true); });
  el('reviewForm').addEventListener('submit', submitReview);
  el('dialogCancel').addEventListener('click', () => closeDialog());
  el('reviewDialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); else state.modal = null; });
  el('reviewReason').addEventListener('input', () => { el('reasonCount').textContent = String([...el('reviewReason').value].length); });
  el('loginButton').addEventListener('click', async () => {
    el('loginButton').disabled = true; setError('');
    try { await login(); } catch (error) { setError(errorMessage(error)); }
    finally { el('loginButton').disabled = false; }
  });
  el('logoutButton').addEventListener('click', async () => {
    if (state.busy) return;
    // Remove private content before an SDK/network logout can complete.
    state.authEpoch++; state.user = null; lock('로그아웃 중…');
    try { await logout(); }
    catch (error) {
      state.user = auth.currentUser || null;
      lock('로그아웃을 완료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
      setError(errorMessage(error));
    }
  });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clearPreviews('화면을 벗어나 미디어 표시를 종료했어요. 다시 확인해 주세요.'); });
  const unsubscribe = onAuthStateChanged(auth, user => {
    state.authEpoch++; state.user = user; state.busy = false;
    state.view = 'reports'; el('reportStatus').value = 'open'; viewControls();
    lock(); setError('');
    if (user) void verify();
  });
  return {destroy() { state.authEpoch++; lock(); unsubscribe?.(); }};
}

async function startFirebase() {
  const [{initializeApp}, authSdk, functionsSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js')
  ]);
  const app = initializeApp(FIREBASE_CONFIG), auth = authSdk.getAuth(app);
  const functions = functionsSdk.getFunctions(app, 'asia-northeast3');
  const callable = name => async data => (await functionsSdk.httpsCallable(functions, name)(data)).data;
  const provider = new authSdk.GoogleAuthProvider(); provider.setCustomParameters({prompt: 'select_account'});
  return mountCommunityAdmin({auth, onAuthStateChanged: authSdk.onAuthStateChanged,
    login: () => authSdk.signInWithPopup(auth, provider), logout: () => authSdk.signOut(auth),
    api: {overview: callable('communityAdminOverview'), list: callable('communityAdminList'),
      reports: callable('communityAdminReports'), media: callable('communityAdminMedia'),
      moderate: callable('communityModeratePost'), resolve: callable('communityAdminResolveReport')}});
}

if (typeof document !== 'undefined' && document.getElementById('community-admin-root')) {
  startFirebase().catch(() => {
    document.getElementById('pageStatus').textContent = '관리자 도구를 연결하지 못했습니다. 잠시 후 다시 열어 주세요.';
    const notice = document.getElementById('errorNotice'); notice.textContent = '관리 서버와 네트워크 연결을 확인해 주세요.'; notice.hidden = false;
  });
}
