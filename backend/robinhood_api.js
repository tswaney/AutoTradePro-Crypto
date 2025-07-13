// backend/testPrice.js

// ==============================================
// Grid Bot with Strategy Selection, Manual Holdings,
// Simulated Trading, and Status Shortcut (Ctrl+S) + Grid View (Ctrl+G)
// ==============================================

// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
const { execSync } = require('child_process');
if (process.stdin.isTTY) {
  try {
    // disable flow control so we can intercept Ctrl+S / Ctrl+G
    execSync('stty -ixon', { stdio: 'inherit' });
  } catch (_) {
    // ignore on non-Unix
  }
}

// Load environment variables from .env
require('dotenv').config();

// Core modules
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// Robinhood session (no signing needed for /accounts/)
const { getAccessToken } = require('./sessionManager');

// ==============================================
// Thresholds from .env (whole-number percentages)
// ==============================================
const SIMPLE_BUY_THRESHOLD  = parseFloat(process.env.SIMPLE_BUY_THRESHOLD)  || 2.0; // e.g. "2.0" → 2%
const SIMPLE_SELL_THRESHOLD = parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;

// ==============================================
// Configurable parameters
// ==============================================
const config = {
  aiEnabled:          process.env.AI_ENABLED   === 'true',
  demoMode:           process.env.DEMO_MODE    === 'true',
  initialBalance:     parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount:     0.01,
  baseBuyThreshold:   -(SIMPLE_BUY_THRESHOLD / 100),
  baseSellThreshold:   SIMPLE_SELL_THRESHOLD / 100,
  atrLookbackPeriod:  14,
  gridLevels:         5,
  defaultSlippage:    0.02,
  priceDecimalPlaces: 8,
  buyLimit:           Infinity,
  sellLimit:          Infinity,
  stopLossLimit:      null,
  stopLossPercent:   -0.3,
  dailyProfitTarget:  null,
  checkInterval:     30 * 1000,
  strategy:          '',
};

// API base URLs
const MARKETDATA_API = 'https://api.robinhood.com';

console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
console.log("Press CTRL+S for Status, CTRL+G for Grid view, CTRL+C to exit\n");

// ==============================================
// FETCH CURRENT BUYING POWER (no signature, public accounts endpoint)
// ==============================================
async function getBuyingPower() {
  const token = await getAccessToken();
  try {
    const resp = await axios.get(`${MARKETDATA_API}/accounts/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent':  'Mozilla/5.0',
        Accept:        'application/json',
        Origin:        'https://robinhood.com',
      }
    });
    // find the crypto account result
    const acct = resp.data.results.find(a => a.account_type === 'crypto');
    // fallback if not found
    const bp   = acct?.crypto_buying_power ?? resp.data.results[0]?.crypto_buying_power;
    return parseFloat(bp) || 0;
  } catch (err) {
    console.error('❌ Buying-power fetch failed:', err.message);
    return 0;
  }
}

// ==============================================
// Portfolio & In‐Memory State
// ==============================================
let portfolio = {
  cashReserve:            config.initialBalance,
  lockedCash:             0,
  cryptos:                {},    // symbol → { amount, costBasis, grid }
  buysToday:              0,
  sellsToday:             0,
  stopLossesToday:        0,
  dailyProfitTotal:       0,
  startTime:              new Date(),
  beginningPortfolioValue:0,
};

let strategies       = {};  // symbol → strategy state
let selectedStrategy = null;
let firstCycleDone   = false;

// ==============================================
// Initialize per‐symbol strategy state
// ==============================================
function initializeStrategy(symbol) {
  return {
    buyThreshold:        config.baseBuyThreshold,
    sellThreshold:       config.baseSellThreshold,
    atr:                 0,
    dynamicBuyThreshold: null,
    dynamicSellThreshold:null,
    trend:               'neutral',
    slippage:            config.defaultSlippage,
    priceHistory:        [],
    trendHistory:        [],
    lastPrice:           null,
    module:              null,
    recent24h:           [],
    grid:                [],
  };
}

// ==============================================
// Prompt user to pick a strategy
// ==============================================
async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, 'strategies'))
                   .filter(f => f.endsWith('.js')).sort();
  const modules = files
    .map(f => require(`./strategies/${f}`))
    .filter(m => m.name && m.version && m.description);

  console.log('\n📌 Available Strategies:');
  modules.forEach((s, i) => {
    console.log(` [${i+1}] ${s.name} (${s.version}) - ${s.description}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\nSelect strategy [default 4]: ', input => {
      rl.close();
      const idx = parseInt(input.trim(), 10);
      const strat = modules[(idx>0 && idx<=modules.length) ? idx-1 : 3];
      config.strategy  = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      process.stdin.resume();
      resolve();
    });
  });
}

