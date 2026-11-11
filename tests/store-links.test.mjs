import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../assets/guides/store-links.js', import.meta.url), 'utf8');
const qr = readFileSync(new URL('../download/index.html', import.meta.url), 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function environment(pathname, userAgent = '', maxTouchPoints = 0, search = '?email=private@example.invalid&token=secret-fixture') {
  const redirects = [], callbacks = [];
  const status = {};
  const context = {URL, URLSearchParams, navigator: {userAgent, maxTouchPoints}, window: {location: {pathname, search, replace: u => redirects.push(u)}}, document: {readyState: 'loading', addEventListener: (_, cb) => callbacks.push(cb), getElementById: () => status, querySelectorAll: () => []}};
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
test('Apple uses the actual console-generated provider and a finite campaign on the official app', () => {
  const {context} = environment('/vamonos/');
  const u = new URL(context.window.BonunStoreLinks.url('ios','hero'));
  assert.equal(u.origin + u.pathname, 'https://apps.apple.com/kr/app/id6762339060');
  assert.equal(u.searchParams.get('pt'), '128776318');
  assert.equal(u.searchParams.get('ct'), 'bn261111_web_vamonos');
  assert.equal(u.searchParams.get('mt'), '8');
});
test('the existing QR route redirects iPhone and iPad to Apple, Android to the same app, and leaves desktop selectable', () => {
  for (const [ua, touch, expected] of [['iPhone',0,'apps.apple.com'], ['Macintosh',5,'apps.apple.com'], ['Android',0,'play.google.com'], ['Macintosh',0,null]]) {
    const e = environment('/download/', ua, touch); vm.runInContext(qr,e.context);
    assert.equal(e.redirects.length, expected ? 1 : 0);
    if(expected) assert.equal(new URL(e.redirects[0]).hostname,expected);
    if(expected === 'play.google.com') assert.equal(new URLSearchParams(new URL(e.redirects[0]).searchParams.get('referrer')).get('utm_content'),'download_qr_redirect');
  }
});

test('each of the six creatives retains its channel on both stores', () => {
  for (const [src, short] of Object.entries({instagram:'ig',youtube:'yt',threads:'th',naver:'nv',kakao:'ka'})) {
    for (let i=1;i<=6;i++) {
      const clip=String(i).padStart(2,'0');
      const {context}=environment('/download/','',0,'?src='+src+'&clip='+clip+'&email=private@example.invalid');
      const expected='bn261111_'+short+'_'+clip;
      const android=new URL(context.window.BonunStoreLinks.url('android','qr_redirect'));
      const apple=new URL(context.window.BonunStoreLinks.url('ios','qr_redirect'));
      assert.equal(apple.searchParams.get('ct'),expected);
      assert.equal(android.searchParams.get('utm_campaign'),expected);
      const ref=new URLSearchParams(android.searchParams.get('referrer'));
      assert.equal(ref.get('utm_campaign'),expected);
      assert.equal(ref.get('utm_source'),src);
      assert.equal(ref.get('utm_medium'),'social');
      assert.ok(!apple.href.includes('private'));
      assert.ok(!android.href.includes('private'));
      assert.ok(expected.length<=30);
    }
  }
});
test('invalid channel, clip and placement cannot exfiltrate arbitrary visitor data', () => {
  for (const search of ['?src=private@example.invalid&clip=01','?src=instagram&clip=secret-fixture','?src=__proto__&clip=01']) {
    const {context}=environment('/download/','',0,search);
    const u=new URL(context.window.BonunStoreLinks.url('android','private@example.invalid'));
    const ref=new URLSearchParams(u.searchParams.get('referrer'));
    assert.equal(ref.get('utm_source'),'yeoubi.ai.kr');
    assert.equal(ref.get('utm_content'),'download_link');
    assert.ok(!u.href.includes('private'));
    assert.ok(!u.href.includes('secret-fixture'));
  }
});
test('guide navigation preserves only an allowlisted source and creative', () => {
  const e=environment('/','',0,'?src=instagram&clip=03&token=secret-fixture');
  const anchors=['/vamonos/','/download/','https://unrelated.example/','/admin/'].map(href=>({href,dataset:{},getAttribute:k=>k==='href'?href:null,closest:()=>null}));
  e.context.document.querySelectorAll=()=>anchors;
  e.callbacks[0]();
  assert.equal(anchors[0].href,'/vamonos/?src=instagram&clip=03');
  assert.equal(anchors[1].href,'/download/?src=instagram&clip=03');
  assert.equal(anchors[2].href,'https://unrelated.example/');
  assert.equal(anchors[3].href,'/admin/');
});
