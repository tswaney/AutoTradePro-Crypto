// backend/testPrice.js

'use strict';

// ==============================================
// Redirect all stdout & stderr to a log file
// ==============================================
const fsLogger   = require('fs');
const pathLogger = require('path');
const logFilePath = pathLogger.join(__dirname, 'testPrice_output.txt');
const logStream   = fsLogger.createWriteStream(logFilePath, { flags: 'w' });

const origStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStdout(chunk, encoding, callback);
};
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStderr(chunk, encoding, callback);
};

// ==============================================
// Grid Bot with Strategy Selection, Manual Holdings,
// Simulated Trading, and Status Shortcut (Ctrl+S) + Grid View (Ctrl+G)
// ==============================================

// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
const { execSync } = require('child_process');
if (process.stdin.isTTY) {
  try { execSync('stty -ixon', { stdio: 'inherit' }); } catch (_) {}
}

// Load environment variables from .env
require('dotenv').config();

// Core modules
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { getAccessToken, PUBLIC_API_KEY } = require('./sessionManager');
const { signRequest }                  = require('./signRequest');

// Constants
const TRADING_API = 'https://trading.robinhood.com';
const USER_AGENT  = 'Mozilla/5.0 PowerShell/7.2.0';

// ==============================================
// Read thresholds and feature flags from .env
// ==============================================
const SIMPLE_BUY_THRESHOLD     = parseFloat(process.env.SIMPLE_BUY_THRESHOLD)  || 2.0;
const SIMPLE_SELL_THRESHOLD    = parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;
const ENABLE_PEAK_CONFIRMATION = process.env.ENABLE_PEAK_CONFIRMATION === 'true';

// ==============================================
// TEST MODE CONFIGURATION
// ==============================================
const TEST_MODE               = process.env.TEST_MODE === 'true';
const MAX_TEST_BUYS           = parseInt(process.env.MAX_TEST_BUYS, 10) || 2;
const MAX_TEST_SELLS          = parseInt(process.env.MAX_TEST_SELLS, 10) || 2;
const LIMIT_TO_MAX_BUY_SELL   = process.env.LIMIT_TO_MAX_BUY_SELL === 'true';

// ==============================================
// Configuration (tunable parameters by strategy)
// ==============================================
const config = {
  aiEnabled:           process.env.AI_ENABLED      === 'true',
  demoMode:            process.env.DEMO_MODE       === 'true',
  testMode:            TEST_MODE,
  limitBuysSells:      LIMIT_TO_MAX_BUY_SELL,
  initialBalance:      parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount:      0.01,
  baseBuyThreshold:   -(SIMPLE_BUY_THRESHOLD  / 100),
  baseSellThreshold:   SIMPLE_SELL_THRESHOLD / 100,
  atrLookbackPeriod:   14,
  gridLevels:          5,
  defaultSlippage:     0.02,
  priceDecimalPlaces:  8,
  buyLimit:            Infinity,
  sellLimit:           Infinity,
  stopLossLimit:       null,
  stopLossPercent:    -0.3,
  dailyProfitTarget:   null,
  checkInterval:      30 * 1000,
  strategy:           '',
  enablePeakFilter:    ENABLE_PEAK_CONFIRMATION
};

console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
if (config.testMode) {
  console.log(`🧪 TEST_MODE: trades simulated${config.limitBuysSells ? ' (capped)' : ''}`);
}
console.log(`Peak-confirmation on BUY is ${config.enablePeakFilter ? 'ENABLED' : 'DISABLED'}`);
console.log("Press CTRL+S for Status, CTRL+G for Grid, CTRL+C to exit\n");

// ==============================================
// API & Portfolio State
// ==============================================
const BASE_URL = 'https://api.robinhood.com/marketdata/forex/quotes/';
let portfolio = {
  cashReserve:            config.initialBalance,
  lockedCash:             0,
  cryptos:                {},
  buysToday:              0,
  sellsToday:             0,
  stopLossesToday:        0,
  dailyProfitTotal:       0,
  startTime:              new Date(),
  lastReset:              new Date(),
  initialCryptoValue:     0,
  beginningPortfolioValue:0,
};
let strategies       = {};
let selectedStrategy = null;
let firstCycleDone   = false;

