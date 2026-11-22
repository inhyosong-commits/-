// 텔레그램 알림: 관심종목 급변, 실적 발표 전날, 미국 금리·물가·고용 발표 전날, 공포지수 급등, 매일 아침 요약
// GitHub Secrets 에 TELEGRAM_BOT_TOKEN 이 있을 때만 동작. 같은 알림은 하루 한 번만 보냅니다.
// 사용: node scripts/alerts.js public/market.json public/events.json state.json
const fs = require('fs');
const path = require('path');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE = 'https://inhyosong-commits.github.io/-/';
const STATE_URL = 'https://raw.githubusercontent.com/inhyosong-commits/-/data/alert-state.json';
const [marketPath, eventsPath, statePath] = process.argv.slice(2);
const root = path.join(__dirname, '..');

function names() {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), N = {};
  const ib = html.slice(html.indexOf('const INSTR = ['), html.indexOf('];', html.indexOf('const INSTR = [')));
  for (const m of ib.matchAll(/\['[a-z]+','([^']+)','([^']+)','([^']*)','([a-z]*)'/g)) N[m[1]] = { name: m[2], kind: m[4] || 'pct' };
  const sb = html.slice(html.indexOf('const SECTORS = ['), html.indexOf('const STOCK_SECTOR'));
  for (const m of sb.matchAll(/\['([^']+)','([^']+)'\]/g)) N[m[1]] = { name: m[2], kind: 'pct', stock: true };
  try { for (const x of JSON.parse(fs.readFileSync(path.join(root, 'config', 'extra-stocks.json'), 'utf8'))) N[x.sym] = { name: x.name, kind: 'pct', stock: true }; } catch (_) {}
  return N;
}
const kstDate = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const kstHour = (t = Date.now()) => new Date(t + 9 * 3600e3).getUTCHours();
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(1);

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

