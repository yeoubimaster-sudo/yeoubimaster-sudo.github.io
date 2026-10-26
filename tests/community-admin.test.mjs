import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../community-admin.js', import.meta.url), 'utf8');
const {safeMediaUrl, effectiveStatus, canApprove, canRestore, reviewPolicy, previewLifetime, reviewReason} =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('only direct HTTPS Google Storage media URLs can reach image/video elements', () => {
  for (const url of [null, {}, '', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>',
    'http://storage.googleapis.com/a', '//storage.googleapis.com/a',
    'https://storage.googleapis.com.attacker.example/a', 'https://attacker.example/a',
    'https://user:password@storage.googleapis.com/a', 'https://storage.googleapis.com:444/a',
    'https://storage.googleapis.com/a#fragment']) assert.equal(safeMediaUrl(url), null);
  const allowed = 'https://storage.googleapis.com/example/community/processed/photo.jpg?X-Goog-Signature=fixture';
  assert.equal(safeMediaUrl(allowed), allowed);
});

test('preview address lifetime never exceeds 60 seconds or revives an expired address', () => {
  assert.equal(previewLifetime(900000, 1000), 60000);
  assert.equal(previewLifetime(1300, 1000), 300);
  assert.equal(previewLifetime(999, 1000), 0);
  assert.equal(previewLifetime(undefined, 1000), 0);
  assert.equal(previewLifetime(Infinity, 1000), 0);
});

test('an old pending/published/hidden response is treated as expired at the decision moment', () => {
  assert.equal(effectiveStatus({status: 'pending_review', expiresAtMs: 100}, 101), 'expired');
  assert.equal(effectiveStatus({status: 'published', expiresAtMs: 100}, 100), 'expired');
  assert.equal(effectiveStatus({status: 'hidden', expiresAtMs: 100}, 100), 'expired');
  for (const status of ['rejected', 'deleted', 'failed']) {
    assert.equal(effectiveStatus({status, expiresAtMs: 100}, 101), status);
  }
});

test('hidden media can only be restored before the original deadline while service is enabled', () => {
  const ready = {enabled: true, reviewPolicy: 'auto_publish', manualReviewRequired: false, paidModerationEnabled: false};
  const item = {status: 'hidden', expiresAtMs: 200};
  assert.equal(canRestore(ready, item, 100), true);
  for (const config of [null, {}, {...ready, enabled: false}, {...ready, paidModerationEnabled: true}]) assert.equal(canRestore(config, item, 100), false);
  for (const expiresAtMs of [undefined, Infinity, 0, 99, 100]) assert.equal(canRestore(ready, {...item, expiresAtMs}, 100), false);
  assert.equal(canRestore(ready, {...item, status: 'deleted'}, 100), false);
});

test('policy notice distinguishes automatic publication from legacy manual review and unknown config', () => {
  assert.equal(reviewPolicy({reviewPolicy: 'auto_publish', manualReviewRequired: false}), 'auto_publish');
  assert.equal(reviewPolicy({reviewPolicy: 'manual_review', manualReviewRequired: true}), 'manual_review');
  assert.equal(reviewPolicy({manualReviewRequired: true}), 'manual_review');
  for (const config of [null, {}, {reviewPolicy: 'auto_publish'}, {reviewPolicy: 'invalid', manualReviewRequired: false}]) assert.equal(reviewPolicy(config), 'unknown');
});

test('missing/off/incomplete/nonmanual configuration cannot authorize publication', () => {
  const post = {status: 'pending_review', expiresAtMs: 200};
  for (const config of [undefined, {}, {enabled: false}, {enabled: true},
    {enabled: true, manualReviewRequired: false, paidModerationEnabled: false},
    {enabled: true, manualReviewRequired: true, paidModerationEnabled: true}]) {
    assert.equal(canApprove(config, post, 100), false);
  }
  const ready = {enabled: true, manualReviewRequired: true, paidModerationEnabled: false};
  assert.equal(canApprove(ready, post, 100), true);
  assert.equal(canApprove(ready, post, 200), false);
  assert.equal(canApprove(ready, {...post, status: 'processing'}, 100), false);
  assert.equal(canApprove(ready, {...post, status: 'published'}, 100), false);
});

test('rejection/takedown reasons require meaningful text and enforce Unicode length', () => {
  assert.equal(reviewReason('   ', true).valid, false);
  assert.equal(reviewReason('', false).valid, true);
  assert.equal(reviewReason(' 현장 사진과 설명 불일치 ', true).text, '현장 사진과 설명 불일치');
  assert.equal(reviewReason('구'.repeat(301)).valid, false);
  assert.equal(reviewReason('☁️'.repeat(150)).valid, true);
  assert.equal(reviewReason('구름', true).text, '구름');
});

test('private user content has no HTML-evaluation or raw error/identity logging sink', () => {
  assert.doesNotMatch(source, /\.innerHTML\b|insertAdjacentHTML|document\.write\b|\beval\s*\(/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn|debug|info)\s*\(/);
  // expectedUid is sent only to the authenticated server, never rendered or logged.
  assert.doesNotMatch(source.replace('expectedUid: state.user.uid', ''), /user\.email|user\.uid|error\.message|error\.details/);
  assert.match(source, /result\?\.isAdmin !== true/);
  assert.match(source, /expectedStatus: modal\.item\.status/);
});
