// backend/testPrice.js
// Grid Bot with Strategy Selection and Manual Holdings

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==============================================
// Configuration
// ==============================================
const config = {
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: process.env.DEMO_MODE === "true",
  liveTest: false,
  testMode: false,
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.15,
  baseBuyThreshold: -0.005,
  baseSellThreshold: 0.05,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  buyLimit: 22,
  sellLimit: 23,
  stopLossLimit: 5,
  stopLossPercent: -0.3,
  dailyProfitTarget: 400.2,
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02,
  strategy: "",
};

// ==============================================
// API Setup
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// ==============================================
// Portfolio & State
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {},
  buysToday: 0,
  sellsToday: 0,
  stopLossesToday: 0,
  tradeNumber: 0,
  dailyProfitTotal: 0,
  startTime: new Date(),
  lastReset: new Date(),
  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let strategies = {};
let selectedStrategy = null;

// ==============================================
// Helpers & Core Logic
// ==============================================
function formatPrice(price) {
  return parseFloat(price).toFixed(config.priceDecimalPlaces);
}

function initializeStrategy(symbol) {
  return {
    buyThreshold: config.baseBuyThreshold,
    sellThreshold: config.baseSellThreshold,
    atr: 0,
    dynamicBuyThreshold: null,
    dynamicSellThreshold: null,
    trend: "neutral",
    slippage: config.defaultSlippage,
    priceHistory: [],
    trendHistory: [],
    lastPrice: null,
    module: selectedStrategy,
  };
}

