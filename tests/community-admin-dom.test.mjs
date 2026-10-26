import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../community-admin.js', import.meta.url), 'utf8');
const {mountCommunityAdmin} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.events = new Map(); this.attributes = new Map();
    this.hidden = false; this.disabled = false; this.value = ''; this.open = false; this._text = '';
    this.classList = {toggle() {}};
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
  addEventListener(name, handler) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(handler);
  }
  async emit(name) {
    const event = {preventDefault() {}};
    return Promise.all((this.events.get(name) || []).map(handler => handler(event)));
  }
  querySelectorAll(selectors) {
    const tags = selectors.split(',').map(tag => tag.trim().toUpperCase());
    return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selectors)]);
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  pause() {}
  load() {}
}
class Document extends Element {
  constructor() { super(); this.nodes = new Map(); this.hidden = false; }
  getElementById(id) {
    if (!this.nodes.has(id)) this.nodes.set(id, new Element(id === 'items' ? 'section' : 'div'));
    return this.nodes.get(id);
  }
  createElement(tag) { return new Element(tag); }
}
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const config = {enabled: true, reviewPolicy: 'auto_publish', manualReviewRequired: false, paidModerationEnabled: false};
const post = () => ({id: 'post-fixture', status: 'published', placeLabel: '신고 테스트 장소', caption: '<img src=x onerror=alert(1)>',
  mediaType: 'image', tags: ['날씨'], expiresAtMs: Date.now() + 60000});
const report = (postStatus = 'published') => ({id: 'report-fixture', postId: 'post-fixture', status: 'open',
  postStatus, reason: 'privacy', details: '<img src=x onerror=alert(1)>', createdAtMs: Date.now()});
function fixture(overrides = {}) {
  const document = new Document();
  document.getElementById('postStatus').value = 'published';
  document.getElementById('reportStatus').value = 'open';
  const calls = {overview: 0, list: 0, reports: [], moderate: [], resolve: [], logout: 0, media: 0};
  const auth = {currentUser: null};
  let change;
  const api = {
    overview: async () => { calls.overview++; return {isAdmin: true, config}; },
    list: async () => { calls.list++; return {serverNowMs: Date.now(), items: [post()], nextCursor: null}; },
    reports: async data => { calls.reports.push(data); return {items: [report()], serverNowMs: Date.now()}; },
    media: async () => { calls.media++; return {url: 'https://storage.googleapis.com/fixture/preview.jpg', mediaType: 'image', expiresAtMs: Date.now() + 60000}; },
    moderate: async data => { calls.moderate.push(data); return {ok: true, status: ({hide: 'hidden', delete: 'deleted', restore: 'published', approve: 'published'})[data.decision]}; },
    resolve: async data => { calls.resolve.push(data); return {ok: true}; }, ...overrides.api
  };
  const mount = mountCommunityAdmin({document, api, auth, login: async () => {},
    logout: async () => { calls.logout++; if (overrides.logout) return overrides.logout(); },
    onAuthStateChanged(_auth, callback) { change = callback; callback(null); return () => {}; }});
  return {document, calls, mount, auth,
    async user(value) { auth.currentUser = value; change(value); await flush(); },
    node(id) { return document.getElementById(id); },
    button(label) { return document.getElementById('items').querySelectorAll('button').find(node => node.textContent === label); }};
}

test('signed-out UI never requests private lists and keeps workspace locked', async () => {
  const f = fixture(); await flush();
  assert.equal(f.node('workspace').hidden, true);
  await f.node('refreshButton').emit('click'); await flush();
  assert.equal(f.calls.overview, 0); assert.equal(f.calls.list, 0);
  assert.equal(f.calls.reports.length, 0);
  assert.equal(f.node('loginPanel').hidden, false); f.mount.destroy();
});

test('a signed-in non-admin is rejected before any private list is requested', async () => {
  const f = fixture({api: {overview: async () => ({isAdmin: false})}});
  await f.user({fixture: 'unprivileged'});
  assert.equal(f.calls.list, 0); assert.equal(f.node('workspace').hidden, true);
  assert.equal(f.calls.reports.length, 0);
  assert.match(f.node('errorNotice').textContent, /관리 권한/); f.mount.destroy();
});

