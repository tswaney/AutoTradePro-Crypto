// backend/testPrice.js

// ==============================================
// Grid Bot with Strategy Selection, Manual Holdings,
// Simulated Trading, and Status Shortcut (Ctrl+S) + Grid View (Ctrl+G)
// ==============================================

// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
// (disables flow control so we can intercept those key presses)
const { execSync } = require('child_process');
if (process.stdin.isTTY) {
  try {
    execSync('stty -ixon', { stdio: 'inherit' });
  } catch (_) {
    // ignore if it fails
  }
}

// Load environment variables from .env
require('dotenv').config();

// Core modules
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { getAccessToken } = require('./sessionManager');

// ==============================================
// Configuration (tunable parameters by strategy)
// ==============================================
const config = {
  aiEnabled:          process.env.AI_ENABLED   === 'true',
  demoMode:           process.env.DEMO_MODE     === 'true',
  initialBalance:     parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount:     0.01,
  baseBuyThreshold:   -0.000005,   // –0.0005%
  baseSellThreshold:   0.00005,    // +0.005%
  atrLookbackPeriod:  14,
  gridLevels:         5,
  defaultSlippage:    0.02,
  priceDecimalPlaces: 8,
  buyLimit:           22,
  sellLimit:          23,
  stopLossLimit:      5,
  stopLossPercent:   -0.3,
  dailyProfitTarget: 100,
  checkInterval:     30 * 1000,    // 30 seconds
  strategy:          '',           // filled in later
};

console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
console.log("Press CTRL+S for Status, CTRL+G for Grid view, CTRL+C to exit\n");

// ==============================================
// API & Portfolio State
// ==============================================
const BASE_URL = 'https://api.robinhood.com/marketdata/forex/quotes/';
let portfolio = {
  cashReserve:          config.initialBalance,
  lockedCash:           0,
  cryptos:              {},   // populated by loadHoldings()
  buysToday:            0,
  sellsToday:           0,
  stopLossesToday:      0,
  dailyProfitTotal:     0,
  startTime:            new Date(),
  lastReset:            new Date(),
  initialCryptoValue:   0,
  beginningPortfolioValue: 0,
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// per-symbol strategy state & selection
let strategies       = {};
let selectedStrategy = null;

// ——— NEW ——— flag to block trades until after first full pass
let firstCycleDone   = false;

// ==============================================
// Initialize per-symbol strategy state
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
    priceHistory:        [],   // for ATR or other lookback
    trendHistory:        [],   // last 3 up/down/neutral
    lastPrice:           null,
    module:              null, // will fill in after strategy selection
    recent24h:           [],   // placeholder
    grid:                [],   // seeded from holdings
  };
}

// ==============================================
// Prompt user to pick a strategy
// ==============================================
async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, 'strategies'))
                  .filter(f => f.endsWith('.js'))
                  .sort();
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
      const idx = parseInt(input.trim(), 10);
      const strat = modules[(idx>0 && idx<=modules.length) ? idx-1 : 3];
      rl.close();
      config.strategy  = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

