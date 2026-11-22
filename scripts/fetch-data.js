// GitHub Actions에서 15분마다 실행: 시세를 받아 public/market.json 으로 저장
// 사용: node scripts/fetch-data.js public/market.json [이전 market.json URL]
const fs = require('fs');
const path = require('path');
const { fetchMany } = require('../lib/yahoo');

(async () => {
  const out = process.argv[2] || 'public/market.json';
  const prevUrl = process.argv[3];
  // 종목 목록은 index.html 의 INSTR 한 곳에서만 관리
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const block = html.slice(html.indexOf('const INSTR = ['), html.indexOf('];', html.indexOf('const INSTR = [')));
  const syms = [...block.matchAll(/\['[a-z]+','([^']+)'/g)].map(m => m[1]);
  console.log('종목', syms.length, '개');

  const { items, errors } = await fetchMany(syms, '1y', 4);
  // 실패한 종목은 이전 데이터로 채움
  if (prevUrl && Object.keys(errors).length) {
    try {
      const prev = await (await fetch(prevUrl, { cache: 'no-store' })).json();
      for (const s of Object.keys(errors)) if (prev.items && prev.items[s]) { items[s] = prev.items[s]; items[s].stale = true; }
    } catch (e) { console.log('이전 데이터 없음:', e.message); }
  }
  const ok = Object.keys(items).length;
  console.log('성공', ok, '/ 실패', Object.keys(errors).length, errors);
  if (ok < 10) { console.error('데이터가 너무 적어 배포하지 않습니다'); process.exit(1); }
  // 용량 줄이기: 유효숫자 6자리
  for (const v of Object.values(items)) v.c = v.c.map(x => +x.toPrecision(6));
  fs.writeFileSync(out, JSON.stringify({ source: 'yahoo', fetchedAt: Date.now(), items, errors }));
  console.log('저장:', out, (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
})();
