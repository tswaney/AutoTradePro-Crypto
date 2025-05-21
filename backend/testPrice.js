// backend/testPrice.js
// ==============================================
// Grid Bot with Strategy Selection, Manual Holdings,
// Simulated Trading, and Status Shortcut (Ctrl+S) + Grid View (Ctrl+G)
// ==============================================

// Load environment variables
require('dotenv').config();

// Core modules
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getAccessToken } = require('./sessionManager');

// ==============================================
// Configuration (tunable parameters by strategy)
// ==============================================
const config = {
  // — Feature toggles —
  aiEnabled: process.env.AI_ENABLED === 'true',   // Enable AI-driven adjustments
  demoMode: process.env.DEMO_MODE === 'true',     // Simulate trades if true, otherwise live
  liveTest: false,                                // Execute a small real trade ($0.01) for smoke-test
  testMode: false,                                // Bypass slippage & live-trade checks

  // — Portfolio sizing & risk management —
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000, // Starting USD balance
  maxTradePercent: 0.5,       // % of available cash per trade
  profitLockPercent: 0.2,     // % of profit locked after a sell
  minTradeAmount: 0.01,       // Minimum USD amount per trade
  cashReservePercent: 0.15,   // % of cash held in reserve

  // — Entry/exit threshold parameters —
  baseBuyThreshold: -0.000005,   // % drop from last price to trigger BUY (-0.5%)
  baseSellThreshold: 0.00005,     // % gain from cost basis to trigger SELL (+5%)
  dailyProfitTarget: 100, /// 400.2,    // USD profit goal per 24h

  // — ATR & grid trading settings —
  atrLookbackPeriod: 14,       // ATR lookback periods
  gridLevels: 5,               // Grid levels for grid strategy
  defaultSlippage: 0.02,       // Assumed slippage %

  // — Trade cadence & API limits —
  checkInterval: 30000,        // ms between strategy loops
  priceDecimalPlaces: 8,       // Decimal places in price formatting
  buyLimit: 22,                // Max buys per 24h
  sellLimit: 23,               // Max sells per 24h
  stopLossLimit: 5,            // Max stop-losses per 24h
  stopLossPercent: -0.3,       // Stop-loss trigger (-30%)

  // — Strategy metadata —
  strategy: '',                // Name & version of selected strategy
};

// Minimum profit per trade to hit daily target
const minProfitPerTrade = config.dailyProfitTarget / config.sellLimit;

// Display mode and key controls
console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
console.log("Press CTRL+S for Status, CTRL+G for Grid view, CTRL+C to exit\n");

// ==============================================
// API & Portfolio State
// ==============================================
const BASE_URL = 'https://api.robinhood.com/marketdata/forex/quotes/';
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {},
  buysToday: 0,
  sellsToday: 0,
  stopLossesToday: 0,
  dailyProfitTotal: 0,
  startTime: new Date(),
  lastReset: new Date(),
  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let strategies = {}, selectedStrategy = null;

// ==============================================
// Helper Functions & Core Logic
// ==============================================

/** Initialize per-symbol strategy state */
function initializeStrategy(symbol) {
  return {
    buyThreshold: config.baseBuyThreshold,
    sellThreshold: config.baseSellThreshold,
    atr: 0,
    dynamicBuyThreshold: null,
    dynamicSellThreshold: null,
    trend: 'neutral',
    slippage: config.defaultSlippage,
    priceHistory: [],
    trendHistory: [],
    lastPrice: null,
    module: selectedStrategy,
    recent24h: [],
  };
}

