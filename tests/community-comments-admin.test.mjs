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


test('comment report deletes only the comment and then resolves the report', async () => {
  let deleted = null;
  const f = fixture({api: {
    reports: async () => ({items: [{...report(), commentId: 'comment-fixture', commentBody: '<script>bad</script>', commentStatus: 'published'}]}),
    deleteComment: async data => { deleted = data; return {ok: true}; }
  }});
  await f.user({uid: 'admin'});
  assert.match(f.node('items').textContent, /<script>bad<\/script>/);
  assert.equal(f.node('items').querySelectorAll('script').length, 0);
  assert.equal(f.button('비공개 전환'), undefined);
  await f.button('댓글 삭제').emit('click');
  f.node('reviewReason').value = '욕설 확인 후 댓글 삭제';
  await f.node('reviewForm').emit('submit');
  assert.deepEqual(deleted, {commentId: 'comment-fixture', expectedUid: 'admin'});
  assert.equal(f.calls.moderate.length, 0); assert.equal(f.calls.resolve.length, 1);
  f.mount.destroy();
});
test('account change during comment deletion cannot resolve another account report', async () => {
  const pending = deferred();
  const f = fixture({api: {
    reports: async () => ({items: [{...report(), commentId: 'comment-fixture', commentBody: '확인할 내용'}]}),
    deleteComment: () => pending.promise
  }});
  await f.user({uid: 'admin'}); await f.button('댓글 삭제').emit('click');
  f.node('reviewReason').value = '신고 확인';
  const submission = f.node('reviewForm').emit('submit'); await flush();
  await f.user(null); pending.resolve({ok: true}); await submission;
  assert.equal(f.calls.resolve.length, 0); assert.equal(f.node('workspace').hidden, true); f.mount.destroy();
});
test('expired comment report can resolve but cannot show or delete content', async () => {
  const f = fixture({api: {reports: async () => ({items: [{...report(), commentId: 'comment-fixture', commentBody: '', commentStatus: 'expired'}]})}});
  await f.user({uid: 'admin'}); assert.equal(f.button('댓글 삭제'), undefined);
  assert.ok(f.button('신고 처리 완료')); f.mount.destroy();
});