test('authorized default is open reports, private text stays plain, and automatic publication has no approval button', async () => {
  const f = fixture({api: {overview: async () => ({isAdmin: true, config: {...config, enabled: false}})}});
  await f.user({fixture: 'admin'});
  assert.equal(f.node('workspace').hidden, false);
  assert.match(f.node('items').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(f.node('items').querySelectorAll('img').length, 0);
  assert.equal(f.calls.list, 0); assert.deepEqual(f.calls.reports, [{state: 'open', limit: 20}]);
  assert.equal(f.node('listHeading').textContent, '미처리 신고');
  assert.equal(f.node('postFilterField').hidden, true);
  assert.equal(f.button('승인'), undefined);
  assert.equal(f.node('reviewDialog').open, false); assert.equal(f.calls.moderate.length, 0); f.mount.destroy();
});

test('confirmation sends expected status once and blocks duplicate submission', async () => {
  const pending = deferred();
  const f = fixture({api: {moderate: data => { f.calls.moderate.push(data); return pending.promise; }}});
  await f.user({fixture: 'admin'}); await f.button('비공개 전환').emit('click');
  assert.equal(f.node('reviewDialog').open, true);
  f.node('reviewReason').value = '검토 완료';
  const first = f.node('reviewForm').emit('submit'); await flush();
  await f.node('reviewForm').emit('submit');
  assert.deepEqual(f.calls.moderate, [{postId: 'post-fixture', decision: 'hide', reason: '검토 완료', expectedStatus: 'published'}]);
  pending.resolve({ok: true, status: 'hidden'}); await first; await flush();
  assert.deepEqual(f.calls.resolve, [{reportId: 'report-fixture', resolutionNote: '비공개 전환: 검토 완료'}]);
  assert.equal(f.node('reviewDialog').open, false); f.mount.destroy();
});

test('logout clears private rows before SDK completion and late rows cannot return', async () => {
  const pendingList = deferred(), pendingLogout = deferred();
  const f = fixture({api: {reports: () => pendingList.promise}, logout: () => pendingLogout.promise});
  await f.user({fixture: 'admin'});
  const logout = f.node('logoutButton').emit('click'); await flush();
  assert.equal(f.node('workspace').hidden, true); assert.equal(f.node('items').children.length, 0);
  pendingList.resolve({items: [report()]}); await flush();
  assert.equal(f.node('items').children.length, 0); assert.equal(f.node('workspace').hidden, true);
  pendingLogout.resolve(); await logout; f.mount.destroy();
});

test('leaving the page discards both visible media and an in-flight preview', async () => {
  const pending = deferred(); let count = 0;
  const f = fixture({api: {media: async () => {
    count++;
    if (count === 2) return pending.promise;
    return {url: 'https://storage.googleapis.com/fixture/preview.jpg', mediaType: 'image', expiresAtMs: Date.now() + 60000};
  }}});
  await f.user({fixture: 'admin'}); await f.button('사진·영상 확인').emit('click'); await flush();
  assert.equal(f.node('items').querySelectorAll('img').length, 1);
  f.document.hidden = true; await f.document.emit('visibilitychange');
  assert.equal(f.node('items').querySelectorAll('img').length, 0);
  f.document.hidden = false; const loading = f.button('사진·영상 확인').emit('click'); await flush();
  f.document.hidden = true; await f.document.emit('visibilitychange');
  pending.resolve({url: 'https://storage.googleapis.com/fixture/late.jpg', mediaType: 'image', expiresAtMs: Date.now() + 60000});
  await loading; await flush(); assert.equal(f.node('items').querySelectorAll('img').length, 0); f.mount.destroy();
});

test('automatic publication notice starts with reports and never loads an approval queue', async () => {
  const f = fixture(); await f.user({fixture: 'admin'});
  assert.match(f.node('featureNotice').textContent, /바로 공개/);
  assert.match(f.node('featureNotice').textContent, /사전 승인은 하지 않/);
  assert.equal(f.calls.list, 0);
  assert.equal(f.button('승인'), undefined); f.mount.destroy();
});

test('keeping a reported post public resolves only the selected report and preserves the note', async () => {
  const f = fixture(); await f.user({fixture: 'admin'});
  await f.button('공개 유지 · 신고 처리 완료').emit('click');
  assert.match(f.node('dialogDescription').textContent, /현재 공개 상태를 유지/);
  f.node('reviewReason').value = '현장 내용 확인, 문제 없음';
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate.length, 0);
  assert.deepEqual(f.calls.resolve, [{reportId: 'report-fixture', resolutionNote: '현장 내용 확인, 문제 없음'}]);
  f.mount.destroy();
});

test('delete requires both a meaningful reason and a separate irreversible-deletion acknowledgement', async () => {
  const f = fixture(); await f.user({fixture: 'admin'});
  await f.button('삭제').emit('click');
  assert.equal(f.node('deleteConfirmationField').hidden, false);
  assert.equal(f.node('deleteConfirmation').required, true);
  assert.equal(f.node('deleteConfirmation').checked, false);
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate.length, 0);
  f.node('reviewReason').value = '노출된 개인정보 삭제';
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate.length, 0);
  assert.match(f.node('dialogError').textContent, /확인란/);
  f.node('deleteConfirmation').checked = true;
  await f.node('reviewForm').emit('submit');
  assert.deepEqual(f.calls.moderate, [{postId: 'post-fixture', decision: 'delete', reason: '노출된 개인정보 삭제', expectedStatus: 'published'}]);
  assert.deepEqual(f.calls.resolve, [{reportId: 'report-fixture', resolutionNote: '삭제: 노출된 개인정보 삭제'}]);
  f.mount.destroy();
});