/** Prompt strategy selection */
async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, 'strategies'))
                  .filter(f => f.endsWith('.js')).sort();
  const modules = files.map(f => require(`./strategies/${f}`))
                       .filter(m => m.name && m.version && m.description);
  console.log('\n📌 Available Strategies:');
  modules.forEach((s,i) => console.log(` [${i+1}] ${s.name} (${s.version}) - ${s.description}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question('\nSelect strategy [default 4]: ', input => {
    const idx = parseInt(input.trim(),10);
    const strat = modules[(idx>0 && idx<=modules.length) ? idx-1 : 3];
    rl.close();
    config.strategy = `${strat.name} (${strat.version})`;
    selectedStrategy = strat;
    resolve();
  }));
}

/** Load manual holdings */
function loadHoldings() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cryptoHoldings.json'),'utf8'));
  for(const sym in data){ const { amount, costBasis } = data[sym];
    if(amount > config.minTradeAmount) portfolio.cryptos[sym] = { amount, costBasis, grid: [] };
  }
}

/** Refresh cost basis in demo mode */
async function refreshDemoCostBasis() {
  for(const sym of Object.keys(portfolio.cryptos)){
    const info = await getPrice(sym);
    if(info) portfolio.cryptos[sym].costBasis = info.price;
  }
  fs.writeFileSync(path.join(__dirname,'cryptoHoldings.json'),
    JSON.stringify(portfolio.cryptos, null, 2)
  );
}

/** Print current holdings */
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(([sym,{amount,costBasis}],i)=>({
    No:String(i+1), Symbol:sym,
    Quantity:amount.toFixed(6),
    Price:(strategies[sym].lastPrice||0).toFixed(config.priceDecimalPlaces),
    CostBasis:costBasis.toFixed(6)
  }));
  const cols=['No','Symbol','Quantity','Price','CostBasis'];
  const widths={}; cols.forEach(c=>widths[c]=Math.max(c.length,...rows.map(r=>r[c].length)));
  const sep=(l,m,r)=>{let line=l; cols.forEach((c,i)=>line+= '─'.repeat(widths[c]+2)+(i<cols.length-1?m:r)); return line;};
  console.log('\nCurrent Holdings:'); console.log(sep('┌','┬','┐'));
  let hdr='│'; cols.forEach(c=>{const pad=widths[c]-c.length,left=Math.floor(pad/2),right=pad-left;hdr+=` ${' '.repeat(left)}${c}${' '.repeat(right)} │`;});
  console.log(hdr); console.log(sep('├','┼','┤')); rows.forEach(r=>{let line='│';cols.forEach(c=>{const v=r[c],pad=widths[c]-v.length;line+=` ${v}${' '.repeat(pad)} │`;});console.log(line);});
  console.log(sep('└','┴','┘'));
}

/** Fetch market price and update strategy state */
async function getPrice(symbol) {
  const token = await getAccessToken();
  try{
    const res = await axios.get(`${BASE_URL}${symbol}/`,{headers:{Authorization:`Bearer ${token}`,"User-Agent":"Mozilla/5.0",Accept:"application/json",Origin:"https://robinhood.com"},timeout:10000});
    const price=parseFloat(res.data.mark_price); const strat=strategies[symbol],prev=strat.lastPrice;
    strat.priceHistory.push(price); if(strat.priceHistory.length>config.atrLookbackPeriod+1) strat.priceHistory.shift();
    if(typeof selectedStrategy.updateStrategyState==='function') selectedStrategy.updateStrategyState(symbol,strat,config);
    const dir=prev==null?'neutral':(price>prev?'up':price<prev?'down':'neutral'); strat.trendHistory.push(dir); if(strat.trendHistory.length>3) strat.trendHistory.shift();
    strat.lastPrice=price; return{price,prev};
  }catch(err){console.error(`❌ Price fetch failed for ${symbol}:`,err.message);return null;}
}

/** Execute buy or sell */
function executeTrade(symbol, action, price, overrideSize) {
  // ... existing buy/sell logic ...
}

/** Run strategy and trade for one symbol */
async function runStrategyForSymbol(symbol) {
  if(portfolio.dailyProfitTotal>=config.dailyProfitTarget){console.log('🎯 Target reached');return;}
  const info=await getPrice(symbol); if(!info) return;
  console.log(`→ ${symbol}: price=${info.price}, trend=[${strategies[symbol].trendHistory.join(',')}]`);
  const decision=strategies[symbol].module.getTradeDecision({price:info.price,lastPrice:strategies[symbol].lastPrice,costBasis:portfolio.cryptos[symbol].costBasis,strategyState:strategies[symbol],config});
  if(decision&&decision.action) executeTrade(symbol,decision.action,info.price);
}

/** Print current status (Ctrl+S) */
function printStatus(){
  const cryptoVal=Object.keys(portfolio.cryptos).reduce((s,sym)=>s+(strategies[sym].lastPrice||0)*portfolio.cryptos[sym].amount,0);
  const avg=portfolio.sellsToday>0?(portfolio.dailyProfitTotal/portfolio.sellsToday).toFixed(2):'N/A';
  console.log('\n=== STATUS ===');
  console.log(`Buys: ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells: ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Profit: $${portfolio.dailyProfitTotal.toFixed(2)} (avg $${avg})`);
  console.log(`Cash: $${portfolio.cashReserve.toFixed(2)}, CryptoVal: $${cryptoVal.toFixed(2)}, Locked: $${portfolio.lockedCash.toFixed(2)}`);
}

/** Print portfolio grid (Ctrl+G) */
function printGrid(){
  console.log('\n=== GRID ENTRIES ===');
  Object.keys(portfolio.cryptos).forEach(sym=>{
    const grid = portfolio.cryptos[sym].grid;
    console.log(`\n${sym} grid:`);
    if(!grid.length) console.log('  (empty)');
    grid.forEach((lot,i)=>{
      console.log(`  [${i+1}] price=${lot.price.toFixed(config.priceDecimalPlaces)}, amount=${lot.amount.toFixed(6)}, time=${new Date(lot.time).toLocaleString()}`);
    });
  });
  console.log('=== END GRID ===\n');
}

/** Print detailed final summary (Ctrl+C) */
async function printFinalSummary(){
  let finalCrypto=0;
  for(const sym of Object.keys(portfolio.cryptos)){
    const info=await getPrice(sym);
    if(info) finalCrypto+=info.price*portfolio.cryptos[sym].amount;
  }
  const endValue=portfolio.cashReserve+portfolio.lockedCash+finalCrypto;
  const profit=endValue-portfolio.beginningPortfolioValue;
  const dur=Math.floor((Date.now()-portfolio.startTime)/60000);
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Duration: ${dur} min`);
  console.log(`Buys: ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells: ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Profit: $${profit.toFixed(2)}`);
  console.log(`Cash: $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`Crypto: $${finalCrypto.toFixed(2)}`);
  console.log(`Locked: $${portfolio.lockedCash.toFixed(2)}`);
  console.log(`Total: $${endValue.toFixed(2)}`);
  console.log('====================\n');
}

// ==============================================
// Main Execution
// ==============================================
(async()=>{
  await promptStrategySelection();
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym=>strategies[sym]=initializeStrategy(sym));
  if(config.demoMode) await refreshDemoCostBasis();
  await Promise.all(Object.keys(portfolio.cryptos).map(sym=>getPrice(sym)));
  printHoldingsTable();
  if(config.demoMode) portfolio.buysToday=portfolio.sellsToday=portfolio.stopLossesToday=portfolio.dailyProfitTotal=0;
  let initCrypto=0;
  for(const sym of Object.keys(portfolio.cryptos)){
    const info=await getPrice(sym);
    if(info) initCrypto+=info.price*portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue=initCrypto;
  portfolio.beginningPortfolioValue=config.initialBalance+initCrypto;
  console.log('\n=== STARTUP SUMMARY ===');
  console.log(`Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`);
  readline.emitKeypressEvents(process.stdin);
  if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stdin.resume();}
  process.stdin.on('keypress',(_,key)=>{
    if(key.ctrl&&key.name==='s') printStatus();
    if(key.ctrl&&key.name==='g') printGrid();
    if(key.ctrl&&key.name==='c'){process.stdin.setRawMode(false);process.emit('SIGINT');}
  });
  Object.keys(portfolio.cryptos).forEach(sym=>runStrategyForSymbol(sym));
  const interval=setInterval(async()=>{
    if(Date.now()-portfolio.lastReset.getTime()>=ONE_DAY_MS){
      portfolio.buysToday=portfolio.sellsToday=portfolio.stopLossesToday=portfolio.dailyProfitTotal=0;
      portfolio.lastReset=new Date();console.log('🔄 24h reset.');
    }
    for(const sym of Object.keys(portfolio.cryptos)) await runStrategyForSymbol(sym);
  },config.checkInterval);
  process.on('SIGINT',async()=>{clearInterval(interval);await printFinalSummary();process.exit(0);} );
})();