// ==============================================
// Load holdings from disk & seed grids
// ==============================================
function loadHoldings() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cryptoHoldings.json'), 'utf8'));
  for (const sym in data) {
    const { amount, costBasis } = data[sym];
    if (amount > config.minTradeAmount) {
      portfolio.cryptos[sym] = {
        amount,
        costBasis,
        grid: [{ price: costBasis, amount, time: Date.now() }]
      };
    }
  }
}
function seedStrategyGrids() {
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym].grid = [...portfolio.cryptos[sym].grid];
  });
}

// ==============================================
// (Demo) Refresh costBasis to live price
// ==============================================
async function refreshDemoCostBasis() {
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) portfolio.cryptos[sym].costBasis = info.price;
  }
  fs.writeFileSync(
    path.join(__dirname, 'cryptoHoldings.json'),
    JSON.stringify(portfolio.cryptos, null, 2)
  );
}

// ==============================================
// Print holdings table
// ==============================================
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(([sym, {amount,costBasis}],i)=>({
    No:        String(i+1),
    Symbol:    sym,
    Quantity:  amount.toFixed(6),
    Price:     (strategies[sym].lastPrice||0).toFixed(config.priceDecimalPlaces),
    CostBasis: costBasis.toFixed(6)
  }));
  const cols = ['No','Symbol','Quantity','Price','CostBasis'];
  const widths = {};
  cols.forEach(c=> widths[c] = Math.max(c.length, ...rows.map(r=>r[c].length)));
  const sep = (l,m,r)=>{
    let line=l;
    cols.forEach((c,i)=> line+= '─'.repeat(widths[c]+2)+(i<cols.length-1?m:r));
    return line;
  };

  console.log('\nCurrent Holdings:');
  console.log(sep('┌','┬','┐'));
  let hdr = '│';
  cols.forEach(c=>{
    const pad=widths[c]-c.length, L=Math.floor(pad/2), R=pad-L;
    hdr+= ` ${' '.repeat(L)}${c}${' '.repeat(R)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  rows.forEach(r=>{
    let line='│';
    cols.forEach(c=>{
      const v=r[c], pad=widths[c]-v.length;
      line+= ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

// ==============================================
// Print status (Ctrl+S) — fetches live buying power
// ==============================================
async function printStatus() {
  portfolio.cashReserve = await getBuyingPower();
  const cryptoVal = Object.keys(portfolio.cryptos)
    .reduce((sum,sym)=> sum + (strategies[sym].lastPrice||0)*portfolio.cryptos[sym].amount, 0);
  const profit = portfolio.dailyProfitTotal;
  const avg    = portfolio.sellsToday>0 ? profit/portfolio.sellsToday : 0;
  const fmt = v=> v.toLocaleString('en-US',{style:'currency',currency:'USD'});

  console.log('\n=== REALIZED P/L STATUS ===');
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Realized Profit:   ${fmt(profit)} (avg ${fmt(avg)})`);
  console.log(`Cash: ${fmt(portfolio.cashReserve)}`);
  console.log(`CryptoVal: ${fmt(cryptoVal)}, Locked: ${fmt(portfolio.lockedCash)}`);
}

