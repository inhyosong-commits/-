// 다가오는 일정 수집 → public/events.json
//  1) 종목 실적 발표일: Yahoo Finance (쿠키+crumb 방식, 키 필요 없음)
//  2) 거시 일정: 아래 MACRO 목록 (연준·미국 물가·고용 공식 일정표에서 옮김, 1년에 한 번 갱신 필요)
//  3) 바이오 임상·FDA 관련 최근 뉴스: Google 뉴스 RSS
// 6시간에 한 번만 새로 받고, 그 사이에는 이전 결과를 재사용합니다.
// 사용: node scripts/fetch-events.js public/events.json [이전 events.json URL]
const fs = require('fs');
const path = require('path');
const { translateAll } = require('../lib/translate');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REFRESH_MS = 6 * 3600e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 출처: federalreserve.gov/monetarypolicy/fomccalendars.htm, bls.gov/schedule/news_release/cpi.htm, empSit.htm (2026-11-22 확인)
const MACRO = [
  ...['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-11-17'].map(d => [d, 'fomc', '미국 금리 결정 (FOMC)', '미국 기준금리가 정해지는 날. 전 세계 금리·환율·주가가 같이 움직여요. 발표는 한국시간 다음날 새벽 3~4시.']),
  ...[['2026-12-10', '11월'], ['2027-01-13', '12월'], ['2027-02-11', '1월'], ['2027-03-10', '2월'], ['2027-04-13', '3월'], ['2027-05-12', '4월'], ['2027-06-10', '5월'], ['2027-07-14', '6월'], ['2027-08-11', '7월'], ['2027-09-14', '8월'], ['2027-10-14', '9월'], ['2027-11-10', '10월'], ['2027-12-10', '11월']]
    .map(([d, m]) => [d, 'cpi', `미국 소비자물가 (${m}분)`, '물가가 예상보다 높으면 금리 인하 기대가 줄어 주가·원화에 부담. 한국시간 밤 10시 30분경 발표.']),
  ...[['2026-12-04', '11월'], ['2027-01-08', '12월'], ['2027-02-05', '1월'], ['2027-03-05', '2월'], ['2027-04-02', '3월'], ['2027-05-07', '4월'], ['2027-06-04', '5월'], ['2027-07-02', '6월'], ['2027-08-06', '7월'], ['2027-09-03', '8월'], ['2027-10-08', '9월'], ['2027-11-05', '10월'], ['2027-12-03', '11월']]
    .map(([d, m]) => [d, 'jobs', `미국 고용보고서 (${m}분)`, '미국 경기가 식는지 보는 핵심 지표. 일자리가 크게 줄면 경기 걱정, 너무 많으면 금리 걱정. 한국시간 밤 10시 30분경.']),
].map(([date, kind, title, why]) => ({ date, kind, title, why }));

// 임상·허가 뉴스를 찾을 바이오 종목
const BIO = {
  '207940.KS': ['삼성바이오로직스 수주 OR 임상 OR 허가', 'ko'],
  '068270.KS': ['셀트리온 임상 OR FDA OR 허가 OR 승인', 'ko'],
  'LLY': ['"Eli Lilly" FDA OR trial OR approval OR data', 'en'],
  'NVO': ['"Novo Nordisk" FDA OR trial OR approval OR data', 'en'],
};
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
const LOCALE = { ko: 'hl=ko&gl=KR&ceid=KR:ko', en: 'hl=en-US&gl=US&ceid=US:en' };
async function news(q, lang) {
  const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&${LOCALE[lang]}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text(), seen = new Set();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const x = m[1], source = tag(x, 'source'); let title = tag(x, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(x, 'link'), source, time: Date.parse(tag(x, 'pubDate')) || null, en: lang === 'en' };
  }).filter(n => n.title && /^https?:\/\//.test(n.link) && !seen.has(n.title) && seen.add(n.title))
    .sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 5);
}

