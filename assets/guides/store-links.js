(function () {
  'use strict';
  var IOS = 'https://apps.apple.com/kr/app/id6762339060';
  var ANDROID = 'https://play.google.com/store/apps/details?id=com.yeoubi.bonunnalssi2';
  var pages = {'/': 'home', '/cctv/': 'cctv', '/weather-widget/': 'widget', '/vamonos/': 'vamonos', '/guide/': 'guide', '/download/': 'download', '/business/': 'business', '/iphone-weather-widget/': 'iphone_widget', '/android-weather-widget/': 'android_widget', '/rain-radar/': 'radar', '/traffic-cctv/': 'traffic', '/camping-weather/': 'camping'};
  var page = pages[window.location.pathname] || 'website';
  function url(store, placement) {
    if (store !== 'android') return IOS;
    var target = new URL(ANDROID);
    target.searchParams.set('utm_source', 'yeoubi.ai.kr');
    target.searchParams.set('utm_campaign', 'website_guides_v1');
    var referrer = new URLSearchParams({utm_source: 'yeoubi.ai.kr', utm_medium: 'website', utm_campaign: 'website_guides_v1', utm_content: page + '_' + (placement || 'link')});
    target.searchParams.set('referrer', referrer.toString());
    return target.toString();
  }
  window.BonunStoreLinks = {url: url};
  function decorate() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || (href.indexOf(IOS) !== 0 && href.indexOf(ANDROID) !== 0)) return;
      var store = href.indexOf(ANDROID) === 0 ? 'android' : 'ios';
      var section = a.closest('section');
      var placement = a.getAttribute('data-placement') || (section && section.id) || 'hero';
      a.href = url(store, placement);
      a.dataset.store = store;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
}());
