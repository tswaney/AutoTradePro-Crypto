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
  demoMode:           process.env.DEMO_MODE    === 'true',
  initialBalance:     parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount:     0.01,
  baseBuyThreshold:   -0.03,   // –3% expressed as decimal fractions of the cost-basis
  baseSellThreshold:   0.02,   // +2% expressed as decimal fractions of the cost-basis
  atrLookbackPeriod:  14,
  gridLevels:         5,
  defaultSlippage:    0.02,
  priceDecimalPlaces: 8,
  buyLimit:           Infinity,  // removed daily cap
  sellLimit:          Infinity,
  stopLossLimit:      null,      // disabled stopLossLimit
  stopLossPercent:   -0.3,
  dailyProfitTarget: null,       // disabled daily profit cap
  checkInterval:     30 * 1000,  // 30 seconds
  strategy:          '',         // filled in later
};

console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
console.log("Press CTRL+S for Status, CTRL+G for Grid view, CTRL+C to exit\n");

// ==============================================
// API & Portfolio State
// ==============================================
const BASE_URL = 'https://api.robinhood.com/marketdata/forex/quotes/';
let portfolio = {
  cashReserve:            config.initialBalance,
  lockedCash:             0,
  cryptos:                {},   // populated by loadHoldings()
  buysToday:              0,
  sellsToday:             0,
  stopLossesToday:        0,
  dailyProfitTotal:       0,
  startTime:              new Date(),
  lastReset:              new Date(),
  initialCryptoValue:     0,
  beginningPortfolioValue:0,
};
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// per-symbol strategy state & selection
let strategies       = {};
let selectedStrategy = null;

// flag to block trades until after first full pass
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
      portfolio.cryptos[sym] = { amount, costBasis, grid: [{ price: costBasis, amount, time: Date.now() }] };
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
  }));
  const cols = ['No','Symbol','Quantity','Price','CostBasis'];
  const widths = {};
  cols.forEach(c => { widths[c] = Math.max(c.length, ...rows.map(r=>r[c].length)); });
  const sep = (l,m,r) => {
    let line = l;
    cols.forEach((c,i)=>{ line += '─'.repeat(widths[c]+2) + (i<cols.length-1 ? m : r); });
    return line;
  };

  console.log('\nCurrent Holdings:');
  console.log(sep('┌','┬','┐'));
  let hdr = '│'; cols.forEach(c=>{
    const pad = widths[c]-c.length, left = Math.floor(pad/2), right = pad-left;
    hdr += ` ${' '.repeat(left)}${c}${' '.repeat(right)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  rows.forEach(r=>{
    let line = '│'; cols.forEach(c=>{ const v=r[c], pad=widths[c]-v.length; line += ` ${v}${' '.repeat(pad)} │`; });
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

  console.log('\n=== REALIZED P/L STATUS ===');
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Realized Profit:   $${portfolio.dailyProfitTotal.toFixed(2)} (avg $${avg})`);
  console.log(`Cash: $${portfolio.cashReserve.toFixed(2)}, CryptoVal: $${cryptoVal.toFixed(2)}, Locked: $${portfolio.lockedCash.toFixed(2)}`);
}