// ==============================================
// Fetch live crypto-only buying power
// ==============================================
async function fetchCryptoBuyingPower() {
  console.log('>>> Entered fetchCryptoBuyingPower()');
  const token     = await getAccessToken();
  console.log('>>> Token present:', Boolean(token));

  const path      = "/api/v1/crypto/billing/buying_power/";
  const url       = `${TRADING_API}${path}`;
  const timestamp = Math.floor(Date.now()/1000).toString();

  // Build payload exactly like liveTestBonk (no body)
  const payload   = `${timestamp}GET${path}`;
  console.log(">>> signing payload:", payload);

  const signature = signRequest(
    PUBLIC_API_KEY,
    timestamp,
    path,
    "GET",
    null
  );
  console.log(">>> generated signature:", signature);

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent":  USER_AGENT,
    Accept:        "application/json",
    Origin:        "https://robinhood.com",
    "x-api-key":   PUBLIC_API_KEY,
    "x-timestamp": timestamp,
    "x-signature": signature
  };
  console.log(">>> fetchBuyingPower headers:", headers);

  try {
    const resp = await axios.get(url, { headers, timeout: 10000 });
    console.log(">>> buying-power response:", resp.data);
    return parseFloat(resp.data.crypto_buying_power);
  } catch (err) {
    console.error("❌ Buying-power fetch failed:",
      err.response?.status,
      err.response?.data || err.message
    );
    return null;
  }
}

