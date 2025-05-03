// backend/testPrice.js
// Grid Bot with Strategy Selection, Manual Holdings, and Status Shortcut (Ctrl+S)

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==============================================
// Configuration (all strategies)
// ==============================================
const config = {
  // — Feature flags —
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: process.env.DEMO_MODE === "true",
  liveTest: false, // real 0.01 trades for smoke tests
  testMode: false, // bypass slippage & live checks

  // — Portfolio sizing & risk —
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.15,

  // — Entry/exit thresholds —
  baseBuyThreshold: -0.005, // –0.5%
  baseSellThreshold: 0.05, // +5%
  dailyProfitTarget: 400.2, // target profit per day

  // — ATR & grid settings —
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02,

  // — Trade cadence & limits —
  checkInterval: 30000, // 30s
  priceDecimalPlaces: 8,
  buyLimit: 22, // max buys per 24h
  sellLimit: 23, // max profit-sells per 24h
  stopLossLimit: 5, // max stop-loss sells per 24h
  stopLossPercent: -0.3,

  // — Runtime —
  strategy: "",
};

// Precompute minimum profit per sell to hit daily target
const minProfitPerTrade = config.dailyProfitTarget / config.sellLimit;

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

  dailyProfitTotal: 0,

  startTime: new Date(),
  lastReset: new Date(),

  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let strategies = {},
  selectedStrategy = null;

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
    recent24h: [],
  };
}

