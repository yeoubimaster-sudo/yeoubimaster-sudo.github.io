// Public-data house-ad reporting is deliberately separate from paid applications.
export function mountDiscoveryReport(functions, httpsCallable) {
  const report = httpsCallable(functions, 'getDiscoveryAdReport');
  const update = httpsCallable(functions, 'setDiscoveryAdState');
  const el = id => document.getElementById(id);
  const number = value => Number(value || 0).toLocaleString('ko-KR');
  const kinds = {festival: '축제', camping: '캠핑장', attraction: '관광지', house: '광고 모집'};
  let request = 0;
  async function load() {
    const generation = ++request;
    el('discoveryStatus').textContent = '집계를 불러오는 중…';
    el('discoveryRefresh').disabled = true;
    try {
      const {data} = await report({days: Number(el('discoveryDays').value)});
      if (generation !== request) return;
      const grouped = new Map();
      for (const row of data.rows || []) {
        const key = `${row.day}:${row.creativeId}`;
        const prior = grouped.get(key);
        grouped.set(key, prior ? {...prior, impressions: prior.impressions + row.impressions,
          clicks: prior.clicks + row.clicks, viewableClicks: prior.viewableClicks + row.viewableClicks} : {...row});
      }
      const rows = [...grouped.values()];
      const total = rows.reduce((a, r) => ({impressions: a.impressions + r.impressions,
        clicks: a.clicks + r.clicks, viewableClicks: a.viewableClicks + r.viewableClicks}), {impressions: 0, clicks: 0, viewableClicks: 0});
      el('discoveryImpressions').textContent = number(total.impressions);
      el('discoveryClicks').textContent = number(total.clicks);
      el('discoveryCtr').textContent = total.impressions ? `${(100 * total.viewableClicks / total.impressions).toFixed(2)}%` : '—';
      el('discoveryApi').textContent = `오늘 광고용 공공데이터 요청 · 축제/관광지 ${number(data.api.tour)} / ${number(data.api.tourLimit)}회 · 캠핑장 ${number(data.api.camping)} / ${number(data.api.campingLimit)}회`;
      el('discoveryEnabled').checked = data.enabled;
      el('discoveryMeasurement').checked = data.measurementEnabled;
      el('discoverySave').disabled = false;
      const body = el('discoveryRows');
      body.replaceChildren();
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (const value of [row.day, kinds[row.kind] || '기타', row.title, number(row.impressions), number(row.clicks),
          row.impressions ? `${(100 * row.viewableClicks / row.impressions).toFixed(2)}%` : '—']) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.append(td);
        }
        body.append(tr);
      }
      el('discoveryEmpty').hidden = rows.length !== 0;
      el('discoveryStatus').textContent = `${new Date(data.generatedAt).toLocaleString('ko-KR')} 기준${data.truncated ? ' · 최근 1,000행까지만 표시됩니다. 기간을 줄여 확인해 주세요.' : ''}`;
    } catch (_) {
      if (generation !== request) return;
      el('discoveryStatus').textContent = '집계를 불러오지 못했습니다. 서버 배포와 관리자 로그인을 확인해 주세요.';
      for (const id of ['discoveryImpressions', 'discoveryClicks', 'discoveryCtr']) el(id).textContent = '—';
      el('discoveryRows').replaceChildren();
      el('discoveryEmpty').hidden = true;
      el('discoverySave').disabled = true;
    } finally {
      if (generation === request) el('discoveryRefresh').disabled = false;
    }
  }
  el('discoveryRefresh').addEventListener('click', load);
  el('discoveryDays').addEventListener('change', load);
  el('discoverySave').addEventListener('click', async () => {
    el('discoverySave').disabled = true;
    try {
      await update({enabled: el('discoveryEnabled').checked, measurementEnabled: el('discoveryMeasurement').checked});
      await load();
      el('discoveryStatus').textContent += ' · 저장했습니다. 배너 변경은 앱에서 최대 15분 뒤 반영됩니다.';
    } catch (_) {
      el('discoveryStatus').textContent = '설정을 저장하지 못했습니다. 다시 시도해 주세요.';
      el('discoverySave').disabled = false;
    }
  });
  return {load};
}
