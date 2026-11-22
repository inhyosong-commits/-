// 상승 전환 후보 스캔 (하루 2번, 별도 워크플로) → reversal.json, revseries.json
// 한국: 코스피 시총 상위 400 + 코스닥 상위 300 / 미국: 나스닥·NYSE 시총 상위 각 450
// 사용: node scripts/scan-reversal.js 출력폴더
const fs = require('fs');
const path = require('path');
const { fetchChart } = require('../lib/yahoo');
const R = require('../lib/reversal');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const x = +String(v == null ? '' : v).replace(/[$,%+\s]/g, ''); return isFinite(x) ? x : null; };
async function J(u, h = {}) { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', ...h } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function pool(list, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; try { await fn(list[k], k); } catch (_) {} } })); }
const OUT = process.argv[2] || 'scan-out';
const VARIANTS = []; for (const L of [63, 126, 252]) for (const m of [1.5, 2]) VARIANTS.push([L, m]);
const DEF = '126_1.5';
const SEC_KO = { Technology: '기술', 'Information Technology': '기술', 'Health Care': '헬스케어', Healthcare: '헬스케어', Finance: '금융', 'Financial Services': '금융', Financials: '금융', 'Consumer Discretionary': '경기소비재', 'Consumer Cyclical': '경기소비재', 'Consumer Staples': '필수소비재', 'Consumer Defensive': '필수소비재', Industrials: '산업재', Energy: '에너지', 'Basic Materials': '소재', Materials: '소재', Utilities: '유틸리티', 'Real Estate': '부동산', Telecommunications: '통신', 'Communication Services': '통신' };

async function universe() {
  const out = [];
  for (const [mkt, pages] of [['KOSPI', 4], ['KOSDAQ', 3]]) for (let p = 1; p <= pages; p++) {
    const d = await J(`https://m.stock.naver.com/api/stocks/marketValue/${mkt}?page=${p}&pageSize=100`, { Referer: 'https://m.stock.naver.com/' });
    for (const x of d.stocks || []) if (x.stockEndType === 'stock' && /^\d{6}$/.test(x.itemCode)) out.push({ s: x.itemCode + (mkt === 'KOSDAQ' ? '.KQ' : '.KS'), n: x.stockName, mk: mkt, cap: num(x.marketValue) * 1e8, cur: 'KRW' });
    await sleep(150);
  }
  for (const ex of ['nasdaq', 'nyse']) {
    const d = await J(`https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=${ex}&download=true`, { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
    const rows = (d.data && (d.data.rows || (d.data.table && d.data.table.rows))) || [];
    rows.map(x => ({ s: String(x.symbol || '').trim().replace('/', '-'), n: String(x.name || '').replace(/\s+(Common Stock|Class [A-C] (Common Stock|Ordinary Shares)|Ordinary Shares|American Depositary Shares).*$/i, '').trim(), mk: ex.toUpperCase(), cap: num(x.marketCap), sec: SEC_KO[x.sector] || x.sector || null, cur: 'USD' }))
      .filter(x => x.s && !/[\^]/.test(x.s) && x.cap > 0).sort((a, b) => b.cap - a.cap).slice(0, 450).forEach(x => out.push(x));
  }
  return out;
}
const dkey = t => Math.floor((t + 9 * 3600) / 86400); // 날짜 키 (한국시간 기준 일)
function align(st, ix) { // 지수를 종목 날짜에 맞춤 (그 날짜까지의 마지막 값)
  const m = new Map(); ix.t.forEach((t, i) => m.set(dkey(t), ix.c[i]));
  const keys = [...m.keys()].sort((a, b) => a - b); let j = 0, lastV = null; const out = [];
  for (const t of st.t) { const k = dkey(t); while (j < keys.length && keys[j] <= k) { lastV = m.get(keys[j]); j++; } out.push(lastV); }
  return out;
}

let yck = null;
async function yahooSession() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookie = (r1.headers.getSetCookie ? r1.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  const crumb = (await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } })).text()).trim();
  return { cookie, crumb };
}
async function fundamentals(x) {
  const f = { fin: null, eps: null, flow: null, finNote: null, epsNote: null, flowNote: null };
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 86400 * 820;
  try { // 분기 영업이익: 최근 분기 vs 1년 전 같은 분기
    const TY = ['OperatingIncome', 'StockholdersEquity', 'TotalLiabilitiesNetMinorityInterest', 'CurrentAssets', 'CurrentLiabilities', 'CashAndCashEquivalents', 'CashCashEquivalentsAndShortTermInvestments'];
    const types = TY.flatMap(k => ['quarterly' + k, 'annual' + k]).join(',');
    const j = await J(`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(x.s)}?type=${types}&period1=${p1}&period2=${p2}`);
    const G = {}; for (const r of j.timeseries.result || []) for (const [k, a] of Object.entries(r)) if (Array.isArray(a) && /^(quarterly|annual)/.test(k)) G[k] = a.filter(Boolean).map(z => ({ d: z.asOfDate, v: z.reportedValue && z.reportedValue.raw })).filter(z => z.v != null).sort((p, q) => p.d.localeCompare(q.d));
    f.safe = safetyOf(G, x);
    const arr = (G.quarterlyOperatingIncome || []).map(z => ({ asOfDate: z.d, reportedValue: { raw: z.v } }));
    const q = arr.filter(Boolean).map(a => ({ d: a.asOfDate, v: a.reportedValue && a.reportedValue.raw })).filter(a => a.v != null).sort((a, b) => a.d.localeCompare(b.d));
    if (q.length >= 5) {
      const a = q[q.length - 1], b = q[q.length - 5];
      if (b.v < 0 && a.v > 0) { f.fin = true; f.finNote = `흑자 전환 (${a.d.slice(0, 7)} 분기)`; }
      else if (b.v < 0 && a.v < 0 && a.v > b.v) { f.fin = true; f.finNote = `적자 축소 (${a.d.slice(0, 7)} 분기)`; }
      else if (b.v > 0 && a.v > b.v) { f.fin = true; f.finNote = `영업이익 ${Math.round((a.v / b.v - 1) * 100)}% 증가 (전년 같은 분기 대비)`; }
      else { f.fin = false; f.finNote = a.v < 0 ? '적자 지속·확대' : `영업이익 ${Math.round((a.v / b.v - 1) * 100)}% (전년 같은 분기 대비)`; }
    }
  } catch (_) {}
  try { // EPS 전망 변화 (애널리스트 예상치 60일 전 대비)
    const j = await J(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(x.s)}?modules=earningsTrend,assetProfile&crumb=${encodeURIComponent(yck.crumb)}`, { Cookie: yck.cookie });
    const r = j.quoteSummary.result[0];
    if (!x.sec && r.assetProfile && r.assetProfile.sector) x.sec = SEC_KO[r.assetProfile.sector] || r.assetProfile.sector;
    const tr = ((r.earningsTrend || {}).trend || []).find(t => t.period === '+1y') || ((r.earningsTrend || {}).trend || []).find(t => t.period === '0y');
    const et = tr && tr.epsTrend, cur = et && et.current && et.current.raw, old = et && ((et['60daysAgo'] && et['60daysAgo'].raw) || (et['30daysAgo'] && et['30daysAgo'].raw));
    if (cur != null && old != null && old !== 0) { const ch = (cur / old - 1) * 100 * Math.sign(old); f.eps = ch > 1; f.epsNote = `${tr.period === '+1y' ? '내년' : '올해'} EPS 예상 ${ch > 0 ? '+' : ''}${ch.toFixed(1)}% (60일 전 대비)`; }
  } catch (_) {}
  if (/\.K[SQ]$/.test(x.s)) try { // 수급: 최근 5일 vs 그 전 5일 (외국인+기관 순매수 금액)
    const j = await J(`https://m.stock.naver.com/api/stock/${x.s.slice(0, 6)}/integration`, { Referer: 'https://m.stock.naver.com/' });
    const D = j.dealTrendInfos || [], q = k => D.reduce((p, a) => p + (num(a[k]) || 0) * (num(a.closePrice) || 0) / 1e8, 0);
    if (D.length) f.deal = { daily: D.map(a => ['foreignerPureBuyQuant', 'organPureBuyQuant', 'individualPureBuyQuant'].map(k => Math.round((num(a[k]) || 0) * (num(a.closePrice) || 0) / 1e8))), days: D.length, fo: Math.round(q('foreignerPureBuyQuant')), in: Math.round(q('organPureBuyQuant')), ind: Math.round(q('individualPureBuyQuant')), fr0: num(String(D[D.length - 1].foreignerHoldRatio || '').replace('%', '')), fr1: num(String(D[0].foreignerHoldRatio || '').replace('%', '')) };
    const d = D.map(a => ((num(a.foreignerPureBuyQuant) || 0) + (num(a.organPureBuyQuant) || 0)) * (num(a.closePrice) || 0) / 1e8);
    if (d.length >= 10) { const a = d.slice(0, 5).reduce((p, q) => p + q, 0), b = d.slice(5, 10).reduce((p, q) => p + q, 0); f.flow = a > b && a > 0; f.flowNote = `외국인+기관 최근 5일 ${a >= 0 ? '+' : ''}${Math.round(a).toLocaleString('ko-KR')}억 (그 전 5일 ${b >= 0 ? '+' : ''}${Math.round(b).toLocaleString('ko-KR')}억)`; }
    else if (d.length >= 5) { const a = d.slice(0, 5).reduce((p, q) => p + q, 0); f.flow = a > 0; f.flowNote = `외국인+기관 최근 5일 ${Math.round(a)}억`; }
  } catch (_) {}
  return f;
}



