'use strict';
const db = require('./database');

// ══════════════════════════════════════════
//  strategies.js — All Strategy Logic
//  Quotex Binary Options Signal Generator
// ══════════════════════════════════════════

class StrategyRunner {
  constructor(candles, assetMarket='OTC') {
    this.c    = candles;
    this.n    = candles.length;
    this.mkt  = assetMarket;
    this.cls  = candles.map(x=>x.close);
    this.hgh  = candles.map(x=>x.high);
    this.low  = candles.map(x=>x.low);
    this.opn  = candles.map(x=>x.open);
    this.vol  = candles.map(x=>x.volume||0);
    this._strats = db.getStrategies();
  }

  run() {
    if (this.n < 5) return null;
    const results = [];

    for (const s of this._strats) {
      if (!s.enabled) continue;
      if (s.market_type !== 'BOTH' && s.market_type !== this.mkt) continue;

      let res = null;
      try {
        switch(s.key) {
          case '2g2r':     res = this._2g2r(s.params);     break;
          case '3g2r':     res = this._3g2r(s.params);     break;
          case 'fractal':  res = this._fractal(s.params);  break;
          case 'rsi_ob_os':res = this._rsiObOs(s.params);  break;
          case 'rsi_cross':res = this._rsiCross(s.params); break;
          case 'rsi_div':  res = this._rsiDiv(s.params);   break;
          case 'color_seq':res = this._colorSeq();         break;
          case 'doji_rev': res = this._dojiRev();          break;
          case 'sr_bounce':res = this._srBounce();         break;
          case 'momentum': res = this._momentum();         break;
          case 'engulfing':res = this._engulfing();        break;
          case 'hammer':   res = this._hammer();           break;
          case 'pin_bar':  res = this._pinBar();           break;
          case 'mean_rev': res = this._meanRev(s.params);  break;
          case 'vol_spike':res = this._volSpike();         break;
          case 'hh_hl':    res = this._hhHl();             break;
        }
      } catch(e) {}

      if (res) {
        results.push({ key:s.key, name:s.name, signal:res.signal, reason:res.reason, weight:res.weight||1.0 });
      }
    }

    // Tally
    let callW=0, putW=0;
    const callStrats=[], putStrats=[];
    results.forEach(r => {
      if(r.signal==='CALL'){callW+=r.weight;callStrats.push(r);}
      else if(r.signal==='PUT'){putW+=r.weight;putStrats.push(r);}
    });

    const lean = callW>putW?'CALL':putW>callW?'PUT':'NEUTRAL';
    const total = callW+putW;
    const strength = total>0?Math.round((Math.max(callW,putW)/total)*100):0;

    return {
      lean, strength, callW:+callW.toFixed(2), putW:+putW.toFixed(2),
      callStrats, putStrats,
      allMatched: lean==='CALL'?callStrats:putStrats,
      context: this._ctx(),
      last30: this.c.slice(-30).map(c=>({
        t:c.time, o:+c.open.toFixed(5), h:+c.high.toFixed(5),
        l:+c.low.toFixed(5), c:+c.close.toFixed(5), v:c.volume||0,
        bull:c.close>=c.open,
        body:+Math.abs(c.close-c.open).toFixed(5),
        uWick:+(c.high-Math.max(c.open,c.close)).toFixed(5),
        lWick:+(Math.min(c.open,c.close)-c.low).toFixed(5),
      })),
    };
  }

  // ── Helpers ──
  _isDownTrend(lookback=10) {
    if (this.n < lookback+1) return false;
    const slice = this.cls.slice(-lookback);
    // EMA comparison
    const ema5 = this._ema(slice, 5);
    const ema10 = this._ema(slice, Math.min(10,slice.length));
    const lastEma5 = ema5[ema5.length-1];
    const lastEma10 = ema10[ema10.length-1];
    const priceBelow = this.cls[this.n-1] < slice.reduce((a,b)=>a+b,0)/slice.length;
    const higherClose = slice[slice.length-1] < slice[0]; // overall downward
    return lastEma5 < lastEma10 && (priceBelow || higherClose);
  }

  _isUpTrend(lookback=10) {
    if (this.n < lookback+1) return false;
    const slice = this.cls.slice(-lookback);
    const ema5 = this._ema(slice, 5);
    const ema10 = this._ema(slice, Math.min(10,slice.length));
    const lastEma5 = ema5[ema5.length-1];
    const lastEma10 = ema10[ema10.length-1];
    return lastEma5 > lastEma10;
  }

