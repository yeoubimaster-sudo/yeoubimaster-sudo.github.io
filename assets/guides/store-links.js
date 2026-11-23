(function () {
  'use strict';
  var IOS = 'https://apps.apple.com/kr/app/id6762339060';
  var ANDROID = 'https://play.google.com/store/apps/details?id=com.yeoubi.bonunnalssi2';
  var pages = {'/': 'home', '/cctv/': 'cctv', '/weather-widget/': 'widget', '/vamonos/': 'vamonos', '/guide/': 'guide', '/download/': 'download', '/business/': 'business', '/iphone-weather-widget/': 'iphone_widget', '/android-weather-widget/': 'android_widget', '/rain-radar/': 'radar', '/traffic-cctv/': 'traffic', '/camping-weather/': 'camping'};
  var page = pages[window.location.pathname] || 'website';
  // Public App Store provider token generated in the real console on 2026-11-11.
  // This token identifies the developer, and is not an authentication secret.
  var APPLE_PROVIDER = '128776318';
  var channels = {instagram: 'ig', youtube: 'yt', threads: 'th', naver: 'nv', kakao: 'ka'};
  var clips = ['01', '02', '03', '04', '05', '06', 'profile', 'poster'];
  var query = new URLSearchParams(window.location.search || '');
  var src = query.get('src');
  var clip = query.get('clip');
  var social = Object.prototype.hasOwnProperty.call(channels, src) && clips.indexOf(clip) !== -1;
  // Only a finite source label is passed to the stores. Never retain or forward
  // a referring URL, search term, chat ID, user ID, cookie or browser storage.
  // Missing referrers remain unattributed; this is not proof of an AI citation.
  var referrals = {
    chatgpt: ['cg', 'ai'], perplexity: ['px', 'ai'], gemini: ['gm', 'ai'],
    copilot: ['cp', 'ai'], claude: ['cl', 'ai'],
    google: ['gg', 'se'], bing: ['bg', 'se'], naver: ['nv', 'se']
  };
  var hosts = {
    'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt',
    'perplexity.ai': 'perplexity', 'www.perplexity.ai': 'perplexity',
    'gemini.google.com': 'gemini', 'copilot.microsoft.com': 'copilot',
    'claude.ai': 'claude', 'www.google.com': 'google', 'www.google.co.kr': 'google',
    'www.bing.com': 'bing', 'search.naver.com': 'naver', 'm.search.naver.com': 'naver'
  };
  var via = query.get('via');
  if (!Object.prototype.hasOwnProperty.call(referrals, via)) via = null;
  try {
    var ref = new URL(document.referrer || '');
    if (ref.protocol === 'https:' && Object.prototype.hasOwnProperty.call(hosts, ref.hostname)) via = hosts[ref.hostname];
  } catch (_) { /* Empty or unavailable referrer is a normal visit. */ }
  var referral = via && referrals[via];
  var campaign = social ? 'bn261111_' + channels[src] + '_' + clip : referral ? 'bn261123_' + referral[1] + '_' + referral[0] + '_' + page : 'bn261111_web_' + page;
  var sourceName = social ? src : referral ? via : 'yeoubi.ai.kr';
  var medium = social ? 'social' : referral ? (referral[1] === 'ai' ? 'ai_referral' : 'search_referral') : 'website';
  function placementName(value) {
    return ['hero', 'bottom', 'footer', 'header', 'link', 'qr_redirect', 'download'].indexOf(value) !== -1 ? value : 'link';
  }
  function url(store, placement) {
    if (store !== 'android') {
      var apple = new URL(IOS);
      apple.searchParams.set('pt', APPLE_PROVIDER);
      apple.searchParams.set('ct', campaign);
      apple.searchParams.set('mt', '8');
      return apple.toString();
    }
    var target = new URL(ANDROID);
    target.searchParams.set('utm_source', sourceName);
    target.searchParams.set('utm_campaign', campaign);
    var referrer = new URLSearchParams({utm_source: sourceName, utm_medium: medium, utm_campaign: campaign, utm_content: page + '_' + placementName(placement || 'link')});
    target.searchParams.set('referrer', referrer.toString());
    return target.toString();
  }
  window.BonunStoreLinks = {url: url, campaign: campaign};
  function decorate() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href) return;
      // Preserve only finite public campaign labels while navigating guides.
      // Never persist a browser identifier, arbitrary query value, or fragment.
      if ((social || referral) && href.charAt(0) === '/' && href.charAt(1) !== '/') {
        var internal = new URL(href, 'https://yeoubi.ai.kr');
        if (Object.prototype.hasOwnProperty.call(pages, internal.pathname)) {
          if (social) {
            internal.searchParams.set('src', src);
            internal.searchParams.set('clip', clip);
          } else {
            internal.searchParams.set('via', via);
          }
          a.href = internal.pathname + internal.search + internal.hash;
        }
        return;
      }
      if (href.indexOf(IOS) !== 0 && href.indexOf(ANDROID) !== 0) return;
      var store = href.indexOf(ANDROID) === 0 ? 'android' : 'ios';
      var section = a.closest('section');
      var placement = a.getAttribute('data-placement') || (section && section.id) || 'hero';
      a.href = url(store, placement);
      a.dataset.store = store;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
}());
