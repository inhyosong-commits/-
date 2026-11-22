const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const show=async(label,u,h={})=>{ try{ const r=await fetch(u,{headers:{'User-Agent':UA,Accept:'application/json',...h}}); const t=await r.text(); console.log('##',label,r.status,t.slice(0,700).replace(/\s+/g,' ')); }catch(e){ console.log('##',label,'ERR',e.message);} };
(async()=>{
  const p2=Math.floor(Date.now()/1000), p1=p2-86400*800;
  await show('ts 005930.KS',`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/005930.KS?type=quarterlyOperatingIncome,quarterlyTotalRevenue&period1=${p1}&period2=${p2}`);
  await show('ts AAPL',`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?type=quarterlyOperatingIncome&period1=${p1}&period2=${p2}`);
  const r1=await fetch('https://fc.yahoo.com/',{headers:{'User-Agent':UA},redirect:'manual'}); const ck=(r1.headers.getSetCookie?r1.headers.getSetCookie():[]).map(c=>c.split(';')[0]).join('; ');
  const crumb=(await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,Cookie:ck}})).text()).trim();
  await show('trend AAPL',`https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=earningsTrend&crumb=${encodeURIComponent(crumb)}`,{Cookie:ck});
  await show('trend 005930.KS',`https://query2.finance.yahoo.com/v10/finance/quoteSummary/005930.KS?modules=earningsTrend&crumb=${encodeURIComponent(crumb)}`,{Cookie:ck});
  await show('naver fin quarter',`https://m.stock.naver.com/api/stock/005930/finance/quarter`,{Referer:'https://m.stock.naver.com/'});
  await show('naver fin annual',`https://m.stock.naver.com/api/stock/005930/finance/annual`,{Referer:'https://m.stock.naver.com/'});
  await show('naver integration industry',`https://m.stock.naver.com/api/stock/247540/integration`,{Referer:'https://m.stock.naver.com/'});
  await show('naver mv kosdaq',`https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=2`,{Referer:'https://m.stock.naver.com/'});
  await show('nasdaq nyse',`https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=2&exchange=nyse`,{Origin:'https://www.nasdaq.com',Referer:'https://www.nasdaq.com/'});
  await show('yahoo KQ11',`https://query1.finance.yahoo.com/v8/finance/chart/%5EKQ11?range=5d&interval=1d`);
})();
