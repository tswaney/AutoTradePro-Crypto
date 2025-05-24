// backend/testPrice.js

// ==============================================
// Grid Bot with Strategy Selection, Manual Holdings,
// Simulated Trading, and Status Shortcut (Ctrl+S) + Grid View (Ctrl+G)
// ==============================================

// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
const { execSync } = require('child_process');
if (process.stdin.isTTY) {
  try {
    // disable terminal flow control so we can intercept Ctrl+S/Ctrl+G
    execSync('stty -ixon', { stdio: 'inherit' });
  } catch (_) {
    /* ignore non-Unix environments */
  }
}

// Load environment variables
require('dotenv').config();

// Core modules
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { getAccessToken } = require('./sessionManager');

// ==============================================
// Read thresholds from .env (whole-number percentages)
// ==============================================
const SIMPLE_BUY_THRESHOLD  = parseFloat(process.env.SIMPLE_BUY_THRESHOLD)  || 2.0;  // percent
const SIMPLE_SELL_THRESHOLD = parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;  // percent

// ==============================================
// Configuration (tunable parameters)
// ==============================================
const config = {
  aiEnabled:          process.env.AI_ENABLED   === 'true',
  demoMode:           process.env.DEMO_MODE    === 'true',
  initialBalance:     parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount:     0.01,
  // convert percent thresholds to decimals
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

console.log(`\n=== Running in ${config.demoMode ? 'DEMO' : 'LIVE'} mode ===`);
console.log("Press CTRL+S for Status, CTRL+G for Grid view, CTRL+C to exit\n");

// Enable keypress events
readline.emitKeypressEvents(process.stdin);

// ==============================================
// API & Portfolio state
// ==============================================
const BASE_URL = 'https://api.robinhood.com/marketdata/forex/quotes/';
let portfolio = {
  cashReserve:            config.initialBalance,
  lockedCash:             0,
  cryptos:                {}, // will be populated
  buysToday:              0,
  sellsToday:             0,
  stopLossesToday:        0,
  dailyProfitTotal:       0,
  startTime:              new Date(),
  beginningPortfolioValue:0,
};

let strategies       = {};  // per-symbol state
let selectedStrategy = null;
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
    priceHistory:        [],
    trendHistory:        [],
    lastPrice:           null,
    module:              null,
    recent24h:           [],
    grid:                [], // seeded from holdings
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
      process.stdin.resume();
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
// Print current holdings table
// ==============================================
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(([sym, {amount,costBasis}], i) => ({
    No:        String(i+1),
    Symbol:    sym,
    Quantity:  amount.toFixed(6),
    Price:     (strategies[sym].lastPrice||0).toFixed(config.priceDecimalPlaces),
    CostBasis: costBasis.toFixed(6),
  }));
  const cols = ['No','Symbol','Quantity','Price','CostBasis'];
  const widths = {};
  cols.forEach(c => {
    widths[c] = Math.max(c.length, ...rows.map(r => r[c].length));
  });
  const sep = (l,m,r) => {
    let line = l;
    cols.forEach((c,i) => {
      line += '─'.repeat(widths[c]+2) + (i<cols.length-1 ? m : r);
    });
    return line;
  };

  console.log('\nCurrent Holdings:');
  console.log(sep('┌','┬','┐'));
  let hdr = '│';
  cols.forEach(c => {
    const pad = widths[c] - c.length;
    const left = Math.floor(pad/2), right = pad - left;
    hdr += ` ${' '.repeat(left)}${c}${' '.repeat(right)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  rows.forEach(r => {
    let line = '│';
    cols.forEach(c => {
      const v = r[c], pad = widths[c] - v.length;
      line += ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

// ==============================================
// Print Realized P/L Status on Ctrl+S
// ==============================================
function printStatus() {
  const cryptoVal = Object.keys(portfolio.cryptos)
    .reduce((sum,sym) => sum + (strategies[sym].lastPrice||0) * portfolio.cryptos[sym].amount, 0);
  const profit = portfolio.dailyProfitTotal;
  const avg    = portfolio.sellsToday>0 ? profit/portfolio.sellsToday : 0;

  const profitFmt = profit.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const avgFmt    = avg    !== null ? avg.toLocaleString('en-US',{style:'currency',currency:'USD'}) : 'N/A';
  const cashFmt   = portfolio.cashReserve.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const cryptoFmt = cryptoVal.toLocaleString('en-US',{style:'currency',currency:'USD'});
  const lockedFmt = portfolio.lockedCash.toLocaleString('en-US',{style:'currency',currency:'USD'});

  console.log('\n=== REALIZED P/L STATUS ===');
  console.log(`Buys:     ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(`Sells:    ${portfolio.sellsToday}/${config.sellLimit}`);
  console.log(`StopLoss: ${portfolio.stopLossesToday}/${config.stopLossLimit}`);
  console.log(`Realized Profit:   ${profitFmt} (avg ${avgFmt})`);
  console.log(`Cash: ${cashFmt}, CryptoVal: ${cryptoFmt}, Locked: ${lockedFmt}`);
}

// ==============================================
// Print unified Grid table on Ctrl+G
// ==============================================
function printGrid() {
  const rows = [];
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym].grid.forEach((lot,i) => {
      rows.push({
        Symbol: sym,
        Level:  String(i+1),
        Price:  lot.price.toFixed(config.priceDecimalPlaces),
        Amount: lot.amount.toFixed(6),
        Time:   new Date(lot.time).toLocaleString()
      });
    });
  });
  const cols = ['Symbol','Level','Price','Amount','Time'];
  const widths = {};
  cols.forEach(c => {
    widths[c] = Math.max(c.length, ...rows.map(r => r[c].length));
  });
  const sep = (l,m,r) => {
    let line = l;
    cols.forEach((c,i) => {
      line += '─'.repeat(widths[c]+2) + (i<cols.length-1 ? m : r);
    });
    return line;
  };

  console.log('\nCurrent Grid:');
  console.log(sep('┌','┬','┐'));
  let hdr = '│';
  cols.forEach(c => {
    const pad = widths[c] - c.length;
    const left = Math.floor(pad/2), right = pad - left;
    hdr += ` ${' '.repeat(left)}${c}${' '.repeat(right)} │`;
  });
  console.log(hdr);
  console.log(sep('├','┼','┤'));
  rows.forEach(r => {
    let line = '│';
    cols.forEach(c => {
      const v = r[c], pad = widths[c] - v.length;
      line += ` ${v}${' '.repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep('└','┴','┘'));
}

// ==============================================
// Fetch market data + update strategy state
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
    const strat = strategies[symbol];
    const prev  = strat.lastPrice;

    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1) strat.priceHistory.shift();

    if (typeof selectedStrategy.updateStrategyState === 'function') {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    const dir = prev == null
      ? 'neutral'
      : price > prev ? 'up'
      : price < prev ? 'down'
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
// Execute BUY or SELL and update portfolio/grid
// ==============================================
function executeTrade(symbol, action, price) {
  const strat   = strategies[symbol];
  const holding = portfolio.cryptos[symbol];

  if (action === 'BUY') {
    if (strat.grid.length >= config.gridLevels) {
      console.log(`⚠️ [${symbol}] BUY skipped: grid at max levels (${config.gridLevels})`);
      console.log();
      return;
    }

    const lotSize  = holding.grid[0].amount;
    const maxSpend = portfolio.cashReserve * 0.25;
    const cost     = price * lotSize * (1 + strat.slippage);
    const spend    = Math.min(cost, maxSpend);
    const qty      = spend / (price * (1 + strat.slippage));

    portfolio.cashReserve -= spend;
    portfolio.lockedCash  += price * qty;
    holding.amount       += qty;
    strat.grid.push({ price, amount: qty, time: Date.now() });
    portfolio.buysToday++;
    console.log(`🟢 [${symbol}] BUY ${qty.toFixed(6)} ${symbol} @ $${price.toFixed(6)}`);
    console.log();

  } else if (action === 'SELL') {
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
    console.log(`🔴 [${symbol}] SELL ${qty} ${symbol} @ $${price.toFixed(6)}  P/L $${pnl.toFixed(6)}`);
    console.log();
  }
}

// ==============================================
// Run strategy logic & log exactly two lines
// ==============================================
async function runStrategyForSymbol(symbol) {
  const info = await getPrice(symbol);
  if (!info) return;

  const costBasis = portfolio.cryptos[symbol].costBasis;
  const delta     = (info.price - costBasis) / costBasis;

  // Line 1: summary
  console.log();
  console.log(
    `[${symbol}] trend=[${strategies[symbol].trendHistory.join(',')}] ` +
    `Δ ${(delta*100).toFixed(4)}%, grid size: ${strategies[symbol].grid.length}`
  );
  console.log();

  // Line 2: detail
  console.log(
    `→ ${symbol}: price=${info.price.toFixed(config.priceDecimalPlaces)}, ` +
    `trend=[${strategies[symbol].trendHistory.join(',')}]`
  );
  console.log();

  if (!firstCycleDone) return;

  const decision = selectedStrategy.getTradeDecision({
    price:         info.price,
    lastPrice:     info.prev,
    costBasis,
    strategyState: strategies[symbol],
    config
  });
  if (!decision) return;

  const action = (decision.action || decision.side || '').toUpperCase();
  if (action === 'BUY') {
    console.log(`🟢 [${symbol}] BUY triggered: Δcost ${(delta*100).toFixed(4)}% <= ${(-config.baseBuyThreshold*100).toFixed(2)}%`);
    executeTrade(symbol, 'BUY', info.price);

  } else if (action === 'SELL') {
    if (delta >= config.baseSellThreshold) {
      executeTrade(symbol, 'SELL', info.price);
    } else {
      console.log(`⚠️ [${symbol}] SELL skipped: net Δ ${(delta*100).toFixed(4)}% < ${(config.baseSellThreshold*100).toFixed(2)}%`);
      console.log();
    }
  }
}

// ==============================================
// Main execution
// ==============================================
(async () => {
  // select strategy
  await promptStrategySelection();

  // load holdings & init per-symbol state
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach(sym => {
    strategies[sym]       = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  });
  seedStrategyGrids();

  // demo-only costBasis refresh
  if (config.demoMode) await refreshDemoCostBasis();

  // initial fetch & holdings table
  await Promise.all(Object.keys(portfolio.cryptos).map(getPrice));
  printHoldingsTable();

  // compute startup value
  portfolio.beginningPortfolioValue = config.initialBalance +
    Object.keys(portfolio.cryptos)
          .reduce((sum,sym) => sum + (strategies[sym].lastPrice||0) * portfolio.cryptos[sym].amount, 0);

  console.log(`\n=== STARTUP SUMMARY ===`);
  console.log(`Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`);

  // enable Ctrl key handlers
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name==='s') printStatus();
    if (key.ctrl && key.name==='g') printGrid();
    if (key.ctrl && key.name==='c') {
      process.stdin.setRawMode(false);
      process.emit('SIGINT');
    }
  });

  // seed first cycle (no trades)
  console.log('\n🔄 Seeding initial cycle (no trades)...');
  await Promise.all(Object.keys(portfolio.cryptos).map(runStrategyForSymbol));
  firstCycleDone = true;
  console.log('✅ Initial cycle complete — trading now enabled');

  // periodic execution
  const interval = setInterval(async () => {
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  // final summary on exit
  process.on('SIGINT', async () => {
    clearInterval(interval);
    let finalCrypto = 0;
    for (const sym of Object.keys(portfolio.cryptos)) {
      const info = await getPrice(sym);
      if (info) finalCrypto += info.price * portfolio.cryptos[sym].amount;
    }
    const endValue = portfolio.cashReserve + portfolio.lockedCash + finalCrypto;
    const profit   = endValue - portfolio.beginningPortfolioValue;
    const minutes  = Math.floor((Date.now() - portfolio.startTime) / 60000);
    const fmt = v => v.toLocaleString('en-US',{style:'currency',currency:'USD'});
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
    console.log(`Total Value: ${fmt(endValue)}`);
    console.log('=============================');
    process.exit(0);
  });
})();
