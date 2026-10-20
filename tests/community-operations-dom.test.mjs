import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Self-contained fake DOM/auth/RPC fixture. No Firebase SDK, live token or API.
const source = await readFile(new URL('../community-admin.js', import.meta.url), 'utf8');
const {mountCommunityAdmin, normalizeOperations, operationAmount} = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
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
  async emit(name) { return Promise.all((this.events.get(name) || []).map(handler => handler({preventDefault() {}}))); }
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
    if (!this.nodes.has(id)) this.nodes.set(id, new Element(id === 'operationsContent' ? 'section' : 'div'));
    return this.nodes.get(id);
  }
  createElement(tag) { return new Element(tag); }
}
const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const fixtureTime = Date.parse('2026-10-20T05:00:00Z');
const queueKeys = ['openReports', 'failedPosts', 'processingPosts', 'rawCleanupPending', 'cleanupDue'];
function operationsFixture() {
  const period = (from, to, timeZone) => ({key: 'fixture', fromMs: Date.parse(from), toMs: Date.parse(to), timeZone});
  const metric = (used, limit, unit, period) => ({state: 'ok', used, limit, unit, period});
  return {schemaVersion: 1, serverNowMs: fixtureTime,
    queues: Object.fromEntries(queueKeys.map((key, i) => [key, {state: 'ok', count: i, hasMore: false, limit: 50}])),
    usage: {periods: {
      dayUtc: period('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', 'UTC'),
      monthUtc: period('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 'UTC'),
      dayKst: period('2026-10-19T15:00:00Z', '2026-10-20T15:00:00Z', 'Asia/Seoul')},
    metrics: {dailyUploads: metric(12, 200, 'count', 'dayUtc'), dailyUploadBytes: metric(123456, 1048576, 'bytes', 'dayUtc'),
      monthlyUploads: metric(120, 2000, 'count', 'monthUtc'), monthlyUploadBytes: metric(1234567, 10485760, 'bytes', 'monthUtc'),
      dailyReadRequests: metric(123, 5000, 'count', 'dayUtc'), dailyWatchAttempts: metric(5, 10000, 'count', 'dayKst')}},
    workers: {watch: {state: 'ok', lastRun: {startedAtMs: fixtureTime - 60000, finishedAtMs: fixtureTime - 10000,
      outcome: 'ok', stale: false, counts: {eventPages: 2, candidates: 7, sendAttempts: 3, sent: 2, sendFailures: 1,
        queryFailures: 0, eventFailures: 0, inboxFailures: 0, uncertain: 0, cleaned: 1}}},
      purge: {state: 'ok', lastRun: {startedAtMs: fixtureTime - 60000, finishedAtMs: fixtureTime - 15000,
        outcome: 'partial', stale: false, counts: {rawCandidates: 5, postCandidates: 7, rawFailures: 1, postFailures: 0}}}}};
}
function fixture(options = {}) {
  const document = new Document(), calls = [], auth = {currentUser: null};
  document.getElementById('postStatus').value = 'published'; document.getElementById('reportStatus').value = 'open';
  let change;
  const api = Object.fromEntries(['overview', 'reports', 'list', 'operations', 'moderate', 'resolve', 'media'].map(name =>
    [name, async data => {
      calls.push({name, data});
      if (options.api?.[name]) return options.api[name](data);
      if (name === 'overview') return {isAdmin: true, config: {enabled: true, reviewPolicy: 'auto_publish', manualReviewRequired: false, paidModerationEnabled: false}};
      if (name === 'operations') return operationsFixture();
      if (name === 'reports' || name === 'list') return {items: [], serverNowMs: fixtureTime};
      throw Error('Unexpected mutation/media request in a read-only fixture');
    }]));
  const mount = mountCommunityAdmin({document, api, auth, login: async () => {}, logout: options.logout || (async () => {}),
    onAuthStateChanged(_, callback) { change = callback; callback(null); return () => {}; }});
  return {document, calls, mount, node: id => document.getElementById(id),
    async user(user) { auth.currentUser = user; change(user); await flush(); },
    async operations() { await document.getElementById('operationsTab').emit('click'); await flush(); },
    get content() { return document.getElementById('operationsContent').textContent; }};
}

test('signed-out and non-admin views never call the operations endpoint', async () => {
  for (const signedIn of [false, true]) {
    const f = fixture({api: {overview: async () => ({isAdmin: false})}});
    if (signedIn) await f.user({fixture: 'not-admin'});
    await f.operations();
    assert.equal(f.calls.filter(c => c.name === 'operations').length, 0);
    assert.equal(f.node('workspace').hidden, true); f.mount.destroy();
  }
});

test('operations load only on explicit tab and never mutate or automatically refresh', async () => {
  const f = fixture(); await f.user({fixture: 'admin'});
  assert.equal(f.calls.filter(c => c.name === 'operations').length, 0);
  await f.operations();
  assert.equal(f.calls.filter(c => c.name === 'operations').length, 1);
  assert.equal(f.node('moderationView').hidden, true); assert.equal(f.node('operationsView').hidden, false);
  assert.equal(f.node('operationsTab').attributes.get('aria-pressed'), 'true');
  assert.match(f.content, /FCM 접수 성공/); assert.match(f.content, /실제 기기 수신 완료.*아닙니다/);
  assert.match(f.node('operationsStatus').textContent, /수동 새로고침/);
  await f.document.emit('visibilitychange'); await flush();
  assert.equal(f.calls.filter(c => c.name === 'operations').length, 1);
  assert.deepEqual(f.calls.filter(c => !['overview', 'reports', 'operations'].includes(c.name)), []);
  f.mount.destroy();
});

test('bounded fifty-plus queues are labeled separately and never presented as a summed total', async () => {
  const value = operationsFixture(); value.queues.openReports = {state: 'ok', count: 50, hasMore: true, limit: 50};
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /50\+/); assert.match(f.content, /최대 50개까지/);
  assert.match(f.content, /과거 실패 이력/); assert.match(f.content, /만료·삭제·실패·미완료/);
  assert.match(f.node('operationsNotice').textContent, /합산하지 않습니다/); f.mount.destroy();
});

