// 원자재·매크로 모니터 - 로컬 서버 (의존성 없음, Node 18+)
// 실행: node server.js  →  http://localhost:8787
// 브라우저는 CORS 때문에 Yahoo Finance를 직접 못 부르므로, 이 서버가 대신 받아서 전달합니다.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchChart: fetchYahoo } = require('./lib/yahoo');

const PORT = Number(process.env.PORT) || 8787;
const CACHE_MS = 60 * 1000;          // 같은 종목은 60초 동안 캐시
const CONCURRENCY = 6;
const PUBLIC_DIR = path.join(__dirname, 'public');
const cache = new Map(); // key -> { at, data }
async function fetchChart(sym, range) {
  const key = sym + '|' + range, hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fetchYahoo(sym, range);
  cache.set(key, { at: Date.now(), data });
  return data;
}
const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,20}$/;
const RANGES = new Set(['3mo', '6mo', '1y', '2y']);
async function handleApi(req, res, url) {
  const syms = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(s => SYMBOL_RE.test(s)).slice(0, 80);
  const range = RANGES.has(url.searchParams.get('range')) ? url.searchParams.get('range') : '1y';
  const items = {}, errors = {};
  let i = 0;
  async function worker() {
    while (i < syms.length) {
      const s = syms[i++];
      try { items[s] = await fetchChart(s, range); }
      catch (e) { errors[s] = String(e.message || e); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ source: 'yahoo', fetchedAt: Date.now(), items, errors }));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/chart') return await handleApi(req, res, url);
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => {
  console.log(`\n  원자재·매크로 모니터 실행 중 →  http://localhost:${PORT}\n  (종료: Ctrl+C)\n`);
});