(async () => {
  const save = st => fs.writeFileSync(statePath, JSON.stringify(st));
  let st = { sent: {} };
  try { const r = await fetch(STATE_URL + '?t=' + Date.now()); if (r.ok) st = await r.json(); } catch (_) {}
  st.sent = st.sent || {};
  if (!TOKEN) { console.log('알림: TELEGRAM_BOT_TOKEN 없음 → 건너뜀'); save(st); return; }
  // 받는 사람 찾기: 봇에게 처음 말을 건 개인 대화
  let chat = process.env.TELEGRAM_CHAT_ID || st.chat;
  if (!chat) {
    const u = await tg('getUpdates', { limit: 50 });
    const m = (u.result || []).map(x => x.message || x.edited_message).filter(x => x && x.chat && x.chat.type === 'private').pop();
    if (!m) { console.log('알림: 아직 봇에게 보낸 메시지가 없음 → 텔레그램에서 봇에게 아무 말이나 보내 주세요'); save(st); return; }
    chat = st.chat = m.chat.id;
    await tg('sendMessage', { chat_id: chat, text: '✅ 연결됐어요! 이제 관심종목 급변, 실적 발표 전날, 미국 금리·물가 발표 전날, 그리고 매일 아침 요약을 보내 드릴게요.' });
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'alerts.json'), 'utf8'));
  const N = names(), mk = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
  let ev = {}; try { ev = JSON.parse(fs.readFileSync(eventsPath, 'utf8')); } catch (_) {}
  const today = kstDate(), msgs = [];
  const once = (key, text) => { const k = today + '|' + key; if (st.sent[k]) return; st.sent[k] = 1; msgs.push(text); };
  const M = s => { const v = mk.items && mk.items[s]; if (!v || !v.c || v.c.length < 62) return null;
    const c = v.c, n = c.length, abs = (N[s] || {}).kind === 'yield' || (N[s] || {}).kind === 'abs';
    const r = []; for (let i = n - 61; i < n - 1; i++) r.push(abs ? c[i] - c[i - 1] : Math.log(c[i] / c[i - 1]));
    const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) || 1e-9;
    const mv = abs ? c[n - 1] - c[n - 2] : Math.log(c[n - 1] / c[n - 2]);
    return { last: c[n - 1], d1: abs ? (c[n - 1] - c[n - 2]) * 100 : (c[n - 1] / c[n - 2] - 1) * 100, z: mv / sd, abs, time: v.marketTime }; };

  // 1) 관심종목 급변
  const watch = [...new Set([...(cfg.watch || []), '^VIX'])];
  for (const s of watch) {
    const m = M(s); if (!m || !N[s]) continue;
    if (m.time && Date.now() - m.time * 1000 > 20 * 3600e3) continue; // 오늘 거래가 없으면 건너뜀
    const big = N[s].stock ? Math.abs(m.d1) >= (cfg.stockMove || 5) : Math.abs(m.z) >= (cfg.macroZ || 2.5);
    if (s === '^VIX' && !(m.d1 >= 20 || m.last >= 30)) continue;
    if (!big && s !== '^VIX') continue;
    const lvl = N[s].stock ? Math.floor(Math.abs(m.d1) / 5) : Math.floor(Math.abs(m.z));
    const chg = m.abs ? `${m.d1 > 0 ? '+' : ''}${Math.round(m.d1)}bp` : `${sgn(m.d1)}%`;
    const why = s === '^VIX' ? '시장 공포가 커지고 있어요. 주식 전반이 흔들릴 수 있어요.' : `평소 하루 움직임의 ${Math.abs(m.z).toFixed(1)}배예요.`;
    once(`mv|${s}|${m.d1 > 0 ? 'u' : 'd'}|${lvl}`, `${m.d1 > 0 ? '🔺' : '🔻'} <b>${N[s].name}</b> ${chg} (지금 ${m.last.toLocaleString('en-US', { maximumFractionDigits: 2 })})\n${why}`);
  }
  // 2) 실적 발표 전날·당일 (관심종목)
  for (const s of cfg.watch || []) {
    const e = ev.earnings && ev.earnings[s]; if (!e || !N[s]) continue;
    const d = Math.round((Date.parse(kstDate(e.date)) - Date.parse(today)) / 864e5);
    if (d === 1 || d === 0) once(`earn|${s}|${kstDate(e.date)}`, `📅 <b>${N[s].name}</b> 실적 발표 ${d ? '내일' : '오늘'}${e.estimate ? ' (예상일)' : ''}\n결과에 따라 주가와 같은 업종 종목이 크게 움직일 수 있어요.`);
  }
  // 3) 미국 금리·물가·고용 발표 전날 (발표는 한국시간 밤~새벽)
  for (const x of ev.macro || []) {
    const d = Math.round((Date.parse(x.date) - Date.parse(today)) / 864e5);
    if (d === 0 && kstHour() >= 8) once(`macro|${x.date}|${x.kind}`, `🗓 오늘 밤 <b>${x.title}</b>\n${x.why}`);
  }
  // 4) 매일 아침 요약
  if (kstHour() >= (cfg.morningKST || 7) && kstHour() < 12 && !st.sent[today + '|morning']) {
    st.sent[today + '|morning'] = 1;
    const line = s => { const m = M(s); if (!m) return ''; return `${N[s] ? N[s].name : s} ${m.abs ? (m.d1 > 0 ? '+' : '') + Math.round(m.d1) + 'bp' : sgn(m.d1) + '%'}`; };
    const movers = (cfg.watch || []).map(s => ({ s, m: M(s) })).filter(x => x.m && N[x.s]).sort((a, b) => Math.abs(b.m.z) - Math.abs(a.m.z)).slice(0, 3);
    const upcoming = [...(ev.macro || []).map(x => ({ d: x.date, t: x.title })), ...Object.entries(ev.earnings || {}).filter(([s]) => (cfg.watch || []).includes(s) && N[s]).map(([s, e]) => ({ d: kstDate(e.date), t: N[s].name + ' 실적' }))]
      .filter(x => { const d = (Date.parse(x.d) - Date.parse(today)) / 864e5; return d >= 0 && d <= 7; }).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
    msgs.push(`☀️ <b>아침 요약</b> (${today})\n미국: ${line('^GSPC')} · ${line('^IXIC')}\n한국: ${line('^KS11')} · 원/달러 ${line('KRW=X').split(' ').pop()}\n원자재: ${line('CL=F')} · ${line('HG=F')} · ${line('GC=F')}\n`
      + (movers.length ? `\n내 종목 중 크게 움직인 것: ${movers.map(x => line(x.s)).join(', ')}` : '')
      + (upcoming.length ? `\n이번 주 일정: ${upcoming.map(x => `${x.d.slice(5).replace('-', '/')} ${x.t}`).join(', ')}` : '')
      + `\n\n<a href="${SITE}">대시보드 열기</a>`);
  }
  // 오래된 기록 정리 (7일)
  for (const k of Object.keys(st.sent)) if (k.slice(0, 10) < kstDate(Date.now() - 7 * 864e5)) delete st.sent[k];
  if (msgs.length) {
    const text = msgs.join('\n\n') + (msgs.some(t => t.includes('대시보드 열기')) ? '' : `\n\n<a href="${SITE}">대시보드 열기</a>`);
    const r = await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
    if (!r.ok) console.log('보내기 실패', r.description);
  }
  console.log('알림:', msgs.length, '건 보냄');
  save(st);
})().catch(e => console.error('알림 오류(배포는 계속):', e.message));