// 망하지 않을 회사인지: 자본잠식, 부채비율, 유동비율, 최근 1년 영업이익, 현금으로 버틸 수 있는 기간
function safetyOf(G, x) {
  const last = k => { const q = G['quarterly' + k] || [], a = G['annual' + k] || []; const z = [...q, ...a].sort((p, r) => p.d.localeCompare(r.d)); return z.length ? z[z.length - 1] : null; };
  const eq = last('StockholdersEquity'), li = last('TotalLiabilitiesNetMinorityInterest'), ca = last('CurrentAssets'), cl = last('CurrentLiabilities'), cash = last('CashCashEquivalentsAndShortTermInvestments') || last('CashAndCashEquivalents');
  const oq = G.quarterlyOperatingIncome || [], oa = G.annualOperatingIncome || [];
  const op4 = oq.length >= 4 ? oq.slice(-4).reduce((p, r) => p + r.v, 0) : oa.length ? oa[oa.length - 1].v : null;
  const lossQ = (() => { let n = 0; for (let i = oq.length - 1; i >= 0 && oq[i].v < 0; i--) n++; return n; })();
  const lossY = (() => { let n = 0; for (let i = oa.length - 1; i >= 0 && oa[i].v < 0; i--) n++; return n; })();
  const items = []; let bad = 0, good = 0, n = 0;
  const fin = x.sec === '금융';
  if (eq) { n++; if (eq.v <= 0) { bad++; items.push(['bad', '자본잠식 (자본이 마이너스)']); } }
  if (eq && li && eq.v > 0 && !fin) { n++; const r = li.v / eq.v * 100; const t = `부채비율 ${Math.round(r)}%`; if (r < 100) { good++; items.push(['good', t + ' (빚이 자본보다 적음)']); } else if (r > 200) { bad++; items.push(['bad', t + ' (빚이 자본의 2배 넘음)']); } else items.push(['mid', t]); }
  if (ca && cl && cl.v > 0 && !fin) { n++; const r = ca.v / cl.v * 100; const t = `유동비율 ${Math.round(r)}%`; if (r >= 150) { good++; items.push(['good', t + ' (1년 안에 갚을 돈 충분)']); } else if (r < 100) { bad++; items.push(['bad', t + ' (1년 안에 갚을 빚이 현금성 자산보다 많음)']); } else items.push(['mid', t]); }
  if (op4 != null) { n++; if (op4 > 0) { good++; items.push(['good', '최근 1년 영업이익 흑자']); } else {
    items.push(['bad', `최근 1년 영업적자${lossQ >= 4 ? ` (${lossQ}분기 연속)` : ''}${lossY >= 3 ? `, ${lossY}년 연속` : ''}`]); bad++;
    if (cash) { const yrs = cash.v / -op4; items.push([yrs < 1 ? 'bad' : 'mid', `현금(단기 투자 포함)으로 지금 적자를 약 ${yrs < 1 ? Math.max(1, Math.round(yrs * 12)) + '개월' : yrs.toFixed(1) + '년'} 버틸 수 있음`]); if (yrs < 1) bad++; } } }
  if (!n) return null;
  return { lv: bad >= 2 || (eq && eq.v <= 0) ? 2 : bad === 1 ? 1 : 0, items, asOf: eq ? eq.d : op4 != null && oq.length ? oq[oq.length - 1].d : null };
}
// 운전자(세력) 신호: 큰돈이 들어와 주가를 끌고 가는 흔적 / 빠져나가는 흔적
function driverOf(c, v, e, F, x) {
  const sig = [], out = [];
  const med = a => { const b = a.filter(z => z > 0).sort((p, q) => p - q); return b[Math.floor(b.length / 2)] || 0; };
  const base = med(v.slice(e - 80, e - 20));
  let bi = null; // 최근 20일 중 가장 큰 거래량 + 상승일
  for (let i = e - 19; i <= e; i++) { const r = c[i] / c[i - 1] - 1; if (base > 0 && v[i] >= base * 3 && r >= 0.05 && (bi == null || v[i] > v[bi])) bi = i; }
  if (bi != null) {
    sig.push(`${e - bi === 0 ? '오늘' : (e - bi) + '거래일 전'} 평소 ${Math.round(v[bi] / base)}배 거래량으로 ${((c[bi] / c[bi - 1] - 1) * 100).toFixed(0)}% 상승 (큰돈 진입 흔적)`);
    const mid = (c[bi] + c[bi - 1]) / 2, minAfter = Math.min(...c.slice(bi, e + 1));
    if (bi < e - 1 && minAfter >= mid) sig.push('그 뒤로 급등분의 절반 아래로 안 밀림 (가격을 받쳐 주는 손이 있음)');
    if (c[e] < c[bi - 1]) out.push('큰 거래량으로 오르기 전 가격 아래로 다시 내려감 (급등분 반납)');
  }
  const pre = v.slice(e - 40, e - 20).filter(z => z > 0), preAvg = pre.reduce((p, q) => p + q, 0) / (pre.length || 1);
  if (base > 0 && preAvg < base * 0.7 && bi != null) sig.push('거래가 말라 있다가 갑자기 터짐 (조용히 모은 뒤 움직이는 모양)');
  const dv = i => c[i] * (v[i] || 0), avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) { s += dv(i); n++; } return s / n; };
  const r = avg(e - 19, e) / (avg(e - 80, e - 20) || 1); if (r >= 2) sig.push(`최근 20일 거래대금이 평소의 ${r.toFixed(1)}배`);
  for (let i = e - 9; i <= e; i++) { const rr = c[i] / c[i - 1] - 1; if (base > 0 && v[i] >= base * 3 && rr <= -0.05) { out.push(`${e - i === 0 ? '오늘' : (e - i) + '거래일 전'} 큰 거래량으로 ${(rr * 100).toFixed(0)}% 하락 (물량 털기 의심)`); break; } }
  const dl = F && F.deal;
  if (dl && dl.daily && dl.daily.length >= 5) {
    const d5 = dl.daily.slice(0, 5), fB = d5.filter(z => z[0] > 0).length, iB = d5.filter(z => z[1] > 0).length;
    if (fB >= 4) sig.push(`외국인 최근 5일 중 ${fB}일 순매수`);
    if (iB >= 4) sig.push(`기관 최근 5일 중 ${iB}일 순매수`);
    if (dl.fo + dl.in > 0 && dl.ind < 0 && x.cap > 0 && (dl.fo + dl.in) * 1e8 / x.cap >= 0.002) sig.push(`외국인·기관이 사고 개인이 판 물량 ${(dl.fo + dl.in).toLocaleString('ko-KR')}억 (시총의 ${((dl.fo + dl.in) * 1e10 / x.cap).toFixed(1)}%)`);
    if (d5.filter(z => z[0] < 0).length >= 4 && d5.filter(z => z[1] < 0).length >= 4) out.push('외국인·기관 둘 다 최근 5일 중 4일 이상 순매도');
  }
  const lv = out.length >= 2 || (out.length && sig.length <= 1) ? -1 : sig.length >= 3 && !out.length ? 2 : sig.length >= 2 || (sig.length && !out.length) ? 1 : 0;
  return { lv, sig, out };
}

