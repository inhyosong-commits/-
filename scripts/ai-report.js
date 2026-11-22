// Perplexity(Sonar)로 "보고받는 느낌"의 종합 리포트 작성 → public/report.json
// GitHub Secrets 에 PERPLEXITY_API_KEY 가 있을 때만 동작. 하루 약 3번(한국시간 아침·점심·저녁)만 새로 씁니다.
// 사용: node scripts/ai-report.js public/market.json public/news.json public/report.json [이전 report.json URL]
const fs = require('fs');

const KEY = process.env.PERPLEXITY_API_KEY;
const MODEL = process.env.PERPLEXITY_MODEL || 'sonar-pro';
const SLOTS_KST = [7, 12, 18];          // 이 시각(한국시간) 이후 첫 실행 때 새 리포트
const [marketPath, newsPath, outPath, prevUrl] = process.argv.slice(2);

const NAMES = {
  '^GSPC': 'S&P 500', '^IXIC': '나스닥', '^KS11': '코스피', '000001.SS': '상하이종합', '^HSI': '항셍', '^N225': '닛케이', '^VIX': 'VIX',
  'HG=F': '구리', 'CL=F': 'WTI 원유', 'BZ=F': '브렌트유', 'NG=F': '천연가스', 'GC=F': '금', 'SI=F': '은', 'ZW=F': '밀', 'ZC=F': '옥수수',
  '^TNX': '미 10년물 금리(%)', '2YY=F': '미 2년물 금리(%)', '^IRX': '미 3개월물(%)', 'DX-Y.NYB': '달러인덱스', 'KRW=X': '원/달러',
  'JPY=X': '엔/달러', 'CNY=X': '위안/달러', 'AUDUSD=X': '호주달러', 'BTC-USD': '비트코인',
  'SOXX': '미 반도체 ETF', '005930.KS': '삼성전자', '000660.KS': 'SK하이닉스', 'NVDA': '엔비디아', '005380.KS': '현대차', '005490.KS': 'POSCO홀딩스',
  '012450.KS': '한화에어로스페이스', '009540.KS': 'HD한국조선해양', '373220.KS': 'LG에너지솔루션', '105560.KS': 'KB금융',
};

function slotOf(ms) { // 가장 최근에 지난 슬롯의 시작 시각(ms)
  const kst = new Date(ms + 9 * 3600e3);
  const day = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const h = kst.getUTCHours();
  const past = SLOTS_KST.filter(s => s <= h);
  if (past.length) return day + past[past.length - 1] * 3600e3 - 9 * 3600e3;
  return day - 24 * 3600e3 + SLOTS_KST[SLOTS_KST.length - 1] * 3600e3 - 9 * 3600e3;
}

function marketLines(m) {
  const out = [];
  for (const [s, name] of Object.entries(NAMES)) {
    const v = m.items && m.items[s]; if (!v || !v.c || v.c.length < 25) continue;
    const c = v.c, n = c.length, last = c[n - 1];
    const isYield = /금리|3개월물/.test(name);
    const ch = k => isYield ? `${((last - c[n - 1 - k]) * 100).toFixed(0)}bp` : `${((last / c[n - 1 - k] - 1) * 100).toFixed(2)}%`;
    out.push(`${name}: ${last.toFixed(last > 100 ? 1 : 3)} | 1일 ${ch(1)} | 1주 ${ch(5)} | 1개월 ${ch(21)}`);
  }
  return out.join('\n');
}

function newsLines(nw) {
  const pick = ['^GSPC', 'en:^GSPC', '^KS11', 'KRW=X', 'en:^TNX', 'HG=F', 'en:HG=F', 'CL=F', 'en:CL=F', 'GC=F', 'en:2YY=F', '000001.SS', 'en:000001.SS', 'sec:semi', 'en:sec:semi'];
  const seen = new Set(), out = [];
  for (const k of pick) for (const x of ((nw.topics || {})[k] || []).slice(0, 3)) {
    if (seen.has(x.title)) continue; seen.add(x.title);
    out.push(`- ${x.title} (${x.source || ''})`);
  }
  return out.join('\n');
}