// ClinicalTrials.gov: 바이오 종목의 3상(및 2/3상) 임상 "주요 완료 예정일" (키 필요 없음)
const TRIAL_SPONSORS = { 'LLY': 'Eli Lilly and Company', 'NVO': 'Novo Nordisk A/S', '068270.KS': 'Celltrion', '207940.KS': 'Samsung Bioepis' };
async function trials() {
  const out = {}, from = Date.now() - 30 * 864e5, to = Date.now() + 200 * 864e5;
  for (const [sym, spons] of Object.entries(TRIAL_SPONSORS)) {
    try {
      const list = []; let token = '';
      for (let page = 0; page < 4; page++) {
        const d = t => new Date(t).toISOString().slice(0, 10);
        const adv = `&filter.advanced=${encodeURIComponent(`AREA[Phase]PHASE3 AND AREA[PrimaryCompletionDate]RANGE[${d(from)},${d(to)}]`)}`;
        const base = `https://clinicaltrials.gov/api/v2/studies?query.spons=${encodeURIComponent(spons)}&pageSize=200${token ? '&pageToken=' + token : ''}`;
        let r = await fetch(base + adv, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!r.ok && page === 0) { console.log('임상 고급검색 실패', r.status, '→ 일반 검색'); r = await fetch(base + '&filter.overallStatus=RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,NOT_YET_RECRUITING', { headers: { 'User-Agent': UA, Accept: 'application/json' } }); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        for (const st of j.studies || []) {
          const p = st.protocolSection || {}, id = p.identificationModule || {}, sm = p.statusModule || {}, dm = p.designModule || {};
          const phases = dm.phases || [];
          if (!phases.includes('PHASE3')) continue;
          const pc = sm.primaryCompletionDateStruct || {};
          const t = Date.parse(pc.date && pc.date.length === 7 ? pc.date + '-15' : pc.date);
          if (!t || t < from || t > to) continue;
          const iv = ((p.armsInterventionsModule || {}).interventions || []).filter(x => /DRUG|BIOLOGICAL/.test(x.type || '')).map(x => x.name).filter(x => !/placebo/i.test(x));
          const sum = ((p.descriptionModule || {}).briefSummary || '').replace(/\s+/g, ' ').trim();
          list.push({ nct: id.nctId, title: id.briefTitle, acronym: id.acronym || '', phase: phases.join('/').replace(/PHASE/g, ''), date: t, month: pc.date.length === 7, est: pc.type !== 'ACTUAL', status: sm.overallStatus, cond: ((p.conditionsModule || {}).conditions || []).slice(0, 2).join(', '), drugs: [...new Set(iv)].slice(0, 3), summary: (sum.match(/^.{0,400}?[.!?](\s|$)/) || [sum.slice(0, 300)])[0].trim(), enroll: ((dm.enrollmentInfo || {}).count) || null });
        }
        token = j.nextPageToken; if (!token) break;
        await sleep(300);
      }
      out[sym] = list.sort((a, b) => a.date - b.date).slice(0, 15);
    } catch (e) { console.log('임상', sym, '실패:', e.message); }
  }
  return out;
}

// DART(금융감독원 전자공시): 한국 종목의 최근 중요 공시 (GitHub Secrets 에 DART_API_KEY 가 있을 때만)
const DART_KEY = process.env.DART_API_KEY;
const DART_IMPORTANT = /실적|기업설명회|주주총회|배당|공급계약|임상|품목허가|자기주식|유상증자|무상증자|합병|분할|투자판단|신규시설|타법인|수주|특허/;
async function dart(krSyms) {
  if (!DART_KEY) { console.log('DART: 키 없음 → 건너뜀'); return null; }
  const { execSync } = require('child_process');
  const r = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.slice(0, 2).toString() !== 'PK') throw new Error('corpCode 받기 실패: ' + buf.slice(0, 200).toString());
  fs.writeFileSync('/tmp/corp.zip', buf);
  const xml = execSync('unzip -p /tmp/corp.zip', { maxBuffer: 200 * 1024 * 1024 }).toString('utf8');
  const map = {};
  for (const m of xml.matchAll(/<corp_code>(\d+)<\/corp_code>\s*<corp_name>[^<]*<\/corp_name>\s*(?:<corp_eng_name>[^<]*<\/corp_eng_name>\s*)?<stock_code>(\d{6})<\/stock_code>/g)) map[m[2]] = m[1];
  const ymd = t => new Date(t + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const out = {};
  for (const s of krSyms) {
    const code = map[s.slice(0, 6)]; if (!code) continue;
    try {
      const j = await (await fetch(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_KEY}&corp_code=${code}&bgn_de=${ymd(Date.now() - 30 * 864e5)}&end_de=${ymd(Date.now())}&page_count=50`)).json();
      if (j.status !== '000' && j.status !== '013') { console.log('DART', s, j.status, j.message); continue; }
      out[s] = (j.list || []).filter(x => DART_IMPORTANT.test(x.report_nm)).slice(0, 6)
        .map(x => ({ title: x.report_nm.trim().replace(/\s+/g, ' '), date: Date.parse(`${x.rcept_dt.slice(0, 4)}-${x.rcept_dt.slice(4, 6)}-${x.rcept_dt.slice(6)}T09:00:00+09:00`), link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${x.rcept_no}` }));
    } catch (e) { console.log('DART', s, e.message); }
    await sleep(200);
  }
  return out;
}