// 매집 현황: 거래량 흐름(OBV) + 한국은 외국인·기관·개인 순매수(최근 10거래일)와 외국인 지분율
function accOf(c, v, e, F, x) {
  const notes = []; let pos = 0, neg = 0;
  let obv = 0, o20 = null, vs = 0; for (let i = e - 60; i <= e; i++) { if (i <= 0) continue; obv += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0; if (i === e - 20) o20 = obv; if (i > e - 20) vs += v[i]; }
  const obvR = vs > 0 && o20 != null ? (obv - o20) / vs : 0, p20 = (c[e] / c[e - 20] - 1) * 100;
  if (obvR > 0.15 && p20 < 5) { pos++; notes.push('가격은 크게 안 올랐는데 오르는 날 거래가 몰림 (조용한 매집 모양)'); }
  else if (obvR > 0.15) { pos++; notes.push('최근 20일 오르는 날 거래량이 더 많음 (매수세 우위)'); }
  else if (obvR < -0.15) { neg++; notes.push('최근 20일 내리는 날 거래량이 더 많음 (매도세 우위)'); }
  else notes.push('최근 20일 거래량 흐름은 중립');
  const dl = F && F.deal;
  if (dl) {
    const fi = dl.fo + dl.in, w = n => (n >= 0 ? '+' : '') + n.toLocaleString('ko-KR') + '억';
    notes.push(`최근 ${dl.days}거래일 순매수: 외국인 ${w(dl.fo)}, 기관 ${w(dl.in)}, 개인 ${w(dl.ind)}`);
    if (fi > 0) pos++; else if (fi < 0) neg++;
    if (dl.fr0 != null && dl.fr1 != null) { notes.push(`외국인 지분율 ${dl.fr0}% → ${dl.fr1}%`); if (dl.fr1 - dl.fr0 >= 0.2) pos++; else if (dl.fr0 - dl.fr1 >= 0.2) neg++; }
  } else if (x.cur === 'USD') notes.push('미국 종목은 투자자별 매매 데이터가 없어 거래량 흐름으로만 판단');
  return { lv: pos >= 2 || (pos >= 1 && neg === 0 && !dl) ? 1 : neg >= 2 || (neg >= 1 && pos === 0) ? -1 : 0, obvR: +obvR.toFixed(2), notes };
}
// 작전주 의심 신호 (판정이 아니라 체크리스트)
function manipOf(c, v, e, F, x) {
  const fl = [], kr = x.cur === 'KRW';
  if (kr ? x.cap < 3e11 : x.cap < 1e9) fl.push(`시총이 작음 (${kr ? '3,000억원' : '10억달러'} 미만, 적은 돈으로도 주가가 움직이기 쉬움)`);
  if (kr ? c[e] < 2000 : c[e] < 5) fl.push('주가가 낮은 저가주');
  const med = a => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)] || 0; };
  const base = med(v.slice(e - 80, e - 20)), mx = Math.max(...v.slice(e - 19, e + 1));
  if (base > 0 && mx / base >= 8) fl.push(`최근 20일 안에 거래량이 평소의 ${Math.round(mx / base)}배까지 폭발`);
  const r20 = (c[e] / c[e - 20] - 1) * 100, r60 = (c[e] / c[e - 60] - 1) * 100;
  if (r20 >= 50 || r60 >= 100) fl.push(`단기 급등 (20일 ${r20 >= 0 ? '+' : ''}${r20.toFixed(0)}%, 60일 ${r60 >= 0 ? '+' : ''}${r60.toFixed(0)}%)`);
  const rets = []; let big = 0; for (let i = e - 59; i <= e; i++) { const r = c[i] / c[i - 1] - 1; if (i > e - 20) rets.push(r); if (Math.abs(r) >= 0.15) big++; }
  const m = rets.reduce((p, q) => p + q, 0) / rets.length, sd = Math.sqrt(rets.reduce((p, q) => p + (q - m) ** 2, 0) / rets.length) * 100;
  if (sd >= 6) fl.push(`하루 등락폭이 매우 큼 (최근 20일 평균 ±${sd.toFixed(1)}%)`);
  if (big >= 2) fl.push(`최근 60일 하루 15% 넘게 움직인 날 ${big}번`);
  const dl = F && F.deal;
  if (dl && dl.ind > 0 && dl.fo + dl.in < 0 && (c[e] / c[e - 10] - 1) > 0.1) fl.push('주가가 오르는데 개인만 사고 외국인·기관은 팖');
  if (dl && dl.fr1 != null && dl.fr1 < 2) fl.push(`외국인 지분율이 매우 낮음 (${dl.fr1}%)`);
  return { lv: fl.length >= 3 ? 2 : fl.length >= 1 ? 1 : 0, flags: fl };
}