  _rsiArr(period=14) {
    const d=this.cls; const n=d.length;
    const r=new Array(n).fill(50); let ag=0,al=0;
    if(n<period+1) return r;
    for(let i=1;i<=period;i++){const df=d[i]-d[i-1];df>0?ag+=df:al+=Math.abs(df);}
    ag/=period;al/=period;
    for(let i=period;i<n;i++){
      if(i===period){r[i]=100-100/(1+(al===0?9999:ag/al));continue;}
      const df=d[i]-d[i-1],g=df>0?df:0,l=df<0?Math.abs(df):0;
      ag=(ag*(period-1)+g)/period;al=(al*(period-1)+l)/period;
      r[i]=100-100/(1+(al===0?9999:ag/al));
    }
    return r;
  }

  _ema(d,p) {
    const r=new Array(d.length).fill(0); const k=2/(p+1); let v=0,ok=false;
    for(let i=0;i<d.length;i++){
      if(i<p-1)continue;
      if(!ok){let s=0;for(let j=0;j<p&&j<d.length;j++)s+=d[j];v=s/Math.min(p,d.length);r[i]=v;ok=true;}
      else{v=d[i]*k+v*(1-k);r[i]=v;}
    }
    return r;
  }

  // ══════════════════════════════════
  //  NEW STRATEGIES
  // ══════════════════════════════════

  // Strategy: 2 Green 2 Red
  _2g2r() {
    if (this.n < 4) return null;
    if (!this._isDownTrend()) return null;
    const c = this.c;
    const n = this.n;
    // Pattern: G, G, R at positions n-3, n-2, n-1
    const isG2 = c[n-3].close >= c[n-3].open; // Green
    const isG1 = c[n-2].close >= c[n-2].open; // Green
    const isR0 = c[n-1].close < c[n-1].open;  // Red (last closed)
    if (isG2 && isG1 && isR0) {
      return { signal:'PUT', reason:'Down trend: 2 Green → Red → next PUT', weight:2.5 };
    }
    return null;
  }

  // Strategy: 3 Green 2 Red
  _3g2r() {
    if (this.n < 5) return null;
    if (!this._isDownTrend()) return null;
    const c = this.c; const n = this.n;
    const isG3 = c[n-4].close >= c[n-4].open;
    const isG2 = c[n-3].close >= c[n-3].open;
    const isG1 = c[n-2].close >= c[n-2].open;
    const isR0 = c[n-1].close < c[n-1].open;
    if (isG3 && isG2 && isG1 && isR0) {
      return { signal:'PUT', reason:'Down trend: 3 Green → Red → next PUT', weight:3.0 };
    }
    return null;
  }

  // Strategy: Fractal (Williams Fractal)
  // Bearish Fractal (down arrow) in downtrend → PUT signal
  // Fractal forms when middle candle LOW is lower than 2 candles on each side
  _fractal(params={}) {
    const period = parseInt(params.period)||2;
    const n = this.n;
    if (n < period*2+1) return null;
    if (!this._isDownTrend()) return null;

    // Check if latest completed candle (n-1-period) has a Bearish Fractal
    // Bearish Fractal: middle.LOW < all surrounding lows
    // In downtrend, bearish fractal (pointing DOWN) signals continuation
    const mid = n - 1 - period; // middle candle
    if (mid < 0) return null;

    let isFractalDown = true;
    for (let i = 1; i <= period; i++) {
      if (this.low[mid] >= this.low[mid-i]) { isFractalDown = false; break; }
      if (this.low[mid] >= this.low[mid+i]) { isFractalDown = false; break; }
    }

    if (isFractalDown) {
      return { signal:'PUT', reason:`Bearish Fractal (period:${period}) in downtrend → PUT`, weight:3.0 };
    }
    return null;
  }

  // Strategy: RSI Overbought/Oversold
  _rsiObOs(params={}) {
    const period = parseInt(params.period)||14;
    const ob = parseInt(params.ob)||70;
    const os = parseInt(params.os)||30;
    const rsi = this._rsiArr(period);
    const rsiNow = rsi[this.n-1];
    if (rsiNow >= ob) return { signal:'PUT',  reason:`RSI Overbought (${rsiNow.toFixed(1)} ≥ ${ob}) → PUT`, weight:2.0 };
    if (rsiNow <= os) return { signal:'CALL', reason:`RSI Oversold (${rsiNow.toFixed(1)} ≤ ${os}) → CALL`, weight:2.0 };
    return null;
  }

