// 지표·섹터별 한국어 뉴스 헤드라인 수집 (Google 뉴스 RSS, 키 필요 없음)
// 사용: node scripts/fetch-news.js public/news.json [이전 news.json URL]
// 뉴스는 1시간에 한 번만 새로 받고, 그 사이에는 이전 결과를 재사용합니다.
const fs = require('fs');
const path = require('path');
const { translateAll } = require('../lib/translate');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REFRESH_MS = 55 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

const LOCALE = { ko: 'hl=ko&gl=KR&ceid=KR:ko', en: 'hl=en-US&gl=US&ceid=US:en' };
async function fetchTopic(q, lang = 'ko') {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&${LOCALE[lang]}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const x = m[1];
    const source = tag(x, 'source');
    let title = tag(x, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(x, 'link'), source, time: Date.parse(tag(x, 'pubDate')) || null };
  }).filter(n => n.title && /^https?:\/\//.test(n.link));
  // 같은 제목 중복 제거, 최신순 6개
  const seen = new Set();
  return items.filter(n => { const k = n.title.replace(/\s+/g, '').slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 6);
}

(async () => {
  const out = process.argv[2] || 'public/news.json';
  const prevUrl = process.argv[3];
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const a = html.indexOf('/*NEWS-TOPICS*/') + '/*NEWS-TOPICS*/'.length, b = html.indexOf('/*END-NEWS-TOPICS*/');
  const all = JSON.parse(html.slice(a, b).trim().replace(/^const NEWS_TOPICS_ALL\s*=\s*/, '').replace(/;\s*$/, ''));
  // 국내(ko)는 키 그대로, 해외(en)는 'en:키' 로 저장
  const topics = {};
  for (const [k, q] of Object.entries(all.ko || {})) topics[k] = [q, 'ko'];
  for (const [k, q] of Object.entries(all.en || {})) topics['en:' + k] = [q, 'en'];

  let prev = null;
  if (prevUrl) { try { prev = await (await fetch(prevUrl, { cache: 'no-store' })).json(); } catch (e) { console.log('이전 뉴스 없음'); } }
  const sameTopics = prev && prev.v === 3 && prev.topics && Object.keys(topics).every(k => k in prev.topics);
  if (sameTopics && prev.fetchedAt && Date.now() - prev.fetchedAt < REFRESH_MS && process.env.FORCE_NEWS !== '1') {
    fs.writeFileSync(out, JSON.stringify(prev));
    console.log('뉴스: 최근 것 재사용 (', Math.round((Date.now() - prev.fetchedAt) / 60000), '분 전 수집)');
    return;
  }
  const result = { v: 3, fetchedAt: Date.now(), topics: {} }, errors = {};
  for (const [key, [q, lang]] of Object.entries(topics)) {
    try { result.topics[key] = await fetchTopic(q, lang); }
    catch (e) { errors[key] = e.message; if (prev && prev.topics && prev.topics[key]) result.topics[key] = prev.topics[key]; }
    await sleep(400);
  }
  // 해외 뉴스 제목 번역 (이전 번역 재사용)
  const cache = {};
  if (prev && prev.topics) for (const v of Object.values(prev.topics)) for (const x of v || []) if (x.ko && x.title) cache[x.title] = x.ko;
  const enItems = Object.entries(result.topics).filter(([k]) => k.startsWith('en:')).flatMap(([, v]) => v || []);
  const T = await translateAll(enItems.map(x => x.title), cache);
  for (const x of enItems) { const k = cache[x.title.replace(/\s+/g, ' ').trim()]; if (k) x.ko = k; }
  console.log('번역: 새로', T.done, '/', T.todo, '건 (요청', T.calls, '번)');
  const ok = Object.values(result.topics).filter(v => v && v.length).length;
  console.log('뉴스: 주제', Object.keys(topics).length, '개 중', ok, '개 수집', Object.keys(errors).length ? errors : '');
  if (!ok && prev) { fs.writeFileSync(out, JSON.stringify(prev)); return; }
  fs.writeFileSync(out, JSON.stringify(result));
})().catch(e => { console.error('뉴스 실패(시세 배포는 계속):', e.message); try { fs.writeFileSync(process.argv[2] || 'public/news.json', JSON.stringify({ fetchedAt: 0, topics: {} })); } catch (_) {} });
