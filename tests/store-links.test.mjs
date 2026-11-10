import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../assets/guides/store-links.js', import.meta.url), 'utf8');
const qr = readFileSync(new URL('../download/index.html', import.meta.url), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function environment(pathname, userAgent = '', maxTouchPoints = 0) {
  const redirects = [], callbacks = [];
  const status = {};
  const context = {URL, URLSearchParams, navigator: {userAgent, maxTouchPoints}, window: {location: {pathname, search: '?email=private@example.invalid&token=secret-fixture', replace: u => redirects.push(u)}}, document: {readyState: 'loading', addEventListener: (_, cb) => callbacks.push(cb), getElementById: () => status, querySelectorAll: () => []}};
  vm.createContext(context); vm.runInContext(source, context);
  return {context, redirects, callbacks};
}
test('Android campaign links preserve the production app and encode finite page attribution without visitor query data', () => {
  for (const [path, content] of [['/cctv/', 'cctv_hero'], ['/weather-widget/', 'widget_hero'], ['/iphone-weather-widget/', 'iphone_widget_hero'], ['/android-weather-widget/', 'android_widget_hero'], ['/rain-radar/', 'radar_hero'], ['/traffic-cctv/', 'traffic_hero'], ['/camping-weather/', 'camping_hero'], ['/unknown/private@example.invalid', 'website_hero']]) {
    const {context} = environment(path);
    const u = new URL(context.window.BonunStoreLinks.url('android', 'hero'));
    assert.equal(u.origin, 'https://play.google.com');
    assert.equal(u.searchParams.get('id'), 'com.yeoubi.bonunnalssi2');
    const ref = new URLSearchParams(u.searchParams.get('referrer'));
    assert.equal(ref.get('utm_content'), content);
    assert.equal(ref.get('utm_source'), 'yeoubi.ai.kr');
    assert.equal(ref.get('utm_medium'), 'website');
    assert.ok(!u.href.includes('secret-fixture'));
    assert.ok(!u.href.includes('private'));
  }
});
test('Apple stays on its official app URL until a real App Store campaign token exists', () => {
  const {context} = environment('/vamonos/');
  assert.equal(context.window.BonunStoreLinks.url('ios','hero'), 'https://apps.apple.com/kr/app/id6762339060');
});
test('the existing QR route redirects iPhone and iPad to Apple, Android to the same app, and leaves desktop selectable', () => {
  for (const [ua, touch, expected] of [['iPhone',0,'apps.apple.com'], ['Macintosh',5,'apps.apple.com'], ['Android',0,'play.google.com'], ['Macintosh',0,null]]) {
    const e = environment('/download/', ua, touch); vm.runInContext(qr,e.context);
    assert.equal(e.redirects.length, expected ? 1 : 0);
    if(expected) assert.equal(new URL(e.redirects[0]).hostname,expected);
    if(expected === 'play.google.com') assert.equal(new URLSearchParams(new URL(e.redirects[0]).searchParams.get('referrer')).get('utm_content'),'download_qr_redirect');
  }
});
