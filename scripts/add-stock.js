// GitHub 이슈 "종목추가: 이름/코드" → config/extra-stocks.json 에 종목 추가
// 사용: Q="삼성전기" node scripts/add-stock.js   (결과 메시지는 result.txt 에 저장)
const fs = require('fs');
const path = require('path');
const { fetchChart } = require('../lib/yahoo');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FILE = path.join(__dirname, '..', 'config', 'extra-stocks.json');
const say = m => { console.log(m); fs.writeFileSync('result.txt', m); };
const UNIT = { KRW: '₩', USD: '$', EUR: '€', JPY: '¥', HKD: 'HK$', CNY: '¥' };

async function naver(q) {
  try {
    const j = await (await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`, { headers: { 'User-Agent': UA } })).json();
    return (j.items || []).filter(x => /^\d{6}$/.test(x.code) && /KOSPI|KOSDAQ/i.test(x.typeCode || ''))
      .map(x => ({ sym: x.code + (/KOSDAQ/i.test(x.typeCode) ? '.KQ' : '.KS'), name: x.name }));
  } catch (e) { console.log('naver 검색 실패', e.message); return []; }
}
async function yahoo(q) {
  try {
    const j = await (await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`, { headers: { 'User-Agent': UA } })).json();
    return (j.quotes || []).filter(x => x.symbol && /EQUITY|ETF/.test(x.quoteType || '')).map(x => ({ sym: x.symbol, name: x.shortname || x.longname || x.symbol }));
  } catch (e) { console.log('yahoo 검색 실패', e.message); return []; }
}

(async () => {
  const q = String(process.env.Q || '').replace(/^\s*종목추가\s*[:：]\s*/, '').trim().slice(0, 40);
  if (!q) return say('종목 이름이나 코드가 비어 있어요.');
  let cands = [];
  if (/^\d{6}$/.test(q)) { const n = await naver(q); cands = n.length ? n : [{ sym: q + '.KS', name: q }, { sym: q + '.KQ', name: q }]; }
  else if (/[가-힣]/.test(q)) cands = [...await naver(q), ...await yahoo(q)];
  else cands = [...(await yahoo(q)).filter(x => x.sym.toUpperCase() === q.toUpperCase()), { sym: q.toUpperCase(), name: q.toUpperCase() }, ...await yahoo(q)];
  const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const c of cands) {
    if (list.some(x => x.sym === c.sym)) return say(`${c.name}(${c.sym})는 이미 추가돼 있어요.`);
    try {
      const d = await fetchChart(c.sym, '3mo');
      if (!d.c || d.c.length < 20) continue;
      let name = c.name;
      if (name === c.sym || /^\d{6}$/.test(name)) { const y = await yahoo(c.sym); if (y[0]) name = y[0].name; }
      list.push({ sym: c.sym, name, unit: UNIT[d.currency] || d.currency || '' });
      fs.writeFileSync(FILE, JSON.stringify(list, null, 1) + '\n');
      return say(`✅ ${name}(${c.sym})을 추가했어요. 3~5분 뒤 새로고침하고, "내 화면 편집 → 직접 추가한 종목"에서 켜 주세요.`);
    } catch (_) {}
  }
  say(`"${q}"에 해당하는 종목을 찾지 못했어요. 정확한 이름이나 종목코드(예: 005930, TSLA)로 다시 요청해 주세요.`);
})();
