'use strict';
const db       = require('./database');
const telegram = require('./telegram');

class FutureSignalManager {
  constructor(){this.broadcast=null;this._checkInterval=null;}

  start(){
    this._checkInterval=setInterval(()=>this._tick(),5000);
    console.log('[FUTURE] Manager started');
  }

  // Called when bot receives a new list
  onNewList(signals,fromChatId){
    const batchId=`batch_${Date.now()}`;
    const now=Math.floor(Date.now()/1000);

    // Separate expired vs future
    const expired=signals.filter(s=>s.entryTime<=now);
    const upcoming=signals.filter(s=>s.entryTime>now);

    // Save upcoming to DB
    if(upcoming.length>0){
      db.saveFutureBatch(batchId,upcoming);
      console.log(`[FUTURE] Saved ${upcoming.length} signals (batch:${batchId})`);
    }

    // Handle already-expired signals immediately
    if(expired.length>0){
      console.log(`[FUTURE] ${expired.length} signals already expired — resolving from candles`);
      this._resolveExpired(expired,batchId);
    }

    if(this.broadcast){
      this.broadcast({type:'future_batch',count:upcoming.length,expired:expired.length,batchId});
    }
  }

  _resolveExpired(signals,batchId){
    // Save them first then resolve
    db.saveFutureBatch(batchId+'_exp',signals);
    const results=[];
    signals.forEach(s=>{
      const candles=db.getCandles(s.symbol,5);
      const targetCandle=candles.find(c=>c.time===s.entryTime||Math.abs(c.time-s.entryTime)<65);
      if(targetCandle){
        const result=this._evaluate(s.direction,targetCandle.open,targetCandle.close);
        db.closeFutureSignal(s.id||0,result,targetCandle.close);
        results.push({...s,result,close_price:targetCandle.close});
      } else {
        results.push({...s,result:'N/A',close_price:null});
      }
    });
    if(results.length>0) telegram.sendFutureBatchExpired(results);
  }

  _tick(){
    const now=Math.floor(Date.now()/1000);
    const preSec=parseInt(db.getSetting('future_pre_minutes','1'))*60;
    const pending=db.getPendingFutureSignals();

    pending.forEach(fs=>{
      const timeToEntry=fs.entry_time-now;

      // Send pre-signal (1 min before)
      if(!fs.delivered && timeToEntry<=preSec && timeToEntry>0){
        telegram.sendFutureSignalPre(fs);
        db.markFutureDelivered(fs.id);
        if(this.broadcast) this.broadcast({type:'future_pre',signal:fs});
      }

      // Check result (after expiry)
      if(timeToEntry<=-60){
        const candles=db.getCandles(fs.symbol,5);
        const target=candles.find(c=>Math.abs(c.time-fs.entry_time)<65);
        if(target){
          const result=this._evaluate(fs.direction,target.open,target.close);
          db.closeFutureSignal(fs.id,result,target.close);
          telegram.sendFutureResult(fs,result,target.close);
          if(this.broadcast) this.broadcast({type:'future_result',id:fs.id,result,closePrice:target.close});
        }
      }
    });
  }

  _evaluate(direction,open,close){
    if(direction==='CALL'||direction==='UP') return close>open?'WIN':'LOSS';
    return close<open?'WIN':'LOSS';
  }

  onTick(symbol,price,timestamp){
    // Can be used for real-time price tracking if needed
  }
}

module.exports=new FutureSignalManager();
