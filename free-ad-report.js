// Administrator-only presentation of existing aggregate reports. No tracking writes.
const amount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const names = {published: '게시 중', paused: '중지', draft: '임시 저장'};
export function businessReport(items, dailyRows) {
  const rows = new Map();
  for (const item of items) {
    if (typeof item.id !== 'string') continue;
    rows.set(item.id, {id: item.id, title: item.title || '이름 없음', status: item.endAtMs && item.endAtMs <= Date.now() ? '기간 종료' : names[item.status] || '확인 필요',
      period: item.promotionOrderId ? (item.endAtMs ? new Date(item.endAtMs).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) + ' 종료' : '첫 게시일부터 7일') : '종료일 없음', impressions: 0, clicks: 0, viewableClicks: 0});
  }
  for (const row of dailyRows) {
    if (typeof row.creativeId !== 'string') continue;
    const value = rows.get(row.creativeId) || {id: row.creativeId, title: row.title || '이전 광고', status: '이전 기록',
      period: '현재 목록에 없음', impressions: 0, clicks: 0, viewableClicks: 0};
    for (const key of ['impressions', 'clicks', 'viewableClicks']) value[key] += amount(row[key]);
    rows.set(row.creativeId, value);
  }
  return [...rows.values()];
}
export const businessCtr = row => row.impressions > 0
  ? `${(100 * row.viewableClicks / row.impressions).toFixed(2)}%` : '—';
export function mountBusinessReport({call, root = document}) {
  const $ = id => root.getElementById('business' + id);
  const format = value => value.toLocaleString('ko-KR');
  let authorized = false, epoch = 0;
  function clear() {
    for (const key of ['Impressions', 'Clicks', 'Ctr', 'ViewableClicks']) $(key).textContent = '—';
    $('Rows').replaceChildren(); $('Empty').hidden = true;
  }
  async function load() {
    if (!authorized) return;
    const request = ++epoch, days = Number($('Days').value);
    clear(); $('Refresh').disabled = true; $('Status').textContent = '업체별 성과를 불러오는 중…';
    try {
      const [inventory, report] = await Promise.all([call({action: 'list'}), call({action: 'report', days})]);
      if (!authorized || request !== epoch) return;
      if (!Array.isArray(inventory.items) || !Array.isArray(report.rows)) throw Error('invalid-report');
      const rows = businessReport(inventory.items, report.rows);
      const total = rows.reduce((sum, row) => ({impressions: sum.impressions + row.impressions,
        clicks: sum.clicks + row.clicks, viewableClicks: sum.viewableClicks + row.viewableClicks}),
      {impressions: 0, clicks: 0, viewableClicks: 0});
      $('Impressions').textContent = format(total.impressions);
      $('Clicks').textContent = format(total.clicks);
      $('ViewableClicks').textContent = format(total.viewableClicks);
      $('Ctr').textContent = businessCtr(total);
      for (const row of rows) {
        const tr = root.createElement('tr');
        for (const value of [row.title, row.status, row.period, format(row.impressions), format(row.clicks), format(row.viewableClicks), businessCtr(row)]) {
          const td = root.createElement('td'); td.textContent = value; tr.append(td);
        }
        $('Rows').append(tr);
      }
      $('Empty').hidden = rows.length > 0;
      const updated = new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'});
      $('Status').textContent = `${days === 1 ? '오늘' : `최근 ${days}일`} · 한국시간 기준 · 조회 ${updated}` +
        (report.truncated ? ' · 일부 기록만 집계됐습니다. 전체 합계가 아니므로 기간을 줄여 주세요.' : '');
    } catch (_) {
      if (!authorized || request !== epoch) return;
      clear(); $('Status').textContent = '성과를 불러오지 못했습니다. 다시 조회해 주세요.';
    } finally {
      if (authorized && request === epoch) $('Refresh').disabled = false;
    }
  }
  $('Refresh').addEventListener('click', load);
  $('Days').addEventListener('change', load);
  return {load, setUser(allowed) {
    ++epoch; authorized = !!allowed; clear(); $('Refresh').disabled = !authorized;
    $('Status').textContent = authorized ? '성과를 불러오는 중…' : '관리자 로그인 후 확인할 수 있습니다.';
    if (authorized) return load();
  }};
}