test('a concurrent post change cannot silently resolve its report after moderation fails', async () => {
  const f = fixture({api: {moderate: async data => {
    f.calls.moderate.push(data); throw Object.assign(new Error('fixture'), {code: 'aborted'});
  }}});
  await f.user({fixture: 'admin'}); await f.button('비공개 전환').emit('click');
  f.node('reviewReason').value = '위치 정보 재확인 필요';
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.resolve.length, 0);
  assert.match(f.node('errorNotice').textContent, /다른 검토자/); f.mount.destroy();
});

test('post action success followed by report-save failure shows the two outcomes separately', async () => {
  let hidden = false;
  const f = fixture({api: {
    reports: async data => { f.calls.reports.push(data); return {items: [report(hidden ? 'hidden' : 'published')]}; },
    moderate: async data => { f.calls.moderate.push(data); hidden = true; return {ok: true, status: 'hidden'}; },
    resolve: async data => { f.calls.resolve.push(data); throw Object.assign(new Error('fixture'), {code: 'unavailable'}); }
  }});
  await f.user({fixture: 'admin'}); await f.button('비공개 전환').emit('click');
  f.node('reviewReason').value = '신고 확인 전 임시 비공개';
  await f.node('reviewForm').emit('submit');
  assert.match(f.node('errorNotice').textContent, /비공개 전환은 완료됐지만 신고 처리 완료를 저장하지 못/);
  assert.match(f.node('items').textContent, /운영자 비공개/);
  assert.equal(f.button('공개 유지 · 신고 처리 완료'), undefined);
  assert.ok(f.button('신고 처리 완료'));
  assert.equal(f.calls.moderate.length, 1); f.mount.destroy();
});

test('a hidden post is restored with its current status and without renewing its original expiry', async () => {
  const f = fixture({api: {list: async () => {
    f.calls.list++; return {items: [{...post(), status: 'hidden'}]};
  }}});
  await f.user({fixture: 'admin'}); await f.node('postsTab').emit('click'); await flush();
  await f.button('다시 공개').emit('click');
  assert.match(f.node('dialogDescription').textContent, /종료 시각은 늘어나지 않/);
  f.node('reviewReason').value = '신고 내용 해소 확인';
  await f.node('reviewForm').emit('submit');
  assert.deepEqual(f.calls.moderate, [{postId: 'post-fixture', decision: 'restore', reason: '신고 내용 해소 확인', expectedStatus: 'hidden'}]);
  assert.equal(f.calls.resolve.length, 0); f.mount.destroy();
});

test('an expired hidden row has no restoration action', async () => {
  const f = fixture({api: {list: async () => ({items: [{...post(), status: 'hidden', expiresAtMs: Date.now() - 1}]})}});
  await f.user({fixture: 'admin'}); await f.node('postsTab').emit('click'); await flush();
  assert.equal(f.button('다시 공개'), undefined);
  assert.match(f.node('items').textContent, /공개 만료/); f.mount.destroy();
});

test('an auth change between post action and report completion cannot resolve with another account', async () => {
  const pending = deferred();
  const f = fixture({api: {moderate: data => { f.calls.moderate.push(data); return pending.promise; }}});
  await f.user({fixture: 'admin'}); await f.button('비공개 전환').emit('click');
  f.node('reviewReason').value = '개인정보 확인';
  const submit = f.node('reviewForm').emit('submit'); await flush();
  await f.user(null);
  pending.resolve({ok: true, status: 'hidden'}); await submit; await flush();
  assert.equal(f.calls.resolve.length, 0);
  assert.equal(f.node('workspace').hidden, true); assert.equal(f.node('items').children.length, 0);
  f.mount.destroy();
});

test('a deleted post with deferred file cleanup is reported as blocked with cleanup pending', async () => {
  const f = fixture({api: {moderate: async data => {
    f.calls.moderate.push(data); return {ok: true, status: 'deleted', filesPending: true};
  }}});
  await f.user({fixture: 'admin'}); await f.button('삭제').emit('click');
  f.node('reviewReason').value = '신고된 개인정보 삭제'; f.node('deleteConfirmation').checked = true;
  await f.node('reviewForm').emit('submit');
  assert.match(f.node('pageStatus').textContent, /공개 차단.*파일 삭제는 재시도 중/);
  assert.equal(f.calls.resolve.length, 1); f.mount.destroy();
});
