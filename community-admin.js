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

const OPERATIONS_QUEUES = Object.freeze({
  openReports: ['미처리 신고', '아직 처리 완료로 옮기지 않은 신고'],
  failedPosts: ['실패 상태 기록', '파일이 정리된 과거 실패 이력도 포함'],
  processingPosts: ['파일 처리 중', '공개 전 파일 변환·검증 중인 기록'],
  rawCleanupPending: ['원본 파일 정리 대기', '원본 정리가 끝나지 않은 기록'],
  cleanupDue: ['기한 도래 정리 대기', '만료·삭제·실패·미완료 정리 기록 포함']
});
const OPERATIONS_METRICS = Object.freeze({
  dailyUploads: ['일간 업로드 예약 요청', 'count', 'dayUtc'],
  dailyUploadBytes: ['일간 업로드 예약 용량', 'bytes', 'dayUtc'],
  monthlyUploads: ['월간 업로드 예약 요청', 'count', 'monthUtc'],
  monthlyUploadBytes: ['월간 업로드 예약 용량', 'bytes', 'monthUtc'],
  dailyReadRequests: ['일간 조회 요청', 'count', 'dayUtc'],
  dailyWatchAttempts: ['일간 알림 발송 시도', 'count', 'dayKst']
});
const OPERATIONS_COUNTS = Object.freeze({
  watch: {eventPages: '이벤트 조회 묶음', candidates: '후보 확인', sendAttempts: '발송 시도',
    sent: 'FCM 접수 성공', sendFailures: '발송 실패', queryFailures: '조회 실패',
    eventFailures: '이벤트 처리 실패', inboxFailures: '대기함 처리 실패', uncertain: '결과 미확인', cleaned: '보호 기록 정리'},
  purge: {rawCandidates: '원본 정리 후보', postCandidates: '게시물 정리 후보',
    rawFailures: '원본 정리 실패', postFailures: '게시물 정리 실패'}
});
const operationRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const operationNumber = value => Number.isSafeInteger(value) && value >= 0;
const operationTime = value => operationNumber(value) && value > 0 && value <= 8640000000000000;

/** Strict known fields only; absent/invalid observations never become a zero. */
export function normalizeOperations(value) {
  if (!operationRecord(value) || value.schemaVersion !== 1 || !operationTime(value.serverNowMs)) throw new Error('invalid operations response');
  const queues = {}, periods = {}, metrics = {}, workers = {};
  for (const key of Object.keys(OPERATIONS_QUEUES)) {
    const row = value.queues?.[key];
    queues[key] = operationRecord(row) && row.state === 'ok' && row.limit === 50 &&
      operationNumber(row.count) && row.count <= 50 && typeof row.hasMore === 'boolean' &&
      (!row.hasMore || row.count === 50)
      ? {state: 'ok', count: row.count, hasMore: row.hasMore, limit: 50}
      : {state: 'unavailable', count: null, hasMore: false, limit: 50};
  }
  for (const key of ['dayUtc', 'monthUtc', 'dayKst']) {
    const row = value.usage?.periods?.[key], zone = key === 'dayKst' ? 'Asia/Seoul' : 'UTC';
    periods[key] = operationRecord(row) && operationTime(row.fromMs) && operationTime(row.toMs) &&
      row.fromMs < row.toMs && row.timeZone === zone
      ? {fromMs: row.fromMs, toMs: row.toMs, timeZone: zone} : null;
  }
  for (const [key, [, unit, period]] of Object.entries(OPERATIONS_METRICS)) {
    const row = value.usage?.metrics?.[key];
    metrics[key] = operationRecord(row) && row.state === 'ok' && operationNumber(row.used) &&
      (row.limit === null || operationNumber(row.limit)) && row.unit === unit &&
      row.period === period && periods[period]
      ? {state: 'ok', used: row.used, limit: row.limit, unit, period}
      : {state: 'unavailable', used: null, limit: null, unit, period};
  }
  for (const [key, labels] of Object.entries(OPERATIONS_COUNTS)) {
    const row = value.workers?.[key], run = row?.lastRun;
    if (operationRecord(row) && row.state === 'missing' && run === null) {
      workers[key] = {state: 'missing', lastRun: null}; continue;
    }
    const valid = operationRecord(row) && row.state === 'ok' && operationRecord(run) &&
      operationTime(run.startedAtMs) && operationTime(run.finishedAtMs) && run.finishedAtMs >= run.startedAtMs &&
      ['ok', 'partial', 'failed', 'inactive'].includes(run.outcome) && typeof run.stale === 'boolean' &&
      operationRecord(run.counts) && Object.keys(labels).every(name => operationNumber(run.counts[name]));
    workers[key] = valid ? {state: 'ok', lastRun: {startedAtMs: run.startedAtMs,
      finishedAtMs: run.finishedAtMs, outcome: run.outcome, stale: run.stale,
      counts: Object.fromEntries(Object.keys(labels).map(name => [name, run.counts[name]]))}}
      : {state: 'unavailable', lastRun: null};
  }
  return {schemaVersion: 1, serverNowMs: value.serverNowMs, queues, usage: {periods, metrics}, workers};
}