(async () => {
  const write = obj => fs.writeFileSync(outPath, JSON.stringify(obj));
  let prev = null;
  if (prevUrl) { try { const r = await fetch(prevUrl, { cache: 'no-store' }); if (r.ok) prev = await r.json(); } catch (_) {} }
  // 스냅샷: Claude 예약 작업이 읽어 가는 숫자·뉴스 요약 (항상 작성)
  if (process.env.SNAPSHOT_OUT) {
    try {
      const m = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
      let n = { topics: {} }; try { n = JSON.parse(fs.readFileSync(newsPath, 'utf8')); } catch (_) {}
      const t = new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
      fs.writeFileSync(process.env.SNAPSHOT_OUT, `기준 시각(한국시간): ${t}\n\n[시세: 종가 기준, 1일·1주·1개월 변화]\n${marketLines(m)}\n\n[참고 뉴스 헤드라인(국내·해외)]\n${newsLines(n)}\n`);
    } catch (e) { console.error('스냅샷 실패:', e.message); }
  }
  // Claude 구독으로 쓴 리포트(data/claude-report.json)가 더 최신이면 그걸 사용
  try {
    const c = JSON.parse(fs.readFileSync('data/claude-report.json', 'utf8'));
    if (c && c.sections && c.generatedAt && (!prev || !prev.generatedAt || c.generatedAt > prev.generatedAt)) prev = c;
  } catch (_) {}
  if (!KEY) { console.log('AI 리포트: Perplexity 키 없음 → ' + (prev ? '저장된 리포트 사용 (' + (prev.model || '') + ')' : '리포트 없음')); if (prev) write(prev); return; }
  const now = Date.now();
  if (prev && prev.generatedAt && prev.generatedAt >= slotOf(now) && process.env.FORCE_REPORT !== '1') {
    console.log('AI 리포트: 이번 회차 이미 작성됨 → 재사용'); write(prev); return;
  }
  const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
  let news = { topics: {} }; try { news = JSON.parse(fs.readFileSync(newsPath, 'utf8')); } catch (_) {}
  const kstNow = new Date(now + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);

  const system = `당신은 바쁜 개인 투자자에게 매일 세계 경제 상황을 보고하는 수석 애널리스트입니다.
보고받는 사람은 한국에 사는 일반인으로, 전문 용어를 싫어하고 핵심만 쉽게 듣고 싶어 합니다.
규칙:
- 한국어 존댓말 보고체("~했습니다", "~로 보입니다")로, 중학생도 이해할 만큼 쉽게 씁니다. 전문 용어는 괄호로 짧게 풉니다.
- 제공된 시세 숫자를 근거로 쓰고, 최신 국내외 뉴스를 직접 검색해 "왜 움직였는지"를 설명합니다.
- 원인은 단정하지 말고 "~때문으로 보입니다", "~가능성이 있습니다"처럼 씁니다. 매수·매도 추천은 하지 않습니다.
- 한국(코스피, 원화, 수출기업, 물가)에 미치는 영향을 꼭 포함합니다.
- 반드시 아래 JSON 하나만 출력합니다(코드블록 없이).
{"headline":"한 줄 결론(25자 이내)","summary":"세 문장 이내 요약","sections":[{"title":"무슨 일이 있었나","body":"..."},{"title":"왜 그랬나","body":"..."},{"title":"우리에게 미치는 영향","body":"..."},{"title":"앞으로 확인할 것","body":"..."}],"watch":["다음에 볼 일정·지표 2~4개"]}`;
  const user = `보고 시각(한국시간): ${kstNow}

[시세: 종가 기준, 1일·1주·1개월 변화]
${marketLines(market)}

[참고 뉴스 헤드라인(국내·해외)]
${newsLines(news)}

위 자료와 직접 검색한 최신 뉴스를 종합해 오늘의 보고서를 작성해 주세요.`;

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2 }),
  });
  if (!res.ok) { console.error('AI 리포트 실패: HTTP', res.status, (await res.text()).slice(0, 300)); if (prev) write(prev); return; }
  const j = await res.json();
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  let rep;
  try { rep = JSON.parse(text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
  catch (e) { rep = { headline: '오늘의 AI 보고', summary: '', sections: [{ title: '보고 내용', body: text }], watch: [] }; }
  rep.generatedAt = now; rep.model = MODEL;
  rep.citations = (j.citations || (j.search_results || []).map(x => x.url) || []).slice(0, 10);
  rep.usage = j.usage || null;
  write(rep);
  console.log('AI 리포트 작성 완료:', rep.headline, '| 토큰', JSON.stringify(j.usage || {}));
})().catch(e => { console.error('AI 리포트 오류(배포는 계속):', e.message); });
