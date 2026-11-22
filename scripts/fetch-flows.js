// 외국인·기관·개인 매매 동향 (네이버 증권 모바일 공개 API, 키 필요 없음) → public/flows.json
// 사용: node scripts/fetch-flows.js public/flows.json [이전 flows.json URL]
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFRESH_MS = 30 * 60e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(u) { const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const num = v => v == null ? null : +String(v).replace(/[,+]/g, '');

(async () => {
  const out = process.argv[2] || 'public/flows.json', prevUrl = process.argv[3];
  let prev = null;
  if (prevUrl) { try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (r.ok) prev = await r.json(); } catch (_) {} }
  if (prev && prev.v === 2 && prev.fetchedAt && Date.now() - prev.fetchedAt < REFRESH_MS && process.env.FORCE_FLOWS !== '1') { fs.writeFileSync(out, JSON.stringify(prev)); console.log('수급: 재사용'); return; }
  const res = { v: 2, fetchedAt: Date.now(), index: {}, stocks: {} };
  for (const idx of ['KOSPI', 'KOSDAQ']) {
    try {
      const j = await get(`https://m.stock.naver.com/api/index/${idx}/integration`);
      const raw = j.dealTrendInfo || j.dealTrendInfos || [];
      const d = Array.isArray(raw) ? raw : (raw.dealTrendInfos || raw.list || [raw]);
      if (idx === 'KOSPI') console.log('수급 KOSPI dealTrendInfo:', JSON.stringify(raw).slice(0, 600));
      res.index[idx] = d.slice(0, 10).map(x => ({ date: x.bizdate, ind: num(x.personalValue), frg: num(x.foreignValue), inst: num(x.institutionalValue) }));
    } catch (e) { console.log('수급', idx, '실패', e.message); }
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sb = html.slice(html.indexOf('const SECTORS = ['), html.indexOf('const STOCK_SECTOR'));
  const kr = [...new Set([...sb.matchAll(/\['(\d{6})\.K[SQ]','[^']+'\]/g)].map(m => m[1]))];
  try { for (const x of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'extra-stocks.json'), 'utf8'))) { const m = x.sym.match(/^(\d{6})\.K[SQ]$/); if (m && !kr.includes(m[1])) kr.push(m[1]); } } catch (_) {}
  let first = true;
  for (const code of kr) {
    try {
      const j = await get(`https://m.stock.naver.com/api/stock/${code}/integration`);
      const d = j.dealTrendInfos || [];
      if (first) { console.log('IR일정 예시:', JSON.stringify(j.irScheduleInfo).slice(0, 500), '| 주총:', JSON.stringify(j.shareholdersMeetingInfo).slice(0, 300), '| 컨센서스:', JSON.stringify(j.consensusInfo).slice(0, 300)); first = false; }
      if (j.irScheduleInfo) res.ir = res.ir || {}, res.ir[code] = j.irScheduleInfo;
      res.stocks[code] = d.slice(0, 10).map(x => ({ date: x.bizdate, frg: num(x.foreignerPureBuyQuant), inst: num(x.organPureBuyQuant), ind: num(x.individualPureBuyQuant), hold: x.foreignerHoldRatio || null }));
    } catch (e) { console.log('수급', code, '실패', e.message); }
    await sleep(150);
  }
  console.log('수급: 지수', Object.keys(res.index).length, '| 종목', Object.keys(res.stocks).length, '/', kr.length);
  if (!Object.keys(res.index).length && prev) { fs.writeFileSync(out, JSON.stringify(prev)); return; }
  fs.writeFileSync(out, JSON.stringify(res));
})().catch(e => console.error('수급 실패(배포는 계속):', e.message));