export function operationAmount(value, unit = 'count') {
  if (!operationNumber(value)) return '확인하지 못함';
  if (unit !== 'bytes') return value.toLocaleString('ko-KR');
  if (value < 1024) return value.toLocaleString('ko-KR') + ' B';
  const scale = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return (value / (1024 ** scale)).toLocaleString('ko-KR', {maximumFractionDigits: 2}) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][scale] +
    ' (' + value.toLocaleString('ko-KR') + ' B)';
}

export function mountCommunityAdmin({api, auth, onAuthStateChanged, login, logout, document: doc = document}) {
  const el = id => doc.getElementById(id);
  const state = {authorized: false, user: null, authEpoch: 0, viewEpoch: 0,
    view: 'reports', config: null, nextCursor: null, items: [], loading: false,
    busy: false, modal: null, serverOffset: 0, operations: null};
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
    for (const id of ['postsTab', 'reportsTab', 'operationsTab', 'refreshButton', 'postStatus', 'reportStatus', 'loadMoreButton']) el(id).disabled = disabled;
    el('logoutButton').disabled = state.busy;
    el('loadMoreButton').hidden = state.view === 'operations' || !state.nextCursor || !state.authorized;
    el('items').setAttribute('aria-busy', String(state.loading));
    el('operationsContent').setAttribute('aria-busy', String(state.loading && state.view === 'operations'));
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
    state.operations = null;
    el('operationsContent').replaceChildren();
    el('operationsStatus').textContent = '';
    el('operationsNotice').textContent = '';
    el('operationsNotice').hidden = true;
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
    if (state.view === 'operations') return loadOperations();
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
  const operationsDate = value => new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
  function operationCard(title, className = '') {
    const card = doc.createElement('article'); card.className = 'operation-card ' + className;
    card.append(text('h3', title)); return card;
  }
  function renderOperations(snapshot) {
    const root = el('operationsContent'); root.replaceChildren();
    const queues = doc.createElement('div'); queues.className = 'operation-queues';
    let unavailable = 0;
    for (const [key, [title, description]] of Object.entries(OPERATIONS_QUEUES)) {
      const row = snapshot.queues[key], card = operationCard(title, 'operation-queue');
      card.append(text('p', row.state === 'ok' ? row.count.toLocaleString('ko-KR') + (row.hasMore ? '+' : '') : '확인하지 못함',
        row.state === 'ok' ? 'operation-number' : 'operation-unavailable'));
      card.append(text('p', description, 'operation-note'));
      card.append(text('p', row.state === 'ok' ? '최대 50개까지 확인 · 다른 항목과 중복될 수 있어요.' : '조회 실패 · 0개라는 뜻이 아닙니다.', 'operation-note'));
      if (row.state !== 'ok') unavailable++;
      queues.append(card);
    }
    root.append(text('h2', '지금 확인할 항목', 'operation-section-heading'), queues);
    const usage = doc.createElement('div'); usage.className = 'operation-usage';
    for (const [key, [title, unit, period]] of Object.entries(OPERATIONS_METRICS)) {
      const row = snapshot.usage.metrics[key], card = operationCard(title);
      if (row.state !== 'ok') {
        unavailable++; card.append(text('p', '확인하지 못함', 'operation-unavailable'),
          text('p', '집계 또는 기간을 확인하지 못했어요. 사용량이 0이라는 뜻은 아닙니다.', 'operation-note'));
      } else {
        card.append(text('p', operationAmount(row.used, unit), 'operation-value'));
        card.append(text('p', row.limit === null ? '한도 설정 확인 필요' : '설정 한도 ' + operationAmount(row.limit, unit), 'operation-note'));
        if (row.limit !== null) {
          const progress = doc.createElement('progress'); progress.max = 100;
          progress.value = row.limit === 0 ? row.used > 0 ? 100 : 0 : Math.min(100, row.used / row.limit * 100);
          progress.setAttribute('aria-label', title + ' 설정 한도 대비 사용량'); card.append(progress);
          if (row.used > row.limit) card.append(text('p', '설정 한도를 초과한 수치입니다.', 'operation-warning'));
        }
        const window = snapshot.usage.periods[period];
        card.append(text('p', period === 'dayKst' ? '일간 · 한국시간 00시 경계' : period === 'monthUtc'
          ? '월간 · UTC 기준 (한국 월초 09시 경계)' : '일간 · UTC 기준 (한국 09시 경계)', 'operation-period'));
        card.append(text('p', operationsDate(window.fromMs) + ' ~ ' + operationsDate(window.toMs) + ' (한국시간·종료 제외)', 'operation-note'));
      }
      usage.append(card);
    }
    root.append(text('h2', '사용량과 설정 한도', 'operation-section-heading'),
      text('p', '업로드 예약 요청·예약 용량, 조회 요청과 발송 시도입니다. 실제 저장량·고유 이용자 수·수신 완료·청구 금액을 뜻하지 않습니다.', 'operation-explanation'), usage);
    const workers = doc.createElement('div'); workers.className = 'operation-workers';
    for (const [key, title] of [['watch', '최근 알림 발송 작업'], ['purge', '최근 파일 정리 작업']]) {
      const worker = snapshot.workers[key], card = operationCard(title);
      if (worker.state === 'missing') {
        card.append(text('p', '아직 기록이 없어요.', 'operation-empty'),
          text('p', '이 관측 기능에 저장된 실행 기록이 없습니다. 정상 실행이나 실패 0건으로 판단하지 않습니다.', 'operation-note'));
      } else if (worker.state !== 'ok') {
        unavailable++; card.append(text('p', '실행 기록을 확인하지 못했어요.', 'operation-unavailable'),
          text('p', '관측 조회 실패 · 과거 결과를 0으로 바꾸어 표시하지 않습니다.', 'operation-note'));
      } else {
        const run = worker.lastRun;
        card.append(text('p', ({ok: '정상 종료', partial: '일부 처리 실패', failed: '실패', inactive: '기능 비활성'})[run.outcome],
          'operation-outcome ' + (['partial', 'failed'].includes(run.outcome) ? 'operation-warning' : '')));
        if (run.stale) card.append(text('p', '20분 이상 지난 기록 · 현재 상태와 다를 수 있어요.', 'operation-warning'));
        card.append(text('p', '최근 1회 · ' + operationsDate(run.finishedAtMs) + ' 종료 (한국시간)', 'operation-note'));
        card.append(metadata(Object.entries(OPERATIONS_COUNTS[key]).map(([name, label]) => [label, operationAmount(run.counts[name])])));
        if (key === 'watch') card.append(text('p', 'FCM 접수 성공은 푸시 서비스가 요청을 받은 수입니다. 실제 기기 수신 완료를 확인한 값은 아닙니다.', 'operation-note'));
      }
      workers.append(card);
    }
    root.append(text('h2', '최근 작업 결과', 'operation-section-heading'), workers);
    el('operationsStatus').textContent = operationsDate(snapshot.serverNowMs) + ' 조회 기준 (한국시간) · 수동 새로고침';
    el('operationsNotice').textContent = unavailable
      ? unavailable + '개 항목을 확인하지 못했어요. 확인된 결과와 구분해 표시합니다.'
      : '조회한 시점의 결과입니다. 대기 기록은 중복될 수 있으며 합산하지 않습니다.';
    el('operationsNotice').className = unavailable ? 'notice off' : 'notice';
    el('operationsNotice').hidden = false;
  }
  async function loadOperations() {
    if (!state.authorized || state.busy || state.view !== 'operations') return;
    const epoch = state.authEpoch, generation = ++state.viewEpoch;
    clearPreviews(); closeDialog(); state.loading = true; state.nextCursor = null;
    state.operations = null; el('operationsContent').replaceChildren();
    el('operationsStatus').textContent = '운영현황을 불러오는 중…';
    el('operationsNotice').hidden = true; setError(''); controls();
    try {
      const result = await api.operations({});
      if (epoch !== state.authEpoch || generation !== state.viewEpoch || !state.authorized || state.view !== 'operations') return;
      state.operations = normalizeOperations(result); renderOperations(state.operations);
    } catch (error) {
      if (epoch === state.authEpoch && generation === state.viewEpoch && state.authorized && state.view === 'operations') {
        handleError(error);
        el('operationsStatus').textContent = '운영현황을 확인하지 못했어요. 새로고침해 주세요.';
      }
    } finally {
      if (epoch === state.authEpoch && generation === state.viewEpoch) { state.loading = false; controls(); }
    }
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
    el('contributionRevocationField').hidden = action !== 'delete';
    el('contributionRevocation').checked = false;
    el('contributionRevocation').disabled = false;
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
    for (const id of ['dialogConfirm', 'dialogCancel', 'reviewReason', 'deleteConfirmation', 'contributionRevocation']) el(id).disabled = true;
    el('dialogConfirm').textContent = '처리 중…';
    let postChanged = false, filesPending = false;
    try {
      if (modal.action !== 'resolve') {
        const result = await api.moderate({postId: modal.item.id, decision: modal.action, reason: reason.text,
          ...(modal.item.status ? {expectedStatus: modal.item.status} : {}),
          ...(modal.action === 'delete' && el('contributionRevocation').checked ? {revokeContribution: true} : {})});
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
    for (const [id, active] of [['postsTab', state.view === 'posts'], ['reportsTab', state.view === 'reports'], ['operationsTab', state.view === 'operations']]) {
      el(id).classList.toggle('selected', active); el(id).setAttribute('aria-pressed', String(active));
    }
    el('postFilterField').hidden = state.view !== 'posts'; el('reportFilterField').hidden = state.view !== 'reports';
    el('moderationView').hidden = state.view === 'operations';
    el('operationsView').hidden = state.view !== 'operations';
    el('featureNotice').hidden = state.view === 'operations';
  }
  function setView(view) {
    if (state.busy || !state.authorized) return;
    state.view = view;
    viewControls();
    void loadItems();
  }
  el('postsTab').addEventListener('click', () => setView('posts'));
  el('reportsTab').addEventListener('click', () => setView('reports'));
  el('operationsTab').addEventListener('click', () => setView('operations'));
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
      reports: callable('communityAdminReports'), operations: callable('communityAdminOperations'), media: callable('communityAdminMedia'),
      moderate: callable('communityModeratePost'), resolve: callable('communityAdminResolveReport')}});
}

if (typeof document !== 'undefined' && document.getElementById('community-admin-root')) {
  startFirebase().catch(() => {
    document.getElementById('pageStatus').textContent = '관리자 도구를 연결하지 못했습니다. 잠시 후 다시 열어 주세요.';
    const notice = document.getElementById('errorNotice'); notice.textContent = '관리 서버와 네트워크 연결을 확인해 주세요.'; notice.hidden = false;
  });
}