// Yahoo 쿠키 + crumb
async function yahooSession() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.map(c => c.split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 20 || /[<{ ]/.test(crumb)) throw new Error('crumb 실패 HTTP ' + r2.status);
  return { cookie, crumb };
}
async function earnings(syms) {
  const { cookie, crumb } = await yahooSession();
  const out = {}, H = { 'User-Agent': UA, Cookie: cookie };
  // 1차: quote 일괄 조회
  for (let i = 0; i < syms.length; i += 40) {
    const part = syms.slice(i, i + 40);
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(part.join(','))}&crumb=${encodeURIComponent(crumb)}`, { headers: H });
      const j = await r.json();
      for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
        const ts = q.earningsTimestampStart || q.earningsTimestamp;
        if (ts) out[q.symbol] = { date: ts * 1000, end: q.earningsTimestampEnd ? q.earningsTimestampEnd * 1000 : null, estimate: !!q.isEarningsDateEstimate };
      }
    } catch (e) { console.log('quote 일괄 실패:', e.message); }
  }
  // 2차: 없는 종목은 calendarEvents 로 개별 조회
  for (const s of syms.filter(s => !out[s])) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`, { headers: H });
      const j = await r.json();
      const e = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0] && j.quoteSummary.result[0].calendarEvents && j.quoteSummary.result[0].calendarEvents.earnings;
      const d = e && e.earningsDate || [];
      if (d.length) out[s] = { date: d[0].raw * 1000, end: d[1] ? d[1].raw * 1000 : null, estimate: !!e.isEarningsDateEstimate };
    } catch (_) {}
    await sleep(250);
  }
  return out;
}

(async () => {
  const out = process.argv[2] || 'public/events.json', prevUrl = process.argv[3];
  let prev = null;
  if (prevUrl) { try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (r.ok) prev = await r.json(); } catch (_) {} }
  if (prev && prev.fetchedAt && Date.now() - prev.fetchedAt < REFRESH_MS && process.env.FORCE_EVENTS !== '1' && prev.trials && prev.v === 5 && (!DART_KEY || prev.dart)) {
    prev.macro = MACRO; fs.writeFileSync(out, JSON.stringify(prev));
    console.log('일정: 최근 것 재사용 (', Math.round((Date.now() - prev.fetchedAt) / 60000), '분 전)'); return;
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sb = html.slice(html.indexOf('const SECTORS = ['), html.indexOf('const STOCK_SECTOR'));
  const syms = [...new Set([...sb.matchAll(/\['([^']+)','([^']+)'\]/g)].filter(m => !/ETF/.test(m[2])).map(m => m[1]))];
  try { for (const x of JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'extra-stocks.json'), 'utf8'))) if (!syms.includes(x.sym)) syms.push(x.sym); } catch (_) {}
  const res = { v: 5, fetchedAt: Date.now(), earnings: {}, macro: MACRO, bio: {} };
  try { res.earnings = await earnings(syms); }
  catch (e) { console.log('실적 일정 실패:', e.message); if (prev) res.earnings = prev.earnings || {}; }
  for (const [s, [q, lang]] of Object.entries(BIO)) {
    try { res.bio[s] = await news(q, lang); } catch (e) { if (prev && prev.bio) res.bio[s] = prev.bio[s]; }
    await sleep(400);
  }
  try { res.trials = await trials(); } catch (e) { console.log('임상 실패:', e.message); }
  if (!res.trials || !Object.keys(res.trials).length) res.trials = (prev && prev.trials) || {};
  try { res.dart = await dart(syms.filter(s => /\.(KS|KQ)$/.test(s))); } catch (e) { console.log('DART 실패:', e.message); }
  if (!res.dart && prev && prev.dart) res.dart = prev.dart;
  // 번역: 임상 제목·질환·요약, 해외 바이오 뉴스
  const cache = {};
  if (prev) { for (const v of Object.values(prev.trials || {})) for (const x of v) for (const k of ['title', 'cond', 'summary']) if (x[k + 'Ko']) cache[x[k]] = x[k + 'Ko'];
    for (const v of Object.values(prev.bio || {})) for (const x of v || []) if (x.ko) cache[x.title] = x.ko; }
  const norm = t => t && t.replace(/\s+/g, ' ').trim();
  const trials = Object.values(res.trials || {}).flat(), bioEn = Object.values(res.bio || {}).flat().filter(x => x && x.en);
  const T = await translateAll([...trials.flatMap(x => [x.title, x.cond, x.summary]), ...bioEn.map(x => x.title)], cache);
  for (const x of trials) for (const k of ['title', 'cond', 'summary']) { const t = cache[norm(x[k])]; if (t) x[k + 'Ko'] = t; }
  for (const x of bioEn) { const t = cache[norm(x.title)]; if (t) x.ko = t; }
  console.log('일정 번역: 새로', T.done, '/', T.todo, '건 (요청', T.calls, '번)');
  console.log('임상:', Object.entries(res.trials).map(([k, v]) => k + ' ' + v.length + '건').join(', '), '| DART:', res.dart ? Object.values(res.dart).flat().length + '건' : '없음');
  console.log('일정: 실적', Object.keys(res.earnings).length, '/', syms.length, '종목, 거시', MACRO.length, '건, 바이오 뉴스', Object.values(res.bio).flat().length, '건');
  fs.writeFileSync(out, JSON.stringify(res));
})().catch(e => { console.error('일정 실패(배포는 계속):', e.message); });