function printGrid() {
  console.log('\n=== GRID ENTRIES ===');
  Object.keys(portfolio.cryptos).forEach(sym=>{
    const grid = strategies[sym].grid;
    console.log(`\n${sym} grid:`);
    if (!grid.length) console.log('  (empty)');
    else grid.forEach((lot,i)=>
      console.log(`  [${i+1}] price=${lot.price.toFixed(config.priceDecimalPlaces)}, amount=${lot.amount.toFixed(6)}, time=${new Date(lot.time).toLocaleString()}`)
    );
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
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Origin: 'https://robinhood.com' },
      timeout: 10000
    });
    const price = parseFloat(res.data.mark_price);
    const strat  = strategies[symbol];
    const prev   = strat.lastPrice;

    // Rolling price history
    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1) strat.priceHistory.shift();

    // Strategy‐specific state update
    if (typeof selectedStrategy.updateStrategyState === 'function') {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    // Trend direction
    const dir = prev == null ? 'neutral' : (price>prev ? 'up' : (price<prev ? 'down' : 'neutral'));
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
// Actual Buy/Sell execution logic — updates cash, grid, P/L, etc.
// ==============================================
function executeTrade(symbol, action, price) {
  const strat   = strategies[symbol];
  const holding = portfolio.cryptos[symbol];

  if (action === 'BUY') {
    // limit spend to 25% of cash per trade
    const lotSize = holding.grid[0].amount;
    const maxSpend = portfolio.cashReserve * 0.25;
    const rawCost  = price * lotSize * (1 + strat.slippage);
    const spend    = Math.min(rawCost, maxSpend);
    const actualQty= spend / (price * (1 + strat.slippage));

    portfolio.cashReserve -= spend;
    portfolio.lockedCash  += price * actualQty;
    holding.amount        += actualQty;
    strat.grid.push({ price, amount: actualQty, time: Date.now() });
    portfolio.buysToday++;
    console.log(`🟢 [${selectedStrategy.name}] BUY ${actualQty.toFixed(6)} ${symbol} @ $${price.toFixed(6)}`);

  } else if (action === 'SELL') {
    // pop oldest lot
    const lot = strat.grid.shift();
    if (!lot) return;
    const qty      = lot.amount;
    const proceeds = price * qty * (1 - strat.slippage);

    portfolio.cashReserve += proceeds;
    portfolio.lockedCash  -= lot.price * qty;
    holding.amount        -= qty;
    holding.costBasis     = strat.grid.length
                          ? strat.grid[strat.grid.length-1].price
                          : holding.costBasis;

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
  const info = await getPrice(symbol);
  if (!info) return;

  console.log(`→ ${symbol}: price=${info.price.toFixed(config.priceDecimalPlaces)}, trend=[${strategies[symbol].trendHistory.join(',')}]`);
  if (!firstCycleDone) return;

  const decision = selectedStrategy.getTradeDecision({
    price:         info.price,
    lastPrice:     info.prev,
    costBasis:     portfolio.cryptos[symbol].costBasis,
    strategyState: strategies[symbol],
    config
  });
  if (!decision) return;

  let action = (decision.action || decision.side || '').toString().toUpperCase();

  if (action === 'BUY') {
    executeTrade(symbol, 'BUY', info.price);

  } else if (action === 'SELL') {
    // calculate net change after slippage
    const strat       = strategies[symbol];
    const costBasis   = portfolio.cryptos[symbol].costBasis;
    const netPrice    = info.price * (1 - strat.slippage);
    const netDelta    = (netPrice - costBasis) / costBasis;

    // only sell if meets threshold
    if (netDelta >= config.baseSellThreshold) {
      // ——— NEW: peak‐confirmation logic before SELL ———
      const hist = strategies[symbol].trendHistory.slice(-3);
      const isPeak =
        (hist[0]==='down' && hist[1]==='down' && hist[2]==='down') ||
        (hist[0]==='up'   && hist[1]==='down' && hist[2]==='down');

      if (isPeak) {
        executeTrade(symbol, 'SELL', info.price);
      } else {
        console.log(`⚠️ [${selectedStrategy.name}] SELL suppressed for ${symbol}: no peak confirmed (last 3 trends: [${hist.join(',')}])`);
      }
    } else {
      console.log(`⚠️ [${selectedStrategy.name}] SELL skipped for ${symbol}: net Δ ${(netDelta*100).toFixed(4)}% < threshold ${(config.baseSellThreshold*100).toFixed(2)}%`);
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
  const profit   = endValue - portfolio.beginingPortfolioValue;
  const minutes  = Math.floor((Date.now() - portfolio.startTime) / 60000);

  console.log('\n=== TOTAL PORTFOLIO SUMMARY ===');
  console.log(`Duration: ${minutes} min`);
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Total P/L:   $${profit.toFixed(2)}`);
  console.log(`Cash:        $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`Crypto (mkt):$${finalCrypto.toFixed(2)}`);
  console.log(`Locked:      $${portfolio.lockedCash.toFixed(2)}`);
  console.log(`Total Value: $${endValue.toFixed(2)}`);
  console.log('=============================\n');
}

// ==============================================
// Main Execution Entry Point
// ==============================================
(async () => {
  await promptStrategySelection();

  // load + init
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym]       = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  });
  seedStrategyGrids();

  // demo reset
  if (config.demoMode) await refreshDemoCostBasis();

  // initial fetch & table
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => getPrice(sym)));
  printHoldingsTable();

  // reset demo counters
  if (config.demoMode) {
    portfolio.buysToday = portfolio.sellsToday = portfolio.stopLossesToday = portfolio.dailyProfitTotal = 0;
  }

  // compute starting portfolio value
  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) initCrypto += info.price * portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue      = initCrypto;
  portfolio.beginningPortfolioValue = config.initialBalance + initCrypto;
  console.log(`\n=== STARTUP SUMMARY ===\nBeginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`);

  // key handlers
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

  // initial "seed" pass
  console.log('🔄 Seeding initial cycle (no trades)...');
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => runStrategyForSymbol(sym)));
  firstCycleDone = true;
  console.log('✅ Initial cycle complete — trading now enabled.');

  // recurring loop
  const interval = setInterval(async () => {
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  // on exit
  process.on('SIGINT', async () => {
    clearInterval(interval);
    await printFinalSummary();
    process.exit(0);
  });
})();