// ==============================================
// Helper: initialize per-symbol strategy state
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
    grid:                []
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
  modules.forEach((s, i) =>
    console.log(` [${i+1}] ${s.name} (${s.version}) - ${s.description}`)
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\nSelect strategy [default 4]: ', input => {
      const idx   = parseInt(input.trim(), 10);
      const strat = modules[(idx > 0 && idx <= modules.length) ? idx-1 : 3];
      rl.close();
      config.strategy   = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

// ==============================================
// Load holdings from disk and seed each grid
// ==============================================
function loadHoldings() {
  const data = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'cryptoHoldings.json'), 'utf8'
  ));
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
// Printers: Holdings Table, Status, Grid
// ==============================================
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(([sym,{amount,costBasis}],i)=>({
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
    let line = '│'; cols.forEach(c=>{
      const v=r[c], pad=widths[c]-v.length;
      line += ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

// ==============================================
// Print Status on CTRL+S
// ==============================================
function printStatus() {
  const cryptoVal = Object.keys(portfolio.cryptos)
    .reduce((sum,sym)=> sum + (strategies[sym].lastPrice||0)*portfolio.cryptos[sym].amount,0);

  const avg = portfolio.sellsToday > 0
    ? (portfolio.dailyProfitTotal/portfolio.sellsToday).toFixed(2)
    : 'N/A';

  const slLimit = config.stopLossLimit == null
    ? `${portfolio.stopLossesToday}`
    : `${portfolio.stopLossesToday}/${config.stopLossLimit}`;

  // Only show "/max" in LIVE mode when limitBuysSells is true
  const buysDisplay = config.testMode
    ? `${portfolio.buysToday}`
    : `${portfolio.buysToday}/${config.limitBuysSells ? MAX_TEST_BUYS : '∞'}`;

  const sellsDisplay = config.testMode
    ? `${portfolio.sellsToday}`
    : `${portfolio.sellsToday}/${config.limitBuysSells ? MAX_TEST_SELLS : '∞'}`;

  console.log('\n=== REALIZED P/L STATUS ===');
  console.log(`Buys:     ${buysDisplay}`);
  console.log(`Sells:    ${sellsDisplay}`);
  console.log(`StopLoss: ${slLimit}`);
  console.log(`Realized Profit:   $${portfolio.dailyProfitTotal.toLocaleString()} (avg $${avg})`);
  console.log(`Cash: $${portfolio.cashReserve.toLocaleString()}, Crypto: $${cryptoVal.toLocaleString()}, Locked: $${portfolio.lockedCash.toLocaleString()}`);
}

// ==============================================
// Print Grid on CTRL+G
// ==============================================
function printGrid() {
  console.log('\n=== GRID ENTRIES ===');
  Object.keys(portfolio.cryptos).forEach(sym=>{
    console.log(`\n${sym} grid:`);
    const grid = strategies[sym].grid;
    if (!grid.length) console.log('  (empty)');
    else grid.forEach((lot,i)=> console.log(
      `  [${i+1}] price=${lot.price.toFixed(config.priceDecimalPlaces)}, amount=${lot.amount}, time=${new Date(lot.time).toLocaleString()}`
    ));
  });
}

// ==============================================
// Fetch market data and update strategy state
// ==============================================
async function getPrice(symbol) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent':  USER_AGENT,
        Accept:        'application/json',
        Origin:        'https://robinhood.com'
      },
      timeout: 10000
    });
    const price = parseFloat(res.data.mark_price);
    const strat  = strategies[symbol];
    const prev   = strat.lastPrice;

    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1) strat.priceHistory.shift();

    if (typeof selectedStrategy.updateStrategyState === 'function') {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    const dir = prev == null
      ? 'neutral'
      : price>prev   ? 'up'
      : price<prev   ? 'down'
                     : 'neutral';
    strat.trendHistory.push(dir);
    if (strat.trendHistory.length > 3) strat.trendHistory.shift();

    strat.lastPrice = price;
    return { price, prev };
  } catch (err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

// ==============================================
// Actual Buy/Sell execution logic
// ==============================================
function executeTrade(symbol, action, price) {
  const strat   = strategies[symbol];
  const holding = portfolio.cryptos[symbol];
  const lotSize = holding.grid[0].amount;

  if (action === 'BUY') {
    const maxSpend   = portfolio.cashReserve * 0.25;
    const costPerLot = price * lotSize * (1 + strat.slippage);
    const spend      = Math.min(costPerLot, maxSpend);
    const actualQty  = spend / (price * (1 + strat.slippage));

    if (portfolio.cashReserve - spend < 0) return; // no overdraft

    portfolio.cashReserve -= spend;
    portfolio.lockedCash   += price * actualQty;
    holding.amount         += actualQty;
    strat.grid.push({ price, amount: actualQty, time: Date.now() });
    portfolio.buysToday++;
    console.log(`🟢 [${strat.module.name}] BUY ${actualQty.toFixed(6)} ${symbol} @ $${price.toFixed(6)}`);
  } else if (action === 'SELL') {
    const lot      = strat.grid.shift();
    if (!lot) return;
    const qty      = lot.amount;
    const proceeds = price * qty * (1 - strat.slippage);

    portfolio.cashReserve += proceeds;
    portfolio.lockedCash  -= lot.price * qty;
    holding.amount        -= qty;
    holding.costBasis     = strat.grid.length
                          ? strat.grid[strategies[symbol].grid.length-1].price
                          : holding.costBasis;

    const pnl = proceeds - (lot.price * qty);
    portfolio.dailyProfitTotal += pnl;
    portfolio.sellsToday++;
    console.log(`🔴 [${strat.module.name}] SELL ${qty.toFixed(6)} ${symbol} @ $${price.toFixed(6)}  P/L $${pnl.toFixed(6)}`);
  }
}

// ==============================================
// Run one symbol’s strategy, maybe trade
// ==============================================
async function runStrategyForSymbol(symbol) {
  const info = await getPrice(symbol);
  if (!info) return;

  const holding = portfolio.cryptos[symbol];
  const strat   = strategies[symbol];

  console.log(`→ ${symbol}: price=${info.price.toFixed(config.priceDecimalPlaces)}, trend=[${strat.trendHistory.join(',')}]`);
  if (!firstCycleDone) return;

  const decision = selectedStrategy.getTradeDecision({
    price:         info.price,
    lastPrice:     info.prev,
    costBasis:     holding.costBasis,
    strategyState: strat,
    config
  });
  if (!decision) return;

  let action = (decision.action || decision.side || '').toString().toUpperCase();

  // ─── BUY ───────────────────────────────────────────────────────────
  if (action === 'BUY') {
    // peak confirmation
    const th     = strat.trendHistory;
    const peakOK = !config.enablePeakFilter
                || (th.length === 3 && th[0]==='down' && th[1]==='down' && th[2]==='up');

    // cap logic: do not enforce caps in TEST_MODE; enforce only in LIVE if limitBuysSells
    const capBuys = config.testMode
                  ? true
                  : (config.limitBuysSells ? portfolio.buysToday < MAX_TEST_BUYS : true);

    if (!peakOK) {
      console.log(`⚠️ [${selectedStrategy.name}] BUY skipped: peak-confirmation not met`);
    } else if (strat.grid.length >= config.gridLevels) {
      console.log(`⚠️ [${selectedStrategy.name}] BUY skipped: grid at max levels (${config.gridLevels})`);
    } else if (!capBuys) {
      console.log(`⚠️ [${selectedStrategy.name}] BUY skipped: reached buy cap (${MAX_TEST_BUYS})`);
    } else {
      if (config.testMode) {
        console.log(`🟡 [SIM] [${selectedStrategy.name}] BUY ${holding.amount.toFixed(6)} ${symbol} @ $${info.price.toFixed(6)}`);
      }
      executeTrade(symbol, 'BUY', info.price);
    }
  }

  // ─── SELL ──────────────────────────────────────────────────────────
  else if (action === 'SELL') {
    const costBase = holding.costBasis;
    const netPrice = info.price * (1 - strat.slippage);
    const delta    = (netPrice - costBase) / costBase;

    // cap logic: do not enforce caps in TEST_MODE; enforce only in LIVE if limitBuysSells
    const capSells = config.testMode
                   ? true
                   : (config.limitBuysSells ? portfolio.sellsToday < MAX_TEST_SELLS : true);

    if (delta < config.baseSellThreshold) {
      console.log(`⚠️ [${selectedStrategy.name}] SELL skipped: Δ ${(delta*100).toFixed(2)}% < ${(config.baseSellThreshold*100).toFixed(2)}%`);
    } else if (!capSells) {
      console.log(`⚠️ [${selectedStrategy.name}] SELL skipped: reached sell cap (${MAX_TEST_SELLS})`);
    } else {
      if (config.testMode) {
        // use the first lot's amount as the qty
        const lot = strat.grid[0];
        console.log(`🟡 [SIM] [${selectedStrategy.name}] SELL ${lot.amount.toFixed(6)} ${symbol} @ $${info.price.toFixed(6)}`);
      }
      executeTrade(symbol, 'SELL', info.price);
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
  const startVal = portfolio.beginningPortfolioValue || 0;
  const profit   = endValue - startVal;
  const minutes  = Math.floor((Date.now() - portfolio.startTime)/60000);

  // Same conditional logic here
  const finalBuys = config.testMode
    ? `${portfolio.buysToday}`
    : `${portfolio.buysToday}/${config.limitBuysSells ? MAX_TEST_BUYS : '∞'}`;

  const finalSells = config.testMode
    ? `${portfolio.sellsToday}`
    : `${portfolio.sellsToday}/${config.limitBuysSells ? MAX_TEST_SELLS : '∞'}`;

  console.log('\n=== TOTAL PORTFOLIO SUMMARY ===');
  console.log(`Beginning Portfolio Value: $${startVal.toLocaleString()}`);
  console.log(`Duration: ${minutes} min`);
  console.log(`Buys:     ${finalBuys}`);
  console.log(`Sells:    ${finalSells}`);
  console.log(`Total P/L:   $${profit.toLocaleString()}`);
  console.log(`Cash:        $${portfolio.cashReserve.toLocaleString()}`);
  console.log(`Crypto (mkt):$${finalCrypto.toLocaleString()}`);
  console.log(`Locked:      $${portfolio.lockedCash.toLocaleString()}`);
  console.log('=============================\n');
}

// ==============================================
// Main Execution Entry Point
// ==============================================
(async () => {
  await promptStrategySelection();

  // Fetch or skip BP
  if (!config.demoMode && !config.testMode) {
    const bp = await fetchCryptoBuyingPower();
    if (bp!=null) portfolio.cashReserve = bp;
  } else {
    console.log('🧪 TEST_MODE: skipping BP fetch');
  }

  // Load & initialize
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym] = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  });
  seedStrategyGrids();
  if (config.demoMode) await refreshDemoCostBasis();

  // Initial price fetch, table, key bindings
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => getPrice(sym)));
  printHoldingsTable();

  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) initCrypto += info.price * portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue      = initCrypto;
  portfolio.beginningPortfolioValue = config.initialBalance + initCrypto;
  console.log(`\n=== STARTUP SUMMARY ===\nBeginning Portfolio Value: $${portfolio.beginningPortfolioValue.toLocaleString()}`);

  // Ctrl handlers
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name==='s') printStatus();
    if (key.ctrl && key.name==='g') printGrid();
    if (key.ctrl && key.name==='c') {
      process.stdin.setRawMode(false);
      process.emit('SIGINT');
    }
  });

  console.log('🔄 Seeding initial cycle (no trades)...');
  await Promise.all(Object.keys(portfolio.cryptos).map(sym => runStrategyForSymbol(sym)));
  firstCycleDone = true;
  console.log('✅ Initial cycle complete — trading now enabled.');

  const interval = setInterval(async () => {
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await printFinalSummary();
    process.exit(0);
  });
})();
