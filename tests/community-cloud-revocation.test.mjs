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

test('cloud revocation control is explicit and optional in real dialog HTML', async () => {
  const html = await readFile(new URL('../community-admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="contributionRevocationField"[^>]*hidden/);
  assert.match(html, /id="contributionRevocation" type="checkbox"/);
  assert.match(html, /단순 정리·만료 파일 삭제라면 선택하지 마세요/);
});
test('ordinary operator deletion preserves earned clouds by omitting the flag', async () => {
  const f = fixture(); await f.user({fixture:'operator'});
  await f.button('삭제').emit('click');
  assert.equal(f.node('contributionRevocation').checked,false);
  assert.equal(f.node('contributionRevocationField').hidden,false);
  f.node('reviewReason').value='만료 미디어 정리';
  f.node('deleteConfirmation').checked=true;
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate.length,1);
  assert.equal('revokeContribution' in f.calls.moderate[0],false);
  f.mount.destroy();
});
test('confirmed violation deletion binds explicit revocation and the operator reason', async () => {
  const f = fixture(); await f.user({fixture:'operator'});
  await f.button('삭제').emit('click');
  f.node('reviewReason').value='권리 침해 확인';
  f.node('deleteConfirmation').checked=true;
  f.node('contributionRevocation').checked=true;
  await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate[0].revokeContribution,true);
  assert.equal(f.calls.moderate[0].reason,'권리 침해 확인');
  assert.equal(f.calls.moderate[0].decision,'delete');
  assert.equal(f.node('contributionRevocation').disabled,true);
  f.mount.destroy();
});
test('cancel and a different action clear the destructive points option', async () => {
  const f = fixture(); await f.user({fixture:'operator'});
  await f.button('삭제').emit('click');
  f.node('contributionRevocation').checked=true;
  await f.node('dialogCancel').emit('click');
  await f.button('비공개 전환').emit('click');
  assert.equal(f.node('contributionRevocation').checked,false);
  assert.equal(f.node('contributionRevocationField').hidden,true);
  f.node('reviewReason').value='확인하는 동안 비공개';
  await f.node('reviewForm').emit('submit');
  assert.equal('revokeContribution' in f.calls.moderate[0],false);
  f.mount.destroy();
});
test('logged-out dialogs cannot send a revocation request', async () => {
  const f = fixture(); await f.user({fixture:'operator'});
  await f.button('삭제').emit('click');
  f.node('reviewReason').value='권리 침해 확인';
  f.node('deleteConfirmation').checked=true;
  f.node('contributionRevocation').checked=true;
  await f.user(null); await f.node('reviewForm').emit('submit');
  assert.equal(f.calls.moderate.length,0);
  f.mount.destroy();
});