function evalVariant(c, v, idx, e, L, m, F) {
  const t = R.tech(c, v, idx, e, { L, mult: m }); if (!t) return null;
  const it = R.items(t, F), { sc, cov } = R.scoreOf(it), st = R.stageOf(t, it);
  return { t, it, sc, cov, st };
}
const ymd = t => new Date((t + 9 * 3600) * 1000).toISOString().slice(0, 10);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const U = await universe();
  console.log('스캔 대상:', U.length, '종목', U.filter(x => x.cur === 'KRW').length, '한국 /', U.filter(x => x.cur === 'USD').length, '미국');
  const IDX = {};
  for (const s of ['^KS11', '^KQ11', '^GSPC', '^IXIC']) IDX[s] = await fetchChart(s, '2y');
  const idxOf = x => x.mk === 'KOSPI' ? '^KS11' : x.mk === 'KOSDAQ' ? '^KQ11' : x.mk === 'NASDAQ' ? '^IXIC' : '^GSPC';
  const S = {}; let fail = 0;
  await pool(U, 8, async x => { try { const d = await fetchChart(x.s, '2y'); if (d.c && d.c.length > 300) S[x.s] = d; else fail++; } catch (e) { fail++; } });
  console.log('시세:', Object.keys(S).length, '성공 /', fail, '실패', ((Date.now() - t0) / 1000).toFixed(0) + '초');
  // 1차: 기술적 지표만으로 거르기 (재무·수급 N/A)
  const NOF = { fin: null, eps: null, flow: null };
  const short = [];
  for (const x of U) {
    const d = S[x.s]; if (!d) continue;
    x.idx = align(d, IDX[idxOf(x)]);
    const e = d.c.length - 1;
    let best = 0, stg = 0;
    for (const [L, m] of VARIANTS) { const r = evalVariant(d.c, d.vol, x.idx, e, L, m, NOF); if (r) { best = Math.max(best, r.sc); stg = Math.max(stg, r.st); } }
    if (best >= 30 || stg >= 1) short.push(x);
  }
  console.log('1차 통과:', short.length, '종목', ((Date.now() - t0) / 1000).toFixed(0) + '초');
  try { yck = await yahooSession(); } catch (e) { yck = { cookie: '', crumb: '' }; }
  await pool(short, 6, async x => { x.F = await fundamentals(x); });
  console.log('재무·수급:', short.filter(x => x.F && x.F.fin != null).length, '재무 /', short.filter(x => x.F && x.F.eps != null).length, 'EPS /', short.filter(x => x.F && x.F.flow != null).length, '수급', ((Date.now() - t0) / 1000).toFixed(0) + '초');

  const out = [], series = {};
  for (const x of short) {
    const d = S[x.s], c = d.c, v = d.vol, e = c.length - 1, F = x.F || NOF;
    const V = {};
    for (const [L, m] of VARIANTS) {
      const key = L + '_' + m;
      const r = evalVariant(c, v, x.idx, e, L, m, F); if (!r) continue;
      const rp = evalVariant(c, v, x.idx, e - 1, L, m, F);
      // 2단계 최초 진입일: 기술적 조건만으로 과거 20일을 다시 계산 (미래 데이터 사용 안 함)
      let first2 = null;
      if (r.st >= 2) { first2 = e; for (let k = 1; k <= 20; k++) { const h = evalVariant(c, v, x.idx, e - k, L, m, { fin: null, eps: null, flow: null }); if (h && h.st >= 2) first2 = e - k; else break; } }
      const nw = [];
      if (r.st === 2 && first2 != null && first2 >= e - 4) nw.push('stage2');
      if (rp && r.sc - rp.sc >= 15) nw.push('jump');
      if (r.t.crossUp != null && r.t.crossUp >= e - 4 && r.t.belowLong) nw.push('ma60');
      if (r.t.brkIdx != null && r.t.brkIdx >= e - 4 && r.t.volOk) nw.push('brkvol');
      V[key] = [r.sc, r.cov, r.st, Object.keys(R.PTS).map(k => r.it[k] == null ? 2 : r.it[k] ? 1 : 0).join(''), first2 != null ? ymd(d.t[first2]) : null, nw, rp ? r.sc - rp.sc : 0, +((c[e] / r.t.low - 1) * 100).toFixed(1), r.t.volx == null ? null : +r.t.volx.toFixed(2)];
    }
    const best = Math.max(...Object.values(V).map(a => a[0]), 0), stg = Math.max(...Object.values(V).map(a => a[2]), 0);
    if (best < 40 && stg < 1) continue;
    const D = evalVariant(c, v, x.idx, e, 126, 1.5, F); if (!D) continue;
    const t = D.t, ix = x.idx, ma60i = R.sma(ix, 60, e);
    const risk = [];
    if (t.hlIdx != null && c[e] < c[t.hlIdx]) risk.push('최근 저점(Higher Low) 아래로 내려감: 전환 실패 가능');
    if (c[e] < t.ma20) risk.push('20일선 아래로 밀림');
    if (t.rsi > 75) risk.push(`단기 과열 (RSI ${Math.round(t.rsi)})`);
    if (c[e] / t.ma20 > 1.15) risk.push('20일선과 15% 이상 벌어짐 (과열)');
    if (t.brk && t.volOk === false) risk.push('거래량이 늘지 않은 돌파');
    if (ix[e] && ma60i && ix[e] < ma60i) risk.push('시장 지수가 60일선 아래 (시장 전체 약세)');
    if (F.fin === false) risk.push('실적 개선 미확인');
    const gcDate = t.gc != null ? ymd(d.t[t.gc]) : null;
    const acc = accOf(c, v, e, F, x), mp = manipOf(c, v, e, F, x), drv = driverOf(c, v, e, F, x), safe = F.safe || null;
    out.push({ s: x.s, n: x.n, mk: x.mk, cap: x.cap, acc, mp, drv, safe, sec: x.sec || null, cur: x.cur, px: +c[e].toPrecision(6), d1: +((c[e] / c[e - 1] - 1) * 100).toFixed(2), asOf: ymd(d.t[e]), V,
      det: { low: [ymd(d.t[t.mlo]), +t.low.toPrecision(6)], hl: t.hlIdx != null ? [ymd(d.t[t.hlIdx]), +c[t.hlIdx].toPrecision(6)] : null, refHi: t.refHi != null ? [ymd(d.t[t.refHiIdx]), +t.refHi.toPrecision(6)] : null,
        brk: t.brkIdx != null ? ymd(d.t[t.brkIdx]) : null, gc: gcDate, ma60x: t.crossUp != null ? ymd(d.t[t.crossUp]) : null, volx: t.volx, ma20: +t.ma20.toPrecision(6), ma60: +t.ma60.toPrecision(6), ma120: +t.ma120.toPrecision(6), rsi: Math.round(t.rsi),
        fin: F.finNote, eps: F.epsNote, flow: F.flowNote, risk } });
    series[x.s] = { t: d.t.slice(-260).map(z => Math.floor(z / 60)), c: c.slice(-260).map(z => +z.toPrecision(6)) };
  }
  out.sort((a, b) => b.V[DEF] && a.V[DEF] ? b.V[DEF][0] - a.V[DEF][0] : 0);
  const asOf = { KR: (out.find(x => x.cur === 'KRW') || {}).asOf || null, US: (out.find(x => x.cur === 'USD') || {}).asOf || null };
  fs.writeFileSync(path.join(OUT, 'reversal.json'), JSON.stringify({ v: 1, scannedAt: Date.now(), asOf, universe: { KR: U.filter(x => x.cur === 'KRW').length, US: U.filter(x => x.cur === 'USD').length, ok: Object.keys(S).length }, keys: Object.keys(R.PTS), pts: R.PTS, labels: R.LABEL, list: out }));
  fs.writeFileSync(path.join(OUT, 'revseries.json'), JSON.stringify(series));
  const st = k => out.filter(x => x.V[DEF] && x.V[DEF][2] === k).length;
  console.log('결과:', out.length, '종목 | 1단계', st(1), '/ 2단계', st(2), '/ 3단계', st(3), '| NEW', out.filter(x => x.V[DEF] && x.V[DEF][5].length).length, '|', ((Date.now() - t0) / 1000).toFixed(0) + '초');
  console.log('크기:', (fs.statSync(path.join(OUT, 'reversal.json')).size / 1024).toFixed(0) + 'KB,', (fs.statSync(path.join(OUT, 'revseries.json')).size / 1024).toFixed(0) + 'KB');
  console.log('운전자 신호 강함', out.filter(x => x.drv.lv === 2).length, '/ 있음', out.filter(x => x.drv.lv === 1).length, '/ 이탈', out.filter(x => x.drv.lv === -1).length, '| 재무 안전', out.filter(x => x.safe && x.safe.lv === 0).length, '/ 보통', out.filter(x => x.safe && x.safe.lv === 1).length, '/ 위험', out.filter(x => x.safe && x.safe.lv === 2).length, '/ 없음', out.filter(x => !x.safe).length);
  console.log('매집 신호', out.filter(x => x.acc.lv === 1).length, '/ 작전 주의', out.filter(x => x.mp.lv === 1).length, '/ 작전 높음', out.filter(x => x.mp.lv === 2).length);
  console.log('상위 5:', out.slice(0, 5).map(x => `${x.n}(${x.V[DEF] && x.V[DEF][0]}점, ${x.V[DEF] && x.V[DEF][2]}단계)`).join(', '));
})().catch(e => { console.error('스캔 실패:', e); process.exit(1); });