test('partial query failure shows unknown rather than fabricated zero while retaining valid sections', async () => {
  const value = operationsFixture(); value.queues.openReports = {state: 'unavailable', count: null, hasMore: false, limit: 50};
  value.usage.metrics.dailyReadRequests = {state: 'unavailable', used: null, limit: null, unit: 'count', period: 'dayUtc'};
  value.workers.purge = {state: 'unavailable', lastRun: null};
  const parsed = normalizeOperations(value);
  assert.equal(parsed.queues.openReports.count, null); assert.equal(parsed.usage.metrics.dailyReadRequests.used, null);
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.node('operationsNotice').textContent, /^3개 항목/); assert.match(f.content, /0개라는 뜻이 아닙니다/);
  assert.match(f.content, /관측 조회 실패/); assert.match(f.content, /FCM 접수 성공/); f.mount.destroy();
});

test('missing run and unavailable run remain distinct and do not claim successful zero sends', async () => {
  const value = operationsFixture(); value.workers.watch = {state: 'missing', lastRun: null}; value.workers.purge = {state: 'unavailable', lastRun: null};
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /아직 기록이 없어요/); assert.match(f.content, /실행 기록을 확인하지 못/);
  assert.match(f.content, /정상 실행이나 실패 0건으로 판단하지 않습니다/); assert.doesNotMatch(f.content, /FCM 접수 성공/); f.mount.destroy();
});

test('stale and partially failed worker observations identify their age and outcome', async () => {
  const value = operationsFixture(); value.workers.watch.lastRun.stale = true; value.workers.watch.lastRun.outcome = 'partial';
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /20분 이상 지난 기록/); assert.match(f.content, /일부 처리 실패/); assert.match(f.content, /최근 1회/); f.mount.destroy();
});

test('usage time windows distinguish UTC upload/read and Korea-day watch attempts', async () => {
  const f = fixture(); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /UTC 기준 \(한국 09시 경계\)/); assert.match(f.content, /한국 월초 09시 경계/);
  assert.match(f.content, /한국시간 00시 경계/); assert.match(f.content, /실제 저장량·고유 이용자 수·수신 완료·청구 금액을 뜻하지 않습니다/); f.mount.destroy();
});

test('over-limit quantities remain visible while only progress is clamped', async () => {
  const value = operationsFixture(); value.usage.metrics.dailyUploads.used = 12345; value.usage.metrics.dailyUploads.limit = 10;
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /12,345/); assert.match(f.content, /설정 한도를 초과/);
  assert.equal(f.node('operationsContent').querySelectorAll('progress')[0].value, 100); f.mount.destroy();
});

test('unknown limits show settings warning and no invented denominator', async () => {
  const value = operationsFixture(); value.usage.metrics.dailyUploads.limit = null;
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.match(f.content, /한도 설정 확인 필요/); assert.equal(f.node('operationsContent').querySelectorAll('progress').length, 5); f.mount.destroy();
});