// ==============================================
// Print unified grid (Ctrl+G)
// ==============================================
function printGrid() {
  const rows = [];
  Object.keys(portfolio.cryptos).forEach(sym=>{
    strategies[sym].grid.forEach((lot,i)=>{
      rows.push({
        Symbol: sym,
        Level:  String(i+1),
        Price:  lot.price.toFixed(config.priceDecimalPlaces),
        Amount: lot.amount.toFixed(6),
        Time:   new Date(lot.time).toLocaleString()
      });
    });
  });
  const cols=['Symbol','Level','Price','Amount','Time'];
  const widths={};
  cols.forEach(c=> widths[c]=Math.max(c.length, ...rows.map(r=>r[c].length)));
  const sep=(l,m,r)=>{
    let line=l;
    cols.forEach((c,i)=> line+= '─'.repeat(widths[c]+2)+(i<cols.length-1?m:r));
    return line;
  };

  console.log('\nCurrent Grid:');
  console.log(sep('┌','┬','┐'));
  let hdr='│';
  cols.forEach(c=>{
    const pad=widths[c]-c.length, L=Math.floor(pad/2), R=pad-L;
    hdr+= ` ${' '.repeat(L)}${c}${' '.repeat(R)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  rows.forEach(r=>{
    let line='│';
    cols.forEach(c=>{
      const v=r[c], pad=widths[c]-v.length;
      line+= ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

// ==============================================
// Fetch price + update strategy state
// ==============================================
async function getPrice(symbol) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(`${MARKETDATA_API}/marketdata/forex/quotes/${symbol}/`, {
      headers: {
        Authorization:`Bearer ${token}`,
        'User-Agent':'Mozilla/5.0',
        Accept:'application/json',
        Origin:'https://robinhood.com'
      },
      timeout:10000
    });
    const price = parseFloat(res.data.mark_price);
    const strat = strategies[symbol];
    const prev  = strat.lastPrice;

    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod+1)
      strat.priceHistory.shift();

    if (typeof selectedStrategy.updateStrategyState === 'function') {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    const dir = prev==null
      ? 'neutral'
      : price>prev ? 'up'
      : price<prev ? 'down'
      : 'neutral';
    strat.trendHistory.push(dir);
    if (strat.trendHistory.length>3) strat.trendHistory.shift();

    strat.lastPrice = price;
    return { price, prev };
  } catch(err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

// ==============================================
// Execute BUY or SELL
// ==============================================
function executeTrade(symbol, action, price) {
  const strat   = strategies[symbol];
  const holding = portfolio.cryptos[symbol];

  if (action==='BUY') {
    if (strat.grid.length>=config.gridLevels) {
      console.log(`⚠️ [${symbol}] BUY skipped: grid full (${config.gridLevels})\n`);
      return;
    }
    const lotSize   = holding.grid[0].amount;
    const cost      = price*lotSize*(1+strat.slippage);
    const maxSpend  = portfolio.cashReserve*0.25;
    const spend     = Math.min(cost, maxSpend);
    const actualQty = spend/(price*(1+strat.slippage));

    portfolio.cashReserve -= spend;
    portfolio.lockedCash  += price*actualQty;
    holding.amount       += actualQty;
    strat.grid.push({price,amount:actualQty,time:Date.now()});
    portfolio.buysToday++;
    console.log(`🟢 [${symbol}] BUY ${actualQty.toFixed(6)} @ $${price.toFixed(6)}\n`);

  } else if (action==='SELL') {
    const lot = strat.grid.shift();
    if (!lot) return;
    const qty      = lot.amount;
    const proceeds = price*qty*(1-strat.slippage);

    portfolio.cashReserve += proceeds;
    portfolio.lockedCash  -= lot.price*qty;
    holding.amount        -= qty;
    holding.costBasis     = strat.grid.length
      ? strat.grid[strat.grid.length-1].price
      : holding.costBasis;

    const pnl = proceeds - (lot.price*qty);
    portfolio.dailyProfitTotal += pnl;
    portfolio.sellsToday++;
    console.log(`🔴 [${symbol}] SELL ${qty} @ $${price.toFixed(6)}  P/L $${pnl.toFixed(6)}\n`);
  }
}

// ==============================================
// Two-line strategy + symbol output
// ==============================================
async function runStrategyForSymbol(symbol) {
  const info = await getPrice(symbol);
  if (!info) return;

  const cb    = portfolio.cryptos[symbol].costBasis;
  const delta = (info.price - cb)/cb;

  console.log();
  console.log(
    `[${symbol}] trend=[${strategies[symbol].trendHistory.join(',')}] `+
    `Δ ${(delta*100).toFixed(4)}%, grid size: ${strategies[symbol].grid.length}`
  );
  console.log();
  console.log(
    `→ ${symbol}: price=${info.price.toFixed(config.priceDecimalPlaces)}, `+
    `trend=[${strategies[symbol].trendHistory.join(',')}]`
  );
  console.log();

  if (!firstCycleDone) return;

  const decision = selectedStrategy.getTradeDecision({
    price:         info.price,
    lastPrice:     info.prev,
    costBasis:     cb,
    strategyState: strategies[symbol],
    config
  });
  if (!decision) return;

  const action = (decision.action||decision.side||'').toUpperCase();
  if (action==='BUY') {
    executeTrade(symbol,'BUY',info.price);
  } else if (action==='SELL') {
    if (delta>=config.baseSellThreshold) {
      executeTrade(symbol,'SELL',info.price);
    } else {
      console.log(`⚠️ [${symbol}] SELL skipped: Δ ${(delta*100).toFixed(4)}% < ${(config.baseSellThreshold*100).toFixed(2)}%\n`);
    }
  }
}

// ==============================================
// Main Execution
// ==============================================
(async()=>{
  await promptStrategySelection();

  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym=>{
    strategies[sym]=initializeStrategy(sym);
    strategies[sym].module=selectedStrategy;
  });
  seedStrategyGrids();

  // now seed cashReserve from real buying power
  portfolio.cashReserve = await getBuyingPower();

  if (config.demoMode) await refreshDemoCostBasis();

  await Promise.all(Object.keys(portfolio.cryptos).map(getPrice));
  printHoldingsTable();

  // compute beginning portfolio value
  portfolio.beginningPortfolioValue =
    portfolio.cashReserve +
    Object.keys(portfolio.cryptos)
      .reduce((sum,sym)=> sum + (strategies[sym].lastPrice||0)*portfolio.cryptos[sym].amount, 0);

  console.log(`\n=== STARTUP SUMMARY ===`);
  console.log(`Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`);

  // wire Ctrl keys
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress',(str,key)=>{
    if (key.ctrl&&key.name==='s') printStatus();
    if (key.ctrl&&key.name==='g') printGrid();
    if (key.ctrl&&key.name==='c'){ process.stdin.setRawMode(false); process.emit('SIGINT'); }
  });

  console.log('\n🔄 Seeding initial cycle (no trades)...');
  await Promise.all(Object.keys(portfolio.cryptos).map(runStrategyForSymbol));
  firstCycleDone = true;
  console.log('✅ Initial cycle complete — trading now enabled');

  const interval = setInterval(async()=>{
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  process.on('SIGINT', async()=>{
    clearInterval(interval);
    // final prices
    let finalCrypto = 0;
    for (const sym of Object.keys(portfolio.cryptos)) {
      const info = await getPrice(sym);
      if (info) finalCrypto += info.price * portfolio.cryptos[sym].amount;
    }
    const endValue = portfolio.cashReserve + portfolio.lockedCash + finalCrypto;
    const profit   = endValue - portfolio.beginningPortfolioValue;
    const minutes  = Math.floor((Date.now()-portfolio.startTime)/60000);
    const fmt      = v=> v.toLocaleString('en-US',{style:'currency',currency:'USD'});

    console.log('\n=== TOTAL PORTFOLIO SUMMARY ===');
    console.log(`Beginning Portfolio Value: ${fmt(portfolio.beginningPortfolioValue)}`);
    console.log(`Duration: ${minutes} min`);
    console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
    console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
    console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
    console.log(`Total P/L:   ${fmt(profit)}`);
    console.log(`Cash:        ${fmt(portfolio.cashReserve)}`);
    console.log(`Crypto (mkt):${fmt(finalCrypto)}`);
    console.log(`Locked:      ${fmt(portfolio.lockedCash)}`);
    console.log('=============================');
    process.exit(0);
  });
})();
