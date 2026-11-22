// 영어 → 한국어 번역 (Google 번역 공개 엔드포인트, 키 필요 없음). 여러 문장을 한 번에 묶어 요청 수를 줄입니다.
// 실패하면 원문 그대로 둡니다.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 1순위: Microsoft Edge 번역 (브라우저 내장 번역과 같은 공개 경로), 2순위: Google
let edgeToken = null, edgeAt = 0;
async function edge(lines) {
  if (!edgeToken || Date.now() - edgeAt > 8 * 60e3) {
    const r = await fetch('https://edge.microsoft.com/translate/auth', { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('edge auth HTTP ' + r.status);
    edgeToken = (await r.text()).trim(); edgeAt = Date.now();
  }
  const r = await fetch('https://api-edge.cognitive.microsofttranslator.com/translate?from=en&to=ko&api-version=3.0&includeSentenceLength=false', {
    method: 'POST', headers: { 'User-Agent': UA, Authorization: 'Bearer ' + edgeToken, 'Content-Type': 'application/json' }, body: JSON.stringify(lines.map(Text => ({ Text }))) });
  if (!r.ok) throw new Error('edge HTTP ' + r.status);
  const j = await r.json();
  return j.map(x => (x.translations && x.translations[0] && x.translations[0].text || '').trim());
}
async function google(lines) {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'q=' + encodeURIComponent(lines.join('\n')) });
  if (!r.ok) throw new Error('google HTTP ' + r.status);
  const j = await r.json();
  return (j[0] || []).map(x => x[0]).join('').split('\n').map(x => x.trim());
}
let useEdge = true;
async function call(lines) {
  if (useEdge) { try { return await edge(lines); } catch (e) { console.log('Edge 번역 실패 → Google 시도:', e.message); useEdge = false; } }
  return google(lines);
}
// texts 배열을 번역해 { 원문: 번역 } 으로 cache 에 채움
async function translateAll(texts, cache = {}) {
  const todo = [...new Set(texts.filter(t => t && /[A-Za-z]{3}/.test(t) && !cache[t]).map(t => t.replace(/\s+/g, ' ').trim()))].filter(t => !cache[t]);
  let calls = 0, done = 0;
  for (let i = 0; i < todo.length;) {
    const batch = []; let len = 0;
    while (i < todo.length && len + todo[i].length < 3500 && batch.length < 40) { batch.push(todo[i]); len += todo[i].length + 1; i++; }
    if (!batch.length) { batch.push(todo[i].slice(0, 3500)); i++; }
    try {
      const out = await call(batch);
      calls++;
      if (out.length === batch.length) batch.forEach((t, k) => { if (out[k]) { cache[t] = out[k]; done++; } });
      else console.log('번역 줄 수 불일치', batch.length, out.length);
    } catch (e) { console.log('번역 실패:', e.message); break; }
    await sleep(700);
  }
  return { cache, calls, done, todo: todo.length };
}
module.exports = { translateAll };