// ==============================================
// Load holdings from disk and seed each grid
// ==============================================
function loadHoldings() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'cryptoHoldings.json'), 'utf8')
  );
  for (const sym in data) {
    const { amount, costBasis } = data[sym];
    if (amount > config.minTradeAmount) {
      // seed first grid entry at costBasis
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
// (Demo-only) Refresh costBasis to first live price
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
// Console-table & Status/Grid printers
// ==============================================
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(([sym,{amount,costBasis}],i)=>( {
    No:        String(i+1),
    Symbol:    sym,
    Quantity:  amount.toFixed(6),
    Price:     (strategies[sym].lastPrice||0).toFixed(config.priceDecimalPlaces),
    CostBasis: costBasis.toFixed(6)
  } ));
  const cols = ['No','Symbol','Quantity','Price','CostBasis'];
  const widths = {};
  cols.forEach(c => {
    widths[c] = Math.max(c.length, ...rows.map(r=>r[c].length));
  });
  const sep = (l,m,r) => {
    let line = l;
    cols.forEach((c,i)=>{
      line += '─'.repeat(widths[c]+2) + (i<cols.length-1 ? m : r);
    });
    return line;
  };

  console.log('\nCurrent Holdings:');
  console.log(sep('┌','┬','┐'));
  // Header
  let hdr = '│';
  cols.forEach(c=>{
    const pad = widths[c]-c.length;
    const left = Math.floor(pad/2), right = pad-left;
    hdr += ` ${' '.repeat(left)}${c}${' '.repeat(right)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  // Rows
  rows.forEach(r=>{
    let line = '│';
    cols.forEach(c=>{
      const v=r[c], pad=widths[c]-v.length;
      line += ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

function printStatus() {
  const cryptoVal = Object.keys(portfolio.cryptos)
    .reduce((sum,sym)=> sum + (strategies[sym].lastPrice||0)*portfolio.cryptos[sym].amount,0);
  const avg = portfolio.sellsToday>0
    ? (portfolio.dailyProfitTotal/portfolio.sellsToday).toFixed(2)
    : 'N/A';

  console.log('\n=== STATUS ===');
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Profit:   $${portfolio.dailyProfitTotal.toFixed(2)} (avg $${avg})`);
  console.log(`Cash: $${portfolio.cashReserve.toFixed(2)}, CryptoVal: $${cryptoVal.toFixed(2)}, Locked: $${portfolio.lockedCash.toFixed(2)}`);
}

function printGrid() {
  console.log('\n=== GRID ENTRIES ===');
  Object.keys(portfolio.cryptos).forEach(sym=>{
    const grid = strategies[sym].grid;
    console.log(`\n${sym} grid:`);
    if (!grid.length) {
      console.log('  (empty)');
    } else {
      grid.forEach((lot,i)=>{
        console.log(`  [${i+1}] price=${lot.price.toFixed(config.priceDecimalPlaces)}, amount=${lot.amount.toFixed(6)}, time=${new Date(lot.time).toLocaleString()}`);
      });
    }
  });
  console.log('=== END GRID ===\n');
}

// ==============================================
// Market Data Fetch + Strategy Logic
// ==============================================
async function getPrice(symbol) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent':  'Mozilla/5.0',
        Accept:        'application/json',
        Origin:        'https://robinhood.com'
      },
      timeout: 10000
    });
    const price = parseFloat(res.data.mark_price);
    const strat  = strategies[symbol];
    const prev   = strat.lastPrice;

    // Rolling price history
    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1) {
      strat.priceHistory.shift();
    }

    // Let strategy compute ATR or other state
    if (typeof selectedStrategy.updateStrategyState === 'function') {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    // Simple up/down/neutral trend
    const dir = prev == null
      ? 'neutral'
      : price>prev
        ? 'up'
        : price<prev
          ? 'down'
          : 'neutral';
    strat.trendHistory.push(dir);
    if (strat.trendHistory.length>3) strat.trendHistory.shift();

    strat.lastPrice = price;
    return { price, prev };
  } catch (err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

// ==============================================
// Actual Buy/Sell execution logic — updates
// counters, cash, grid, costBasis, P/L, etc.
// ==============================================
function executeTrade(symbol, action, price) {
  const strat   = strategies[symbol];
  const holding = portfolio.cryptos[symbol];

  // SELL guard: if no lots left to sell, abort
  if (action === 'SELL' && strat.grid.length === 0) {
    console.log(`⚠️  No grid lots left to SELL ${symbol}`);
    return;
  }

  // how much we trade per‐lot (seeded from your initial costBasis entry)
  // use the original holding.grid so we always know the lot size
  const lotSize = portfolio.cryptos[symbol].grid[0].amount;

  if (action === 'BUY') {
    if (portfolio.buysToday >= config.buyLimit) {
      console.log(`⚠️  Buy limit reached for today (${config.buyLimit})`);
      return;
    }
    const cost = price * lotSize;
    portfolio.cashReserve -= cost * (1 + strat.slippage);
    portfolio.lockedCash  += cost * (1 + strat.slippage);
    holding.amount        += lotSize;

    // record this lot in the in-memory grid
    strat.grid.push({ price, amount: lotSize, time: Date.now() });

    portfolio.buysToday++;
    console.log(`🟢 [${selectedStrategy.name}] BUY ${lotSize} ${symbol} @ $${price.toFixed(6)}`);

  } else if (action === 'SELL') {
    if (portfolio.sellsToday >= config.sellLimit) {
      console.log(`⚠️  Sell limit reached for today (${config.sellLimit})`);
      return;
    }
    // remove oldest lot
    const lot = strat.grid.shift();
    const qty = lot.amount;
    const proceeds = price * qty;

    portfolio.cashReserve += proceeds * (1 - strat.slippage);
    portfolio.lockedCash  -= lot.price * qty;
    holding.amount        -= qty;

    // new costBasis = price of last remaining lot, if any
    holding.costBasis = strat.grid.length
                      ? strat.grid[strat.grid.length - 1].price
                      : holding.costBasis;

    // record profit
    const pnl = proceeds - (lot.price * qty);
    portfolio.dailyProfitTotal += pnl;
    portfolio.sellsToday++;

    console.log(`🔴 [${selectedStrategy.name}] SELL ${qty} ${symbol} @ $${price.toFixed(6)}  P/L $${pnl.toFixed(6)}`);
  }
}

// ==============================================
// Run one symbol’s strategy, maybe trade
// ==============================================
async function runStrategyForSymbol(symbol) {
  if (portfolio.dailyProfitTotal >= config.dailyProfitTarget) {
    console.log('🎯 Daily profit target reached');
    return;
  }

  const info = await getPrice(symbol);
  if (!info) return;

  console.log(
    `→ ${symbol}: price=${info.price.toFixed(config.priceDecimalPlaces)}, `+
    `trend=[${strategies[symbol].trendHistory.join(',')}]`
  );

  // skip trading until after first full pass
  if (!firstCycleDone) return;

  // get the decision
  const decision = selectedStrategy.getTradeDecision({
    price:         info.price,
    lastPrice:     info.prev,
    costBasis:     portfolio.cryptos[symbol].costBasis,
    strategyState: strategies[symbol],
    config
  });

  if (decision) {
    let action = (decision.action || decision.side || '').toString().toUpperCase();
    if (action === 'BUY' || action === 'SELL') {
      executeTrade(symbol, action, info.price);
    }
  }
}

// ==============================================
// Final Summary on CTRL+C
// ==============================================
async function printFinalSummary() {
  let finalCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) finalCrypto += info.price * portfolio.cryptos[sym].amount;
  }
  const endValue = portfolio.cashReserve + portfolio.lockedCash + finalCrypto;
  const profit   = endValue - portfolio.beginningPortfolioValue;
  const minutes  = Math.floor((Date.now() - portfolio.startTime) / 60000);

  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Duration: ${minutes} min`);
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Profit:   $${profit.toFixed(2)}`);
  console.log(`Cash:     $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`Crypto:   $${finalCrypto.toFixed(2)}`);
  console.log(`Locked:   $${portfolio.lockedCash.toFixed(2)}`);
  console.log(`Total:    $${endValue.toFixed(2)}`);
  console.log('====================\n');
}

// ==============================================
// Main Execution Entry Point
// ==============================================
(async () => {
  // 1) pick strategy
  await promptStrategySelection();

  // 2) load & init
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym]       = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  });
  seedStrategyGrids();

  // 3) demo cost-basis refresh
  if (config.demoMode) await refreshDemoCostBasis();

  // 4) initial price fetch & table (no trades)
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => getPrice(sym)));
  printHoldingsTable();

  // 5) reset daily counters in demo
  if (config.demoMode) {
    portfolio.buysToday = portfolio.sellsToday = portfolio.stopLossesToday = portfolio.dailyProfitTotal = 0;
  }

  // 6) compute starting portfolio value
  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) initCrypto += info.price * portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue      = initCrypto;
  portfolio.beginningPortfolioValue = config.initialBalance + initCrypto;
  console.log('\n=== STARTUP SUMMARY ===');
  console.log(`Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`);

  // 7) keypress handlers
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name==='s') printStatus();
    if (key.ctrl && key.name==='g') printGrid();
    if (key.ctrl && key.name==='c') {
      process.stdin.setRawMode(false);
      process.emit('SIGINT');
    }
  });

  // 8) one initial pass (no trades)
  console.log('🔄 Seeding initial cycle (no trades)...');
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => runStrategyForSymbol(sym)));
  firstCycleDone = true;
  console.log('✅ Initial cycle complete — trading now enabled.');

  // 9) recurring trading loop
  const interval = setInterval(async () => {
    // daily reset
    if (Date.now() - portfolio.lastReset.getTime() >= ONE_DAY_MS) {
      portfolio.buysToday = portfolio.sellsToday = portfolio.stopLossesToday = portfolio.dailyProfitTotal = 0;
      portfolio.lastReset = new Date();
      console.log('🔄 24h reset.');
    }
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  // 10) cleanup on SIGINT
  process.on('SIGINT', async () => {
    clearInterval(interval);
    await printFinalSummary();
    process.exit(0);
  });
})();
