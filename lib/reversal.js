// 상승 전환 후보 분석 (순수 계산 모듈) - 미래 데이터 없이 e 시점까지의 데이터만 사용
// 점수는 "상승 확률"이 아니라 "조건 충족도"입니다.
const PTS = { fin: 12, eps: 12, ma60: 10, ma20: 8, hl: 12, brk: 12, vol: 10, flow: 8, macd: 6, rs: 10 };
const LABEL = { fin: '재무 개선', eps: '실적 전망', ma60: '60일선 회복', ma20: '20일선 상승 전환', hl: '저점 상승(Higher Low)', brk: '직전 고점 돌파', vol: '거래량 증가', flow: '기관·외국인 수급', macd: 'MACD 상승 전환', rs: '시장 대비 강세 전환' };
const W = 5; // 저점·고점 확인 창 (앞뒤 5거래일)

function sma(c, k, e) { if (e - k + 1 < 0) return null; let s = 0; for (let i = e - k + 1; i <= e; i++) s += c[i]; return s / k; }
function emaSeries(c, k) { const a = 2 / (k + 1), out = []; let m = c[0]; for (let i = 0; i < c.length; i++) { m = i ? c[i] * a + m * (1 - a) : c[i]; out.push(m); } return out; }

// 기술적 분석 (e 시점 기준)
function tech(c, v, idx, e, opt) {
  const L = opt.L || 126, mult = opt.mult || 1.5;
  if (e < Math.max(130, L + 10)) return null;
  const last = c[e];
  const ma20 = sma(c, 20, e), ma60 = sma(c, 60, e), ma120 = sma(c, 120, e);
  const ma20p5 = sma(c, 20, e - 5);
  const s = e - L;
  // 저점: 기간 최저가
  let mlo = s; for (let i = s; i <= e; i++) if (c[i] < c[mlo]) mlo = i;
  const low = c[mlo];
  let hiBefore = 0; for (let i = s; i <= mlo; i++) hiBefore = Math.max(hiBefore, c[i]);
  let whi = 0; for (let i = s; i <= e; i++) whi = Math.max(whi, c[i]);
  const context = hiBefore / low >= 1.15 || whi / low <= 1.3; // 하락 또는 횡보 뒤
  // 확정된 저점(pivot low): 앞뒤 W일 중 최저, e 시점까지 확인된 것만
  const pivLows = [], pivHighs = [];
  for (let j = s + W; j <= e - W; j++) {
    let isL = true, isH = true;
    for (let k = j - W; k <= j + W; k++) { if (c[k] < c[j]) isL = false; if (c[k] > c[j]) isH = false; }
    if (isL) pivLows.push(j); if (isH) pivHighs.push(j);
  }
  const pl = pivLows.slice(-2), ph = pivHighs.slice(-2);
  const hhhl = pl.length === 2 && ph.length === 2 && c[pl[1]] > c[pl[0]] && c[ph[1]] > c[ph[0]];
  const hlIdx = pivLows.filter(j => j > mlo + W && c[j] > low * 1.02).pop();
  const hl = context && hlIdx != null && last > c[hlIdx] && mlo < e - 10;
  // 직전 주요 고점: 저점 이후 반등 고점 (Higher Low 앞)
  let refHi = null, refHiIdx = null;
  const endRef = hl ? hlIdx : e - 3;
  for (let j = mlo + 1; j <= endRef; j++) if (refHi == null || c[j] > refHi) { refHi = c[j]; refHiIdx = j; }
  const brk = refHi != null && refHiIdx > mlo && last > refHi && refHi > low * 1.05;
  let brkIdx = null; if (brk) for (let i = Math.max(refHiIdx + 1, (hlIdx || refHiIdx) + 1); i <= e; i++) if (c[i] > refHi) { brkIdx = i; break; }
  // 60일선 회복: 지금 위에 있고 최근 40일 안에 아래에서 올라옴
  let crossUp = null, belowLong = false;
  if (ma60 && last > ma60) {
    for (let i = e; i > e - 40 && i > 60; i--) { const m = sma(c, 60, i - 1); if (c[i - 1] <= m && c[i] > sma(c, 60, i)) { crossUp = i; break; } }
    if (crossUp != null) { let cnt = 0; for (let i = crossUp - 1; i > crossUp - 61 && i > 60; i--) if (c[i] < sma(c, 60, i)) cnt++; belowLong = cnt >= 40; }
  }
  const ma60ok = crossUp != null;
  // 20일선 기울기 상승 전환
  // 지금 오르는 중이고, 최근 40거래일 안에 내려가던(또는 평평하던) 구간이 있었음 = 전환
  let wasDown = false; for (let k = 8; k <= 40; k++) if (sma(c, 20, e - k) <= sma(c, 20, e - k - 5) * 1.001) { wasDown = true; break; }
  const ma20up = ma20 > ma20p5 * 1.003 && wasDown;
  // 거래량: 최근 5일 중 오른 날 거래량이 직전 20일 평균의 mult 배 이상
  let volx = null, volOk = null;
  if (v && v.length === c.length && v[e] > 0) {
    volx = 0;
    for (let i = e - 4; i <= e; i++) {
      let a = 0, n = 0; for (let k = i - 20; k < i; k++) if (v[k] > 0) { a += v[k]; n++; }
      if (!n) continue; const r = v[i] / (a / n);
      if (c[i] > c[i - 1]) volx = Math.max(volx, r);
    }
    volOk = volx >= mult;
  }
  // MACD
  const e12 = emaSeries(c.slice(0, e + 1), 12), e26 = emaSeries(c.slice(0, e + 1), 26);
  const macd = e12.map((x, i) => x - e26[i]), sig = emaSeries(macd, 9), hist = macd.map((x, i) => x - sig[i]);
  let gc = null; for (let i = e; i > e - 10; i--) if (hist[i] > 0 && hist[i - 1] <= 0) { gc = i; break; }
  const macdOk = gc != null || (hist[e] > hist[e - 1] && hist[e - 1] > hist[e - 2] && hist[e - 3] < 0);
  // 상대강도: 시장 지수 대비
  let rsOk = null;
  if (idx && idx[e] && idx[e - 20] && idx[e - 60]) {
    const rs = i => c[i] / idx[i];
    rsOk = rs(e) > rs(e - 20) * 1.02 && rs(e - 20) <= rs(e - 60) * 1.03 && (c[e] / c[e - 20]) > (idx[e] / idx[e - 20]);
  }
  // 1단계 지표
  let minLast20 = Infinity; for (let i = e - 19; i <= e; i++) minLast20 = Math.min(minLast20, c[i]);
  let v10 = 0, v60 = 0; if (v) { for (let i = e - 9; i <= e; i++) v10 += v[i] || 0; for (let i = e - 59; i <= e; i++) v60 += v[i] || 0; }
  const align = ma20 > ma60 && ma60 > ma120 && sma(c, 60, e) > sma(c, 60, e - 10);
  return { e, hhhl, last, ma20, ma60, ma120, low, mlo, hlIdx: hl ? hlIdx : null, hl, refHi, refHiIdx, brk, brkIdx, ma60ok, crossUp, belowLong, ma20up, volx, volOk, macdOk, gc, rsOk, context, minLast20, volDry: v ? v10 / 10 < v60 / 60 : null, align, rsi: rsi(c, e) };
}
function rsi(c, e) { let g = 0, l = 0; for (let i = e - 13; i <= e; i++) { const x = c[i] - c[i - 1]; if (x > 0) g += x; else l -= x; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }

// 항목별 충족 (true/false/null=N/A)
function items(t, f) {
  return { fin: f.fin == null ? null : f.fin, eps: f.eps == null ? null : f.eps, ma60: t.ma60ok, ma20: t.ma20up, hl: t.hl, brk: t.brk, vol: t.volOk, flow: f.flow == null ? null : f.flow, macd: t.macdOk, rs: t.rsOk };
}
function scoreOf(it) {
  let sc = 0, cov = 0; for (const k of Object.keys(PTS)) { if (it[k] == null) continue; cov += PTS[k]; if (it[k]) sc += PTS[k]; }
  return { sc, cov };
}
function stageOf(t, it) {
  if (!t) return 0;
  if (t.align && t.last > t.ma20 && t.hhhl) return 3;
  if (t.hl && t.last > t.ma60 && t.ma20up && (it.vol || it.fin || it.flow || it.brk)) return 2;
  // 1단계: 하락·횡보 뒤 저점 근처에서 더는 새 저점이 안 나오고, 아직 60일선 아래
  const nearLow = t.last <= t.low * 1.2, noNewLow = t.mlo <= t.e - 15 && t.minLast20 >= t.low * 0.99;
  if (t.context && nearLow && noNewLow && t.last < t.ma60 * 1.03) return 1;
  return 0;
}
module.exports = { PTS, LABEL, tech, items, scoreOf, stageOf, sma, rsi };
