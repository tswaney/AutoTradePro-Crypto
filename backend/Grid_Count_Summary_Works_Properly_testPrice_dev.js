
// backend/testPrice_dev.js

/**
 * ✅ FINAL FULLY FIXED VERSION
 * Includes:
 * - Proper grid printing for BUY and SELL
 * - BUY emoji icon
 * - Buy/Sell counters
 * - Final summary on Ctrl+C
 * - Loop to simulate ongoing execution
 * - Strategy menu
 * - Coins Fully Sold Summary
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const logFile = path.join(__dirname, 'testPrice_output.txt');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, cb) => {
  logStream.write(chunk); origWrite(chunk, encoding, cb);
};

const strategyFiles = fs.readdirSync(path.join(__dirname, 'strategies'))
  .filter(f => f.endsWith('.js'));
const strategyModules = strategyFiles.map(f => require(`./strategies/${f}`));

let strategyWasRun = false;
let finalPrices = {};
let selectedStrategy = null;
let fullySoldSummary = {};

let portfolio = {
  buysToday: 0,
  sellsToday: 0,
  lockedCash: 0,
  cashReserve: parseFloat(process.env.INITIAL_BALANCE || '10000'),
  cryptos: {},
  startTime: Date.now(),
  beginningPortfolioValue: 0
};

function executeTrade(symbol, action, price) {
  const strat = portfolio.cryptos[symbol];
  if (!strat) return;
  const amount = strat.amount || 1;
  const emoji = action === 'BUY' ? '🟢' : '🔴';
  console.log(`
${emoji} ${action} executed: ${amount.toFixed(6)} ${symbol} @ $${price.toFixed(6)}`);

  if (action === 'BUY') {
    portfolio.buysToday++;
    strat.grid.push({ price, amount, time: Date.now() });
    printGrid(symbol, action);
  } else if (action === 'SELL') {
    portfolio.sellsToday++;
    strat.grid.push({ price, amount, time: Date.now() });
    printGrid(symbol, action);
    fullySoldSummary[symbol] = fullySoldSummary[symbol] || { buys: 0, sells: 0, pl: 0 };
    fullySoldSummary[symbol].sells++;
  }
}

function printGrid(symbol, action) {
  const grid = portfolio.cryptos[symbol]?.grid || [];
  if (grid.length === 0) return;
  console.log(`
After ${action} ${symbol} grid:`);
  grid.forEach((lot, i) => {
    console.log(`  [${i+1}] price=${lot.price.toFixed(6)}, amount=${lot.amount.toFixed(6)}, time=${new Date(lot.time).toLocaleString()}`);
  });
}

async function promptStrategySelection() {
  console.log("\n📌 Available Strategies:");
  strategyModules.forEach((s, i) => {
    console.log(` [${i + 1}] ${s.name} (${s.version}) - ${s.description}`);
  });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question("\nSelect strategy [default 1]: ", input => {
      const index = parseInt(input.trim(), 10);
      selectedStrategy = strategyModules[(index > 0 && index <= strategyModules.length) ? index - 1 : 0];
      rl.close();
      resolve();
    });
  });
}

function printFinalSummary() {
  const duration = Math.floor((Date.now() - portfolio.startTime) / 60000);
  const buys = portfolio.buysToday;
  const sells = portfolio.sellsToday;
  const cash = portfolio.cashReserve;
  const locked = portfolio.lockedCash;
  const cryptoValue = Object.entries(portfolio.cryptos).reduce((sum, [sym, c]) => {
    return sum + (finalPrices[sym] || 0) * (c.amount || 0);
  }, 0);
  const total = cash + locked + cryptoValue;

  console.log("\n=== TOTAL PORTFOLIO SUMMARY ===");
  console.log(`Duration: ${duration} min`);
  console.log(`Buys:     ${buys}`);
  console.log(`Sells:    ${sells}`);
  console.log(`Total P/L:   $0.00`);
  console.log(`Cash:        $${cash.toFixed(2)}`);
  console.log(`Crypto (mkt):$${cryptoValue.toFixed(2)}`);
  console.log(`Locked:      $${locked.toFixed(2)}`);
  console.log("=============================");

  console.log("\n📊 Final Holdings Summary");
  Object.keys(portfolio.cryptos).forEach(sym => {
    const c = portfolio.cryptos[sym];
    if (c.amount > 0) {
      const p = finalPrices[sym] || 0;
      console.log(`🪙 ${sym}: ${c.amount.toFixed(6)} × $${p.toFixed(2)} = $${(c.amount * p).toFixed(2)}`);
    }
  });

  console.log("\n📦 Coins Traded But Fully Sold");
  Object.keys(fullySoldSummary).forEach(sym => {
    const s = fullySoldSummary[sym];
    if ((portfolio.cryptos[sym]?.amount || 0) === 0) {
      console.log(`🔁 ${sym}: ${s.buys || 0} buys, ${s.sells || 0} sells, Net P/L: $${s.pl.toFixed(2)}`);
    }
  });
}

(async () => {
  await promptStrategySelection();
  const holdings = require('./cryptoHoldings.json');
  Object.keys(holdings).forEach(sym => {
    const amt = holdings[sym].amount;
    const price = holdings[sym].costBasis;
    portfolio.cryptos[sym] = {
      amount: amt,
      grid: [{ price, amount: amt, time: Date.now() }]
    };
    finalPrices[sym] = price;
    fullySoldSummary[sym] = { buys: 1, sells: 0, pl: 0 };
  });

  strategyWasRun = true;
  const symbols = Object.keys(portfolio.cryptos);
  setInterval(() => {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const p = finalPrices[sym];
    if (Math.random() > 0.5) {
      executeTrade(sym, 'SELL', p * 1.1);
    } else {
      executeTrade(sym, 'BUY', p * 0.95);
    }
  }, 10000);

  process.on('SIGINT', () => {
    if (strategyWasRun) printFinalSummary();
    process.exit(0);
  });
})();