async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, "strategies"));
  const modules = files
    .filter((f) => f.endsWith(".js"))
    .map((f) => require(`./strategies/${f}`))
    .filter((m) => m.name && m.version && m.description);

  console.log("\n📌 Available Strategies:");
  modules.forEach((s, i) =>
    console.log(` [${i + 1}] ${s.name} (${s.version}) - ${s.description}`)
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question("\nSelect strategy [default 2]: ", (input) => {
      const idx = parseInt(input.trim());
      const strat = modules[idx > 0 && idx <= modules.length ? idx - 1 : 1];
      rl.close();
      config.strategy = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

function loadHoldings() {
  const file = path.join(__dirname, "cryptoHoldings.json");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  for (const symbol in data) {
    const { amount, costBasis } = data[symbol];
    if (amount > config.minTradeAmount) {
      portfolio.cryptos[symbol] = { amount, costBasis, grid: [] };
    }
  }
}

async function refreshDemoCostBasis() {
  const file = path.join(__dirname, "cryptoHoldings.json");
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  for (const symbol of Object.keys(portfolio.cryptos)) {
    const res = await axios.get(`${BASE_URL}${symbol}/`, { headers: HEADERS });
    const price = parseFloat(res.data.mark_price);
    data[symbol].costBasis = price;
    portfolio.cryptos[symbol].costBasis = price;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(
    ([symbol, { amount, costBasis }], i) => ({
      No: String(i + 1),
      Symbol: symbol,
      Quantity: amount.toFixed(6),
      Price: (strategies[symbol].lastPrice ?? 0).toFixed(8),
      CostBasis: costBasis.toFixed(6),
    })
  );
  const cols = ["No", "Symbol", "Quantity", "Price", "CostBasis"];
  const widths = {};
  cols.forEach(
    (c) => (widths[c] = Math.max(c.length, ...rows.map((r) => r[c].length)))
  );
  const sep = (l, m, r) => {
    let line = l;
    cols.forEach(
      (c, i) =>
        (line += "─".repeat(widths[c] + 2) + (i < cols.length - 1 ? m : r))
    );
    return line;
  };

  console.log("\nCurrent Holdings:");
  console.log(sep("┌", "┬", "┐"));
  // Header
  let hdr = "│";
  cols.forEach((c) => {
    const pad = widths[c] - c.length;
    const left = Math.floor(pad / 2),
      right = pad - left;
    hdr += " " + " ".repeat(left) + c + " ".repeat(right) + " " + "│";
  });
  console.log(hdr);
  console.log(sep("├", "┼", "┤"));
  // Rows
  rows.forEach((r) => {
    let line = "│";
    cols.forEach((c) => {
      const val = r[c],
        pad = widths[c] - val.length;
      line += " " + val + " ".repeat(pad) + " " + "│";
    });
    console.log(line);
  });
  console.log(sep("└", "┴", "┘"));
}

async function getPrice(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });
    const price = parseFloat(res.data.mark_price);
    const strat = strategies[symbol];
    const prev = strat.lastPrice;

    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1)
      strat.priceHistory.shift();

    // update ATR and thresholds
    selectedStrategy.updateStrategyState(symbol, strat, config);

    strat.trendHistory.push(
      prev === null
        ? "neutral"
        : price > prev
        ? "up"
        : price < prev
        ? "down"
        : "neutral"
    );
    if (strat.trendHistory.length > 3) strat.trendHistory.shift();

    strat.lastPrice = price;
    return { price, prev };
  } catch (err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

function executeTrade(symbol, action, price, overrideSize) {
  const crypto = portfolio.cryptos[symbol];
  const strat = strategies[symbol];
  const slippage = config.testMode ? 0 : strat.slippage;
  const maxTrade =
    (portfolio.cashReserve / Object.keys(portfolio.cryptos).length) *
    config.maxTradePercent;
  const usd = Math.min(
    maxTrade,
    Math.max(config.minTradeAmount, maxTrade * 0.75)
  );
  const adjPrice = price * (1 + (action === "buy" ? slippage : -slippage));
  const size = overrideSize || usd / adjPrice;

  if (action === "buy") {
    portfolio.cashReserve -= adjPrice * size;
    crypto.amount += size;
    crypto.grid.push({ price: adjPrice, amount: size, time: Date.now() });
    // Recompute cost basis
    const totalValue = crypto.grid.reduce(
      (sum, lot) => sum + lot.price * lot.amount,
      0
    );
    const totalAmount = crypto.grid.reduce((sum, lot) => sum + lot.amount, 0);
    crypto.costBasis = totalValue / totalAmount;
  } else {
    const profit = (adjPrice - crypto.costBasis) * size;
    portfolio.dailyProfitTotal += profit;
    portfolio.lockedCash += profit * config.profitLockPercent;
    portfolio.cashReserve +=
      adjPrice * size + profit * (1 - config.profitLockPercent);
    crypto.amount -= size;
  }

  portfolio.tradeNumber++;
  console.log(
    `\n… ${action.toUpperCase()} ${size.toFixed(
      4
    )} ${symbol} @${adjPrice.toFixed(4)} executed.`
  );
}

async function runStrategyForSymbol(symbol) {
  const strat = strategies[symbol];
  const hold = portfolio.cryptos[symbol];
  const oldPrice = strat.lastPrice;
  const info = await getPrice(symbol);
  if (!info) return;
  const { price } = info;

  console.log(
    `→ ${symbol}: lastPrice=${oldPrice}, price=${price}, ` +
      `trendHistory=[${strat.trendHistory.join(",")}]`
  );

  const decision = strat.module.getTradeDecision({
    price,
    lastPrice: oldPrice,
    costBasis: hold.costBasis,
    strategyState: strat,
    config,
  });
  if (!decision || !decision.action) return;

  executeTrade(symbol, decision.action, price);
}

// ==============================================
// MAIN
// ==============================================
(async () => {
  await promptStrategySelection();
  loadHoldings();

  Object.keys(portfolio.cryptos).forEach((s) => {
    strategies[s] = initializeStrategy(s);
  });

  if (config.demoMode) {
    await refreshDemoCostBasis();
  }

  // initial price fetch for table
  for (const s of Object.keys(portfolio.cryptos)) {
    await getPrice(s);
  }

  printHoldingsTable();

  if (config.demoMode) {
    portfolio.buysToday = portfolio.sellsToday = portfolio.stopLossesToday = 0;
  }

  // compute starting values
  let initCrypto = 0;
  for (const s of Object.keys(portfolio.cryptos)) {
    const { price } = await getPrice(s);
    initCrypto += price * portfolio.cryptos[s].amount;
  }
  portfolio.initialCryptoValue = initCrypto;
  portfolio.beginningPortfolioValue = config.initialBalance + initCrypto;

  // startup summary
  const N = Object.keys(portfolio.cryptos).length;
  const totalMax = config.initialBalance * config.maxTradePercent;
  console.log("\n=== STARTUP ===");
  console.log(
    `Beginning Value: $${portfolio.beginningPortfolioValue.toFixed(2)}`
  );
  console.log(`  – Cash:   $${config.initialBalance.toFixed(2)}`);
  console.log(`  – Crypto: $${initCrypto.toFixed(2)}`);
  console.log(
    `Max Crypto Trade Size: $${(totalMax / N).toFixed(
      2
    )} * ${N} = $${totalMax.toFixed(2)}`
  );
  console.log(
    `Buy Limit: ${config.buyLimit}, Sell Limit: ${config.sellLimit}, Stop-Loss Limit: ${config.stopLossLimit}`
  );
  console.log(
    `Daily Profit Target: $${config.dailyProfitTarget}, LiveTest: ${config.liveTest}`
  );
  console.log("================\n");

  // initial run
  for (const s of Object.keys(portfolio.cryptos)) {
    await runStrategyForSymbol(s);
  }

  // recurring loop
  const interval = setInterval(async () => {
    const now = Date.now();
    if (now - portfolio.lastReset.getTime() >= ONE_DAY_MS) {
      portfolio.buysToday =
        portfolio.sellsToday =
        portfolio.stopLossesToday =
        portfolio.dailyProfitTotal =
          0;
      portfolio.lastReset = new Date(now);
      console.log("🔄 24h elapsed—counters reset.");
    }
    for (const s of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(s);
    }
  }, config.checkInterval);

  process.on("SIGINT", () => {
    clearInterval(interval);
    const dur = Math.floor((Date.now() - portfolio.startTime) / 60000);
    console.log("\n=== FINAL SUMMARY ===");
    console.log(`Duration: ${dur} min`);
    console.log(`Buys: ${portfolio.buysToday}/${config.buyLimit}`);
    console.log(`Profit-Sells: ${portfolio.sellsToday}/${config.sellLimit}`);
    console.log(
      `Stop-Loss Sells: ${portfolio.stopLossesToday}/${config.stopLossLimit}`
    );
    console.log(
      `Total Profit Today: $${portfolio.dailyProfitTotal.toFixed(2)}`
    );
    const avg = portfolio.sellsToday
      ? (portfolio.dailyProfitTotal / portfolio.sellsToday).toFixed(2)
      : "N/A";
    console.log(`Average Profit/Sell: $${avg}`);
    console.log("====================");
    process.exit(0);
  });
})();
