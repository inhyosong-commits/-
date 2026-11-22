// 영어 → 한국어 번역 (Google 번역 공개 엔드포인트, 키 필요 없음). 실패하면 원문 그대로.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
async function one(text) {
  if (!text || !/[A-Za-z]{3}/.test(text) || fails > 5) return null;
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 1500))}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return (j[0] || []).map(x => x[0]).join('').trim() || null;
  } catch (e) { fails++; if (fails === 6) console.log('번역 실패가 많아 중단:', e.message); return null; }
}
// cache: 원문 → 번역 (이전 결과 재사용). 반환: 번역 함수
function makeTranslator(cache = {}) {
  let n = 0;
  const tr = async text => {
    if (!text) return null;
    if (cache[text]) return cache[text];
    const k = await one(text); n++;
    if (k) cache[text] = k;
    await sleep(120);
    return k;
  };
  tr.cache = cache; tr.count = () => n;
  return tr;
}
module.exports = { makeTranslator };