async function promptStrategySelection() {
  const files = fs
    .readdirSync(path.join(__dirname, "strategies"))
    .filter((f) => f.endsWith(".js"))
    .sort();

  const modules = files
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
    rl.question("\nSelect strategy [default 4]: ", (input) => {
      const idx = parseInt(input.trim());
      const strat = modules[idx > 0 && idx <= modules.length ? idx - 1 : 3];
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
      Price: (strategies[symbol].lastPrice || 0).toFixed(8),
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
  let hdr = "│";
  cols.forEach((c) => {
    const pad = widths[c] - c.length;
    const left = Math.floor(pad / 2),
      right = pad - left;
    hdr += " " + " ".repeat(left) + c + " ".repeat(right) + " " + "│";
  });
  console.log(hdr);
  console.log(sep("├", "┼", "┤"));
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

    selectedStrategy.updateStrategyState(symbol, strat, config);

    const dir =
      prev == null
        ? "neutral"
        : price > prev
        ? "up"
        : price < prev
        ? "down"
        : "neutral";
    strat.trendHistory.push(dir);
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
    if (portfolio.buysToday >= config.buyLimit) {
      console.log("⚠️  Buy limit reached; skipping buy.");
      return;
    }
    portfolio.buysToday++;
    const tradeNo = portfolio.buysToday;
    const tradesLeft = config.buyLimit - tradeNo;
    portfolio.cashReserve -= adjPrice * size;
    crypto.amount += size;
    crypto.grid.push({ price: adjPrice, amount: size, time: Date.now() });
    const totalVal = crypto.grid.reduce(
      (sum, lot) => sum + lot.price * lot.amount,
      0
    );
    const totalAmt = crypto.grid.reduce((sum, lot) => sum + lot.amount, 0);
    crypto.costBasis = totalVal / totalAmt;
    console.log(
      `🎉 \x1b[32m>>> BUY ${size.toFixed(4)} ${symbol} @${adjPrice.toFixed(
        4
      )} executed! <<<\x1b[0m ` +
        `BUY Trade #${tradeNo} of ${config.buyLimit} (${tradesLeft} left)`
    );
  } else {
    const potentialSize = overrideSize || usd / adjPrice;
    const potentialProfit = (adjPrice - crypto.costBasis) * potentialSize;
    if (potentialProfit < minProfitPerTrade) {
      console.log(
        `⏭️  SELL skipped: potential $${potentialProfit.toFixed(
          2
        )} < $${minProfitPerTrade.toFixed(2)} min`
      );
      return;
    }
    if (portfolio.sellsToday >= config.sellLimit) {
      console.log("⚠️  Sell limit reached; skipping sell.");
      return;
    }
    portfolio.sellsToday++;
    const tradeNo = portfolio.sellsToday;
    const tradesLeft = config.sellLimit - tradeNo;
    portfolio.dailyProfitTotal += potentialProfit;
    portfolio.lockedCash += potentialProfit * config.profitLockPercent;
    portfolio.cashReserve +=
      adjPrice * potentialSize +
      potentialProfit * (1 - config.profitLockPercent);
    crypto.amount -= potentialSize;
    console.log(
      `🚀 \x1b[31m>>> SELL ${potentialSize.toFixed(
        4
      )} ${symbol} @${adjPrice.toFixed(4)} executed! <<<\x1b[0m ` +
        `SELL Trade #${tradeNo} of ${config.sellLimit} (${tradesLeft} left)`
    );
  }
}

async function runStrategyForSymbol(symbol) {
  if (portfolio.dailyProfitTotal >= config.dailyProfitTarget) {
    console.log("🎯 Daily profit target reached; pausing trades.");
    return;
  }
  const strat = strategies[symbol];
  const hold = portfolio.cryptos[symbol];
  const oldPrice = strat.lastPrice;
  const info = await getPrice(symbol);
  if (!info) return;
  console.log(
    `→ ${symbol}: lastPrice=${oldPrice}, price=${
      info.price
    }, trendHistory=[${strat.trendHistory.join(",")}]`
  );
  const decision = strat.module.getTradeDecision({
    price: info.price,
    lastPrice: oldPrice,
    costBasis: hold.costBasis,
    strategyState: strat,
    config,
  });
  if (!decision || !decision.action) return;
  executeTrade(symbol, decision.action, info.price);
}

function printStatus() {
  const cryptoVal = Object.keys(portfolio.cryptos).reduce(
    (sum, sym) =>
      sum + (strategies[sym].lastPrice || 0) * portfolio.cryptos[sym].amount,
    0
  );
  const avg =
    portfolio.sellsToday > 0
      ? (portfolio.dailyProfitTotal / portfolio.sellsToday).toFixed(2)
      : "N/A";

  console.log("\n=== STATUS INFORMATION ===");
  console.log(`Buys Today:         ${portfolio.buysToday}/${config.buyLimit}`);
  console.log(
    `Profit-Sells Today: ${portfolio.sellsToday}/${config.sellLimit}`
  );
  console.log(
    `Stop-Loss Sells:    ${portfolio.stopLossesToday}/${config.stopLossLimit}`
  );
  console.log(`Total Profit Today: $${portfolio.dailyProfitTotal.toFixed(2)}`);
  console.log(`Average Profit/Sell: $${avg}`);
  console.log(`Cash Reserve:       $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`Crypto Value:       $${cryptoVal.toFixed(2)}`);
  console.log(`Locked Cash:        $${portfolio.lockedCash.toFixed(2)}`);
  console.log("============================\n");
}

// ==============================================
// MAIN
// ==============================================
(async () => {
  await promptStrategySelection();
  loadHoldings();

  Object.keys(portfolio.cryptos).forEach((sym) => {
    strategies[sym] = initializeStrategy(sym);
  });

  if (config.demoMode) {
    await refreshDemoCostBasis();
  }

  for (const sym of Object.keys(portfolio.cryptos)) {
    await getPrice(sym);
  }
  printHoldingsTable();

  if (config.demoMode) {
    portfolio.buysToday = portfolio.sellsToday = portfolio.stopLossesToday = 0;
  }

  // compute starting values
  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const { price } = await getPrice(sym);
    initCrypto += price * portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue = initCrypto;
  portfolio.beginningPortfolioValue = config.initialBalance + initCrypto;

  // STARTUP SUMMARY
  const N = Object.keys(portfolio.cryptos).length;
  const totalMax = config.initialBalance * config.maxTradePercent;
  console.log("\n=== STARTUP ===");
  console.log(
    `Beginning Value:       $${portfolio.beginningPortfolioValue.toFixed(2)}`
  );
  console.log(`  – Cash:              $${config.initialBalance.toFixed(2)}`);
  console.log(`  – Crypto:            $${initCrypto.toFixed(2)}`);
  console.log(`  – Locked Cash:       $${portfolio.lockedCash.toFixed(2)}`);
  console.log(
    `Max Trade Size:       $${(totalMax / N).toFixed(
      2
    )} * ${N} = $${totalMax.toFixed(2)}`
  );
  console.log(`Buy Limit:            ${config.buyLimit}`);
  console.log(`Sell Limit:           ${config.sellLimit}`);
  console.log(`Stop-Loss Limit:      ${config.stopLossLimit}`);
  console.log(`Daily Profit Target:  $${config.dailyProfitTarget}`);
  console.log("================\n");

  // Enable Ctrl+S / Ctrl+C handling
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
  }
  process.stdin.on("keypress", (_str, key) => {
    if (key.ctrl && key.name === "s") {
      printStatus();
    } else if (key.ctrl && key.name === "c") {
      process.stdin.setRawMode(false);
      process.emit("SIGINT");
    }
  });

  // initial run
  for (const sym of Object.keys(portfolio.cryptos)) {
    await runStrategyForSymbol(sym);
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
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  // on CTRL+C or SIGINT, print final summary & exit
  process.on("SIGINT", async () => {
    clearInterval(interval);

    let finalCrypto = 0;
    for (const sym of Object.keys(portfolio.cryptos)) {
      await getPrice(sym);
      finalCrypto +=
        (strategies[sym].lastPrice || 0) * portfolio.cryptos[sym].amount;
    }
    const endValue = portfolio.cashReserve + portfolio.lockedCash + finalCrypto;
    const profit = endValue - portfolio.beginningPortfolioValue;
    portfolio.dailyProfitTotal = profit;

    const dur = Math.floor((Date.now() - portfolio.startTime) / 60000);
    console.log("\n=== FINAL SUMMARY ===");
    console.log(`Duration:              ${dur} min`);
    console.log(
      `Buys:                  ${portfolio.buysToday}/${config.buyLimit}`
    );
    console.log(
      `Profit-Sells:          ${portfolio.sellsToday}/${config.sellLimit}`
    );
    console.log(
      `Stop-Loss Sells:       ${portfolio.stopLossesToday}/${config.stopLossLimit}`
    );
    console.log(`Total Profit:          $${profit.toFixed(2)}`);
    console.log("End Portfolio Value Breakdown:");
    console.log(`  – Cash:              $${portfolio.cashReserve.toFixed(2)}`);
    console.log(`  – Crypto:            $${finalCrypto.toFixed(2)}`);
    console.log(`  – Locked Cash:       $${portfolio.lockedCash.toFixed(2)}`);
    console.log(`  – Total:             $${endValue.toFixed(2)}`);
    console.log("====================");
    process.exit(0);
  });
})();
