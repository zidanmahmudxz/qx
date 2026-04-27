'use strict';
require('dotenv').config();
const https = require('https');
const db    = require('./database');

const TOKEN = process.env.TELEGRAM_TOKEN || '';

class TelegramManager {
  constructor() {
    this.ok = !!(TOKEN && !TOKEN.includes('your_'));
    this._offset = 0;
    this._polling = false;
    this._onFutureList = null; // callback for future signal list
    console.log(`[TG] ${this.ok?'✅ Ready':'❌ Not configured'}`);
  }

  // ── SEND to specific chat ──
  _send(chatId, text) {
    if (!this.ok) return;
    const body = JSON.stringify({ chat_id:chatId, text, parse_mode:'Markdown' });
    const req = https.request({
      hostname:'api.telegram.org', path:`/bot${TOKEN}/sendMessage`, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
    }, r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);if(!j.ok)console.error('[TG]',j.description,chatId);}catch(e){}});});
    req.on('error',e=>console.error('[TG]',e.message));
    req.write(body);req.end();
  }

  // ── BROADCAST to all chats with specific permission ──
  _broadcast(permField, text) {
    if (!this.ok) return;
    db.getActiveTgChats().forEach(chat => {
      if (chat[permField]) this._send(chat.chat_id, text);
    });
  }

  // ── LIVE SIGNAL ──
  sendLiveSignal(s) {
    if (!this.ok) return;
    const isCall = s.direction === 'CALL';
    const icon   = isCall ? '🟢' : '🔴';
    const arrow  = isCall ? '📈' : '📉';
    const et     = new Date(s.entryTime*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const xt     = new Date(s.expiryTime*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const strats = (s.matchedStrategies||[]).slice(0,3).map(x=>`  • ${x.name||x}`).join('\n')||'  • AI Analysis';
    const aiLine = s.aiReason ? `\n🤖 *AI:* \`${s.aiReason}\`` : '';

    const mainText =
`${icon} *${s.direction} SIGNAL*

${arrow} *${s.flag} ${s.name} (${s.market||'OTC'})*
━━━━━━━━━━━━━━━━━━
⏰ Entry:  \`${et}\`
⌛ Expiry: \`${xt}\`
⏱ Time:   \`1 Minute\`
━━━━━━━━━━━━━━━━━━
📊 Confidence: \`${s.confidence}%\`
${aiLine}
📋 *Matched Strategies:*
${strats}
🆔 \`${s.uid}\``;

    const customText = s.customMsg ? `\n\n💬 *${s.customMsg}*` : '';

    db.getActiveTgChats().forEach(chat => {
      if (!chat.perm_live_signal) return;
      const txt = chat.perm_custom_msg ? mainText+customText : mainText;
      this._send(chat.chat_id, txt);
    });
  }

  // ── LIVE RESULT ──
  sendLiveResult(s, result, closePrice, pnl) {
    if (!this.ok) return;
    const win  = result==='WIN';
    const icon = win?'🏆':'💔';
    const et   = new Date((s.entryTime||s.entry_time)*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const customText = s.customMsg||s.custom_msg ? `\n💬 *${s.customMsg||s.custom_msg}*` : '';

    const text =
`${icon} *RESULT — ${win?'✅ WIN':'❌ LOSS'}*

${s.flag} *${s.name}* | \`${s.direction}\`
⏰ Entry: \`${et}\`
📍 Close: \`${closePrice}\`
💰 PnL:   \`${pnl}\`
${customText}
${win?'🎉 টেক প্রফিট!':'⚠️ Loss। পরের সিগন্যালের অপেক্ষায়।'}
🆔 \`${s.uid||''}\``;

    db.getActiveTgChats().forEach(chat => {
      if (!chat.perm_live_result) return;
      this._send(chat.chat_id, text);
    });
  }

  // ── FUTURE SIGNAL (pre-delivery, 1 min before) ──
  sendFutureSignalPre(fs) {
    if (!this.ok) return;
    const dir   = fs.direction;
    const icon  = dir==='UP'||dir==='CALL'?'🔼':'⏬';
    const et    = new Date(fs.entry_time*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const text  =
`⚡ *UPCOMING SIGNAL*

${icon} *${fs.symbol_raw||fs.symbol}*
⏰ Entry Time: \`${et}\`
📊 Direction: \`${dir}\`

⚠️ _1 মিনিটের মধ্যে entry নিন_`;

    db.getActiveTgChats().forEach(chat => {
      if (chat.perm_future_pre) this._send(chat.chat_id, text);
    });
  }

  // ── FUTURE RESULT ──
  sendFutureResult(fs, result, closePrice) {
    if (!this.ok) return;
    const win  = result==='WIN';
    const icon = win?'🏆':'💔';
    const et   = new Date(fs.entry_time*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const text =
`${icon} *FUTURE SIGNAL RESULT — ${win?'✅ WIN':'❌ LOSS'}*

📊 *${fs.symbol_raw||fs.symbol}* | \`${fs.direction}\`
⏰ Entry: \`${et}\`
📍 Close: \`${closePrice||'N/A'}\`
${win?'🎉 Signal WIN!':'⚠️ Signal LOSS'}`;

    db.getActiveTgChats().forEach(chat => {
      if (chat.perm_future_result) this._send(chat.chat_id, text);
    });
  }

  // ── FUTURE BATCH EXPIRED RESULTS ──
  sendFutureBatchExpired(results) {
    if (!this.ok || !results.length) return;
    const lines = results.map((r,i)=>{
      const et=new Date(r.entry_time*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      const icon=r.result==='WIN'?'✅':r.result==='LOSS'?'❌':'❓';
      return `${i+1}. ${et} ${r.symbol_raw||r.symbol} ${r.direction} → ${icon} ${r.result||'N/A'}`;
    }).join('\n');

    const text = `📋 *Expired Future Signal Results:*\n\n${lines}`;
    db.getActiveTgChats().forEach(chat => {
      if (chat.perm_future_result) this._send(chat.chat_id, text);
    });
  }

  // ── STARTUP ──
  sendStartup(liveCount, signalCount) {
    this._broadcast('perm_live_signal',
      `🚀 *Signal Pro v5 চালু!*\n📡 Live: \`${liveCount}\` | Signal: \`${signalCount}\`\n🧠 AI + 16 Strategies\n✅ Ready`);
  }

  // ── KILL SWITCH ──
  sendSystemToggle(running) {
    this._broadcast('perm_live_signal', running ? '✅ *System STARTED*' : '⛔ *System STOPPED*');
  }

  // ── BOT POLLING (for future signal upload) ──
  startPolling(onFutureList) {
    if (!this.ok) return;
    this._onFutureList = onFutureList;
    this._poll();
    console.log('[TG] Bot polling started');
  }

  _poll() {
    if (!this.ok) return;
    const url = `/bot${TOKEN}/getUpdates?offset=${this._offset}&timeout=20&allowed_updates=["message"]`;
    const req = https.request({hostname:'api.telegram.org',path:url,method:'GET'}, res=>{
      let d='';res.on('data',c=>d+=c);
      res.on('end',()=>{
        try{
          const j=JSON.parse(d);
          if(j.ok&&j.result.length){
            j.result.forEach(u=>this._handleUpdate(u));
            this._offset=j.result[j.result.length-1].update_id+1;
          }
        }catch(e){}
        setTimeout(()=>this._poll(),1000);
      });
    });
    req.on('error',()=>setTimeout(()=>this._poll(),5000));
    req.end();
  }

  _handleUpdate(update) {
    const msg = update.message;
    if (!msg) return;
    const chatId = String(msg.chat.id);
    const text   = msg.text||'';

    // Check if this chat is authorized to send future signals
    if (!db.isFutureSource(chatId)) {
      if (text.startsWith('/start')) {
        this._send(chatId, `👋 *Signal Pro Bot*\n\nযদি Future Signal upload করতে চান, admin কে আপনার Chat ID দিন:\n\`${chatId}\``);
      }
      return;
    }

    if (text.startsWith('/start')) {
      this._send(chatId, `✅ *Authorized!*\n\nFuture Signal list paste করুন এই format এ:\n\`\`\`\n1. 14:41 USD/COP OTC DOWN\n2. 14:46 USD/COP OTC UP\n\`\`\``);
      return;
    }

    // Try to parse as future signal list
    const signals = this._parseFutureList(text);
    if (signals.length > 0) {
      if (this._onFutureList) this._onFutureList(signals, chatId);
      this._send(chatId, `✅ *${signals.length}টি Future Signal পাওয়া গেছে!*\nSystem এ upload হচ্ছে...`);
    } else {
      this._send(chatId, `❓ Format সঠিক নয়।\nExample:\n\`1. 14:41 USD/COP OTC DOWN\``);
    }
  }

  _parseFutureList(text) {
    const lines  = text.split('\n');
    const signals = [];
    const now    = new Date();

    for (const line of lines) {
      // Match: "1. 14:41 USD/COP OTC DOWN ⏬" or similar
      const m = line.match(/(\d+)\.\s+(\d{1,2}:\d{2})\s+([\w\/]+)\s+(OTC|FOREX|REAL)?\s*(UP|DOWN|CALL|PUT)/i);
      if (!m) continue;

      const [,num,timeStr,assetRaw,,dirRaw] = m;
      const dir = (dirRaw.toUpperCase()==='DOWN'||dirRaw.toUpperCase()==='PUT')?'PUT':'CALL';

      // Parse time (assume today's date)
      const [hh,mm] = timeStr.split(':').map(Number);
      const entryDate = new Date(now);
      entryDate.setHours(hh,mm,0,0);
      const entryTime = Math.floor(entryDate.getTime()/1000);

      // Map asset name to symbol
      const symbol = this._mapAsset(assetRaw);

      signals.push({
        symbolRaw: assetRaw + ' OTC',
        symbol,
        direction: dir,
        entryTime,
      });
    }
    return signals;
  }

  _mapAsset(raw) {
    // Convert "USD/COP" → "USDCOP-OTCq"
    const clean = raw.replace(/[^A-Z]/gi,'').toUpperCase();
    return `${clean}-OTCq`;
  }
}

module.exports = new TelegramManager();