  // Strategy: RSI Centerline Cross
  _rsiCross(params={}) {
    const period = parseInt(params.period)||14;
    const rsi = this._rsiArr(period);
    const n = this.n;
    const cur = rsi[n-1], prev = rsi[n-2];
    if (prev < 50 && cur >= 50) return { signal:'CALL', reason:`RSI crossed above 50 → CALL`, weight:1.5 };
    if (prev > 50 && cur <= 50) return { signal:'PUT',  reason:`RSI crossed below 50 → PUT`,  weight:1.5 };
    return null;
  }

  // Strategy: RSI Divergence
  _rsiDiv(params={}) {
    const period = parseInt(params.period)||14;
    const rsi = this._rsiArr(period);
    const n = this.n;
    if (n < 10) return null;
    // Look at last 8 candles for divergence
    const priceMin1 = Math.min(...this.cls.slice(-8,-4));
    const priceMin2 = Math.min(...this.cls.slice(-4));
    const rsiMin1   = Math.min(...rsi.slice(-8,-4));
    const rsiMin2   = Math.min(...rsi.slice(-4));
    // Bullish divergence: price making lower low, RSI making higher low
    if (priceMin2 < priceMin1 && rsiMin2 > rsiMin1) {
      return { signal:'CALL', reason:'Bullish RSI divergence → CALL', weight:2.5 };
    }
    const priceMax1 = Math.max(...this.cls.slice(-8,-4));
    const priceMax2 = Math.max(...this.cls.slice(-4));
    const rsiMax1   = Math.max(...rsi.slice(-8,-4));
    const rsiMax2   = Math.max(...rsi.slice(-4));
    // Bearish divergence
    if (priceMax2 > priceMax1 && rsiMax2 < rsiMax1) {
      return { signal:'PUT', reason:'Bearish RSI divergence → PUT', weight:2.5 };
    }
    return null;
  }

  // ══════════════════════════════════
  //  EXISTING STRATEGIES
  // ══════════════════════════════════

  _colorSeq() {
    if (this.n < 4) return null;
    const c = this.c, n = this.n;
    const cols = [c[n-4],c[n-3],c[n-2],c[n-1]].map(x=>x.close>=x.open?'G':'R');
    if (cols[0]==='R'&&cols[1]==='R'&&cols[2]==='R') return {signal:'CALL',reason:'3 Red → reversal CALL',weight:2.0};
    if (cols[0]==='G'&&cols[1]==='G'&&cols[2]==='G') return {signal:'PUT', reason:'3 Green → reversal PUT',weight:2.0};
    return null;
  }

  _dojiRev() {
    if (this.n < 2) return null;
    const c = this.c[this.n-1];
    const range = c.high-c.low||0.00001;
    const body  = Math.abs(c.close-c.open);
    if (body/range < 0.15) {
      const prev = this.c[this.n-2];
      const signal = prev.close>prev.open?'PUT':'CALL';
      return {signal,reason:`Doji after ${prev.close>prev.open?'green':'red'} → ${signal}`,weight:2.0};
    }
    return null;
  }

  _srBounce() {
    if (this.n < 10) return null;
    const price=this.cls[this.n-1], lb=Math.min(30,this.n);
    const hi=Math.max(...this.hgh.slice(-lb)), lo=Math.min(...this.low.slice(-lb));
    const dR=(hi-price)/price, dS=(price-lo)/price;
    if (dS<0.0008&&dS<dR) return {signal:'CALL',reason:`Near support ${lo.toFixed(5)} → CALL`,weight:2.5};
    if (dR<0.0008&&dR<dS) return {signal:'PUT', reason:`Near resistance ${hi.toFixed(5)} → PUT`,weight:2.5};
    return null;
  }

  _momentum() {
    if (this.n < 8) return null;
    const cls=this.cls,n=this.n;
    const m5=cls[n-1]-cls[n-6], m1=cls[n-1]-cls[n-2];
    const pm5=cls[n-2]-cls[n-7], acc=m5-pm5;
    if (m5>0&&m1<0&&acc<0) return {signal:'PUT', reason:'Bull momentum reversing → PUT',weight:2.0};
    if (m5<0&&m1>0&&acc>0) return {signal:'CALL',reason:'Bear momentum reversing → CALL',weight:2.0};
    return null;
  }

  _engulfing() {
    if (this.n < 2) return null;
    const c0=this.c[this.n-1],c1=this.c[this.n-2];
    if (c1.close<c1.open&&c0.close>c0.open&&c0.open<c1.close&&c0.close>c1.open)
      return {signal:'CALL',reason:'Bullish engulfing → CALL',weight:3.0};
    if (c1.close>c1.open&&c0.close<c0.open&&c0.open>c1.close&&c0.close<c1.open)
      return {signal:'PUT', reason:'Bearish engulfing → PUT',weight:3.0};
    return null;
  }

