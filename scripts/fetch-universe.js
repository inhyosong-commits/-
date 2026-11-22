// 종목 검색용 전체 목록 + 현재가 (한국: 네이버 증권, 미국: 나스닥 스크리너, 키 필요 없음) → public/universe.json
// 사용: node scripts/fetch-universe.js public/universe.json [이전 universe.json URL]
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const x = +String(v == null ? '' : v).replace(/[$,%+\s]/g, ''); return isFinite(x) ? x : null; };
async function j(u, h = {}) { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...h } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

async function korea() {
  const out = [];
  for (const mkt of ['KOSPI', 'KOSDAQ']) {
    for (let page = 1; page < 60; page++) {
      const d = await j(`https://m.stock.naver.com/api/stocks/marketValue/${mkt}?page=${page}&pageSize=100`, { Referer: 'https://m.stock.naver.com/' });
      const list = d.stocks || [];
      if (page === 1 && mkt === 'KOSPI') console.log('한국 예시:', JSON.stringify(list[0] || d).slice(0, 400));
      for (const x of list) {
        if (!/^\d{6}$/.test(x.itemCode || '') || x.stockEndType && x.stockEndType !== 'stock') continue;
        out.push([x.itemCode + (mkt === 'KOSDAQ' ? '.KQ' : '.KS'), x.stockName, num(x.closePrice), num(x.fluctuationsRatio)]);
      }
      if (list.length < 100) break;
      await sleep(120);
    }
  }
  return out;
}
async function usa() {
  const d = await j('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
  const rows = (d.data && (d.data.rows || (d.data.table && d.data.table.rows))) || [];
  console.log('미국 예시:', JSON.stringify(rows[0] || d).slice(0, 300));
  return rows.map(x => [String(x.symbol || '').trim().replace('/', '-'), String(x.name || '').replace(/\s+(Common Stock|Class [A-C] Common Stock|Ordinary Shares|American Depositary Shares).*$/i, '').trim(), num(x.lastsale), num(x.pctchange), num(x.marketCap)])
    .filter(x => x[0] && x[2] && (x[4] || 0) >= 2e8).sort((a, b) => (b[4] || 0) - (a[4] || 0)).map(x => x.slice(0, 4));
}

(async () => {
  const out = process.argv[2] || 'public/universe.json', prevUrl = process.argv[3];
  let prev = null;
  if (prevUrl) { try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (r.ok) prev = await r.json(); } catch (_) {} }
  const res = { fetchedAt: Date.now(), kr: [], us: [] };
  try { res.kr = await korea(); } catch (e) { console.log('한국 목록 실패:', e.message); if (prev) res.kr = prev.kr || []; }
  try { res.us = await usa(); } catch (e) { console.log('미국 목록 실패:', e.message); if (prev) res.us = prev.us || []; }
  console.log('종목 목록: 한국', res.kr.length, '/ 미국', res.us.length);
  fs.writeFileSync(out, JSON.stringify(res));
  console.log('크기', (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
})().catch(e => console.error('종목 목록 실패(배포는 계속):', e.message));
