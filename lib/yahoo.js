// Yahoo Finance 일봉 시세 가져오기 (server.js 와 scripts/fetch-data.mjs 가 함께 사용)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchChart(sym, range = '1y') {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      try {
        const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d&includePrePost=false`;
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        if (!r) throw new Error('no result');
        const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
        const t = [], c = [], vol = [];
        (r.timestamp || []).forEach((ts, i) => {
          const v = q.close && q.close[i];
          if (v != null && isFinite(v)) { t.push(ts); c.push(v); vol.push(q.volume && q.volume[i] || 0); }
        });
        const m = r.meta || {};
        // 마지막 값은 최신(지연) 가격으로 덮어쓰기
        if (m.regularMarketPrice != null && c.length) {
          const lastDay = new Date(t[t.length - 1] * 1000).toISOString().slice(0, 10);
          const mktDay = new Date((m.regularMarketTime || 0) * 1000).toISOString().slice(0, 10);
          if (lastDay === mktDay) c[c.length - 1] = m.regularMarketPrice;
          else if (m.regularMarketTime > t[t.length - 1]) { t.push(m.regularMarketTime); c.push(m.regularMarketPrice); vol.push(m.regularMarketVolume || 0); }
        }
        return { t, c, vol, price: m.regularMarketPrice, currency: m.currency, marketTime: m.regularMarketTime, exchange: m.exchangeName };
      } catch (e) { lastErr = e; }
    }
    await sleep(1500);
  }
  throw lastErr;
}

async function fetchMany(syms, range = '1y', concurrency = 4) {
  const items = {}, errors = {};
  let i = 0;
  async function worker() {
    while (i < syms.length) {
      const s = syms[i++];
      try { items[s] = await fetchChart(s, range); }
      catch (e) { errors[s] = String(e.message || e); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { items, errors };
}

module.exports = { fetchChart, fetchMany };