  _hammer() {
    if (this.n < 2) return null;
    const c=this.c[this.n-1],prev=this.c[this.n-2];
    const body=Math.abs(c.close-c.open),range=c.high-c.low||0.00001;
    const lWick=Math.min(c.open,c.close)-c.low, uWick=c.high-Math.max(c.open,c.close);
    if (prev.close<prev.open&&lWick>body*2&&uWick<body*0.5)
      return {signal:'CALL',reason:'Hammer after downtrend → CALL',weight:2.5};
    if (prev.close>prev.open&&uWick>body*2&&lWick<body*0.5)
      return {signal:'PUT', reason:'Shooting Star after uptrend → PUT',weight:2.5};
    return null;
  }

  _pinBar() {
    if (this.n < 1) return null;
    const c=this.c[this.n-1];
    const range=c.high-c.low||0.00001;
    const body=Math.abs(c.close-c.open);
    const lWick=Math.min(c.open,c.close)-c.low;
    const uWick=c.high-Math.max(c.open,c.close);
    if (lWick/range>0.6&&body/range<0.25) return {signal:'CALL',reason:'Bullish pin bar → CALL',weight:2.0};
    if (uWick/range>0.6&&body/range<0.25) return {signal:'PUT', reason:'Bearish pin bar → PUT',weight:2.0};
    return null;
  }

  _meanRev(params={}) {
    const thr=parseFloat(params.threshold)||0.06;
    if (this.n < 20) return null;
    const avg=this.cls.slice(-20).reduce((a,b)=>a+b,0)/20;
    const dev=(this.cls[this.n-1]-avg)/avg*100;
    if (dev>thr)  return {signal:'PUT', reason:`${dev.toFixed(3)}% above avg → revert PUT`,weight:2.0};
    if (dev<-thr) return {signal:'CALL',reason:`${Math.abs(dev).toFixed(3)}% below avg → revert CALL`,weight:2.0};
    return null;
  }

  _volSpike() {
    if (this.n < 5) return null;
    const avg=this.vol.slice(-5).reduce((a,b)=>a+b,0)/5;
    const cur=this.vol[this.n-1], move=this.cls[this.n-1]-this.cls[this.n-2];
    if (cur>avg*1.8) return {signal:move>0?'CALL':'PUT',reason:`Volume ${(cur/avg).toFixed(1)}x spike → ${move>0?'CALL':'PUT'}`,weight:1.5};
    return null;
  }

  _hhHl() {
    if (this.n < 6) return null;
    const c=this.c, n=this.n;
    const swings=[];
    for(let i=2;i<n-1;i++){
      if(c[i].high>c[i-1].high&&c[i].high>c[i+1]?.high) swings.push({t:'H',v:c[i].high});
      if(c[i].low<c[i-1].low&&c[i].low<c[i+1]?.low)   swings.push({t:'L',v:c[i].low});
    }
    if(swings.length<4) return null;
    const last4=swings.slice(-4);
    const hs=last4.filter(s=>s.t==='H'), ls=last4.filter(s=>s.t==='L');
    if(hs.length>=2&&ls.length>=2){
      if(hs[1].v>hs[0].v&&ls[1].v>ls[0].v) return {signal:'CALL',reason:'HH+HL uptrend structure → CALL',weight:2.0};
      if(hs[1].v<hs[0].v&&ls[1].v<ls[0].v) return {signal:'PUT', reason:'LH+LL downtrend structure → PUT',weight:2.0};
    }
    return null;
  }

  _ctx() {
    const n=this.n, cls=this.cls;
    if(n<5) return {};
    const price=cls[n-1];
    const hi20=Math.max(...this.hgh.slice(-20)), lo20=Math.min(...this.low.slice(-20));
    const avg20=cls.slice(-20).reduce((a,b)=>a+b,0)/20;
    const range=hi20-lo20;
    const pos=range>0?((price-lo20)/range*100).toFixed(1):50;
    const rsi=this._rsiArr(14);
    return {
      price:+price.toFixed(5), hi20:+hi20.toFixed(5), lo20:+lo20.toFixed(5),
      avg20:+avg20.toFixed(5), posInRange:+pos,
      rsi:+rsi[n-1].toFixed(1),
      downTrend:this._isDownTrend(), upTrend:this._isUpTrend(),
      colors5:this.c.slice(-5).map(c=>c.close>=c.open?'G':'R').join(''),
    };
  }
}

module.exports = { StrategyRunner };