test('malformed per-section values are unknown and unrecognized markup never reaches an HTML sink', async () => {
  const value = operationsFixture(), payload = '<img src=x onerror=alert(1)>';
  value.queues.openReports.count = payload; value.usage.periods.dayUtc.key = payload;
  value.usage.metrics.monthlyUploads.used = -1; value.workers.watch.lastRun.counts.sent = payload;
  value.queues.unknown = payload; value.workers.purge.lastRun.outcome = payload;
  const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
  assert.doesNotMatch(f.content, /<img|onerror/); assert.match(f.node('operationsNotice').textContent, /^4개 항목/);
  assert.equal(f.node('operationsContent').querySelectorAll('img, video').length, 0);
  assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML|document\.write\b|console\.(?:log|error|warn)\s*\(/); f.mount.destroy();
});

test('invalid schema or missing server time cannot render an apparently successful dashboard', async () => {
  for (const value of [{schemaVersion: 2}, {schemaVersion: 1, serverNowMs: null}]) {
    const f = fixture({api: {operations: async () => value}}); await f.user({fixture: 'admin'}); await f.operations();
    assert.equal(f.content, ''); assert.match(f.node('operationsStatus').textContent, /확인하지 못/);
    assert.equal(f.node('errorNotice').hidden, false); f.mount.destroy();
  }
});

test('A-B-A auth change clears visible data and discards an older pending result', async () => {
  const pending = deferred(); let requests = 0;
  const f = fixture({api: {operations: () => ++requests === 1 ? pending.promise : Promise.resolve(operationsFixture())}});
  await f.user({fixture: 'admin-a'}); await f.operations();
  await f.user({fixture: 'admin-b'}); await f.user({fixture: 'admin-a'});
  assert.equal(f.content, '');
  pending.resolve(operationsFixture()); await flush();
  assert.equal(f.content, ''); assert.equal(f.node('operationsView').hidden, true); f.mount.destroy();
});

test('changing view discards delayed operations and preserves the posts and reports paths', async () => {
  const pending = deferred(), f = fixture({api: {operations: () => pending.promise}});
  await f.user({fixture: 'admin'}); await f.operations();
  await f.node('postsTab').emit('click'); await flush();
  pending.resolve(operationsFixture()); await flush();
  assert.equal(f.content, ''); assert.equal(f.node('operationsView').hidden, true);
  assert.equal(f.node('moderationView').hidden, false); assert.equal(f.calls.filter(c => c.name === 'list').length, 1);
  await f.node('reportsTab').emit('click'); await flush(); assert.equal(f.calls.filter(c => c.name === 'reports').length, 2); f.mount.destroy();
});

test('manual refresh rechecks administrator permission before refreshing current operations tab', async () => {
  const f = fixture(); await f.user({fixture: 'admin'}); await f.operations();
  await f.node('refreshButton').emit('click'); await flush();
  assert.equal(f.calls.filter(c => c.name === 'overview').length, 2);
  assert.equal(f.calls.filter(c => c.name === 'operations').length, 2);
  const names = f.calls.map(c => c.name); assert.deepEqual(names.slice(-2), ['overview', 'operations']); f.mount.destroy();
});

test('permission loss locks the workspace and removes prior operation values', async () => {
  const f = fixture({api: {operations: async () => { throw {code: 'permission-denied'}; }}});
  await f.user({fixture: 'admin'}); await f.operations();
  assert.equal(f.node('workspace').hidden, true); assert.equal(f.content, '');
  assert.match(f.node('errorNotice').textContent, /관리 권한/); f.mount.destroy();
});

test('logout clears operations before SDK completion and ignores an in-flight response', async () => {
  const pending = deferred(), logout = deferred();
  const f = fixture({logout: () => logout.promise, api: {operations: () => pending.promise}});
  await f.user({fixture: 'admin'}); await f.operations();
  const leaving = f.node('logoutButton').emit('click'); await flush();
  assert.equal(f.content, ''); assert.equal(f.node('workspace').hidden, true);
  pending.resolve(operationsFixture()); await flush(); assert.equal(f.content, '');
  logout.resolve(); await leaving; f.mount.destroy();
});

test('destroy invalidates an operation response and all quantities reject unsafe numbers', async () => {
  const pending = deferred(), f = fixture({api: {operations: () => pending.promise}});
  await f.user({fixture: 'admin'}); await f.operations(); f.mount.destroy(); pending.resolve(operationsFixture()); await flush();
  assert.equal(f.content, '');
  for (const value of [null, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '0']) assert.equal(operationAmount(value), '확인하지 못함');
  assert.equal(operationAmount(1024, 'bytes'), '1 KiB (1,024 B)');
});
