// strategies/ultimateSafetyProfitStrategy.js
// The Ultimate Safety & Profit Crypto Strategy
// Combines dynamic regime, ATR grid, profit lock, risk spread, and drawdown brake

const { parseISO, isAfter } = require('date-fns');

module.exports = {
  name: "Ultimate Safety Profit Strategy",
  version: "1.0",
  description: "Adaptive regime, volatility scaling, profit lock, risk spread, and emergency brake.",
  _lastProfitLockTime: null,
  _portfolioATH: 0,
  _drawdownTriggered: false,

  // === Helpers ===
  sma(prices, len) {
    if (!prices || prices.length < len) return null;
    return prices.slice(-len).reduce((a, b) => a + b, 0) / len;
  },
  atr(prices, len) {
    if (!prices || prices.length < len + 1) return null;
    let sum = 0;
    for (let i = prices.length - len; i < prices.length; i++) {
      sum += Math.abs(prices[i] - prices[i - 1]);
    }
    return sum / len;
  },
  stdev(prices, len) {
    if (!prices || prices.length < len) return null;
    const avg = this.sma(prices, len);
    const variance = prices.slice(-len).reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / len;
    return Math.sqrt(variance);
  },
  adx(trendHist) {
    if (!trendHist || trendHist.length < 14) return 20;
    const up   = trendHist.filter(t => t === "up").length;
    const down = trendHist.filter(t => t === "down").length;
    if (up > 10 || down > 10) return 40;
    if (up > 7 || down > 7) return 25;
    return 10;
  },

  // === Regime Detection ===
  detectRegime(state, config) {
    const ph = state.priceHistory;
    if (!ph || ph.length < 201) return "uptrend"; // default until enough history
    const sma50  = this.sma(ph, 50);
    const sma200 = this.sma(ph, 200);
    const curr   = ph[ph.length - 1];
    const adx    = this.adx(state.trendHistory);
    if (sma50 && sma200 && curr > sma50 && sma50 > sma200 && adx >= 25)
      return "uptrend";
    if (sma50 && sma200 && curr < sma50 && sma50 < sma200 && adx >= 25)
      return "downtrend";
    if (sma200 && Math.abs(curr - sma200) / sma200 < 0.01 && adx < 25)
      return "rangebound";
    return "rangebound";
  },

  // === Drawdown Brake (Tracks Portfolio ATH) ===
  checkDrawdownBrake(portfolio, config) {
    if (!portfolio || typeof portfolio.totalValue !== "number") return false;
    const ddBrake = parseFloat(process.env.DRAW_DOWN_BRAKE) || 0.15; // e.g., 0.15 = 15%
    const totalValue = portfolio.totalValue || 0;
    if (totalValue > this._portfolioATH) this._portfolioATH = totalValue;
    const drawdown = this._portfolioATH > 0 ? (this._portfolioATH - totalValue) / this._portfolioATH : 0;
    if (drawdown >= ddBrake) {
      if (!this._drawdownTriggered) {
        this._drawdownTriggered = true;
        console.log(`🛑 EMERGENCY BRAKE: Portfolio drawdown -${(drawdown*100).toFixed(1)}%. All buys paused, profits locked.`);
      }
      return true;
    } else if (this._drawdownTriggered && drawdown < ddBrake * 0.8) {
      this._drawdownTriggered = false;
      console.log("✅ Drawdown brake lifted. Normal trading resumed.");
    }
    return false;
  },

  // === Profit Lock (scheduled or threshold-based) ===
  shouldLockProfit(portfolio, config) {
    if (process.env.ULTIMATE_STRATEGY_ENABLE !== 'true') return false;
    const now = new Date();

    // Scheduled profit lock (e.g., 01:00 daily)
    if (
      process.env.PROFIT_LOCK_TYPE === 'scheduled' ||
      process.env.PROFIT_LOCK_TYPE === 'both'
    ) {
      const [h, m] = (process.env.PROFIT_LOCK_TIME || "00:00").split(':').map(Number);
      const todayLockTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      if ((!this._lastProfitLockTime || this._lastProfitLockTime < todayLockTime) && now >= todayLockTime) {
        return true;
      }
    }

    // Profit amount threshold
    const lockAmount = parseFloat(process.env.PROFIT_LOCK_AMOUNT) || 0;
    if (
      (process.env.PROFIT_LOCK_TYPE === 'amount' || process.env.PROFIT_LOCK_TYPE === 'both') &&
      portfolio.dailyProfitTotal >= lockAmount &&
      (!this._lastProfitLockTime || now - this._lastProfitLockTime > 3600*1000)
    ) {
      return true;
    }

    return false;
  },

  lockProfit(portfolio, config) {
    const lockPartial = parseFloat(process.env.PROFIT_LOCK_PARTIAL) || 1.0;
    const amountToLock = Math.round((portfolio.dailyProfitTotal * lockPartial) * 100) / 100;
    if (amountToLock > 0) {
      portfolio.lockedCash = Math.round((portfolio.lockedCash + amountToLock) * 100) / 100;
      portfolio.dailyProfitTotal = Math.round((portfolio.dailyProfitTotal - amountToLock) * 100) / 100;
      this._lastProfitLockTime = new Date();
      console.log(`🔒 PROFIT LOCKED: $${amountToLock} moved to locked cash. [${this._lastProfitLockTime.toLocaleString()}]`);
      return amountToLock;
    }
    return 0;
  },

  // === Main Trading Logic ===
  getTradeDecision({ symbol, price, lastPrice, costBasis, strategyState, portfolio, config }) {
    // Drawdown brake: if triggered, halt new buys
    if (this.checkDrawdownBrake(portfolio, config)) {
      return null;
    }

    // Risk spread: never allocate > risk spread per crypto per day
    const spread = parseFloat(process.env.RISK_SPREAD_PER_CRYPTO) || 0.33;
    if (portfolio && portfolio.currentDayBuys && portfolio.currentDayBuys[symbol]) {
      const spent = portfolio.currentDayBuys[symbol];
      if (spent / (portfolio.unlockedCash || 1) > spread) {
        if (process.env.DEBUG) {
          console.log(`[DEBUG][${symbol}] Risk spread limit reached for this coin.`);
        }
        return null;
      }
    }

    // Confirmation: Only buy after X ticks up
    const confTicks = parseInt(process.env.CONFIRM_TICKS, 10) || 3;
    if (strategyState && strategyState.upTicks) {
      if (strategyState.upTicks < confTicks) return null;
    }

    // Regime/volatility detection
    const regime = this.detectRegime(strategyState, config);
    const ph = strategyState.priceHistory;
    const atrLen = parseInt(process.env.ATR_LENGTH, 10) || 7;
    const atr = this.atr(ph, atrLen) || 0.01; // fallback if no ATR yet

    // Buy/sell thresholds (ATR-adaptive)
    const buyThresh = parseFloat(process.env.BUY_THRESHOLD_ATR) || 1.5; // ATR multiplier
    const sellThresh = parseFloat(process.env.SELL_THRESHOLD_ATR) || 1.0;

    // Priority cryptos logic (apply larger allocation for user’s favorites)
    const priList = (process.env.PRIORITY_CRYPTOS || '').split(',').map(s=>s.trim().toUpperCase());
    const isPriority = priList.includes(symbol.toUpperCase());

    if (process.env.DEBUG_BUYS) {
      console.log(`[DEBUG][${symbol}] Buy check: price=${price}, costBasis=${costBasis}, upTicks=${strategyState.upTicks}, regime=${regime}, atr=${atr}, buyThresh=${buyThresh}`);
    }

    // Buy logic
    if (regime === "uptrend" && isPriority && price > costBasis * 1.01 && (price - lastPrice) > atr * buyThresh) {
      return { action: "BUY", regime, reason: "Uptrend+priority breakout buy" };
    }
    if (regime === "rangebound" && price < this.sma(ph, 50) - atr * buyThresh) {
      return { action: "BUY", regime, reason: "Grid/rangebound buy" };
    }
    if (regime === "downtrend" && price < lastPrice - atr * buyThresh) {
      return { action: "BUY", regime, reason: "Deep dip buy in downtrend" };
    }

    // Sell logic: Take profit at ATR * sellThresh above grid/cost
    const grid = strategyState.grid || [];
    if (grid && grid.length > 0) {
      const lot = grid[0];
      if (lot && lot.amount > 0 && price >= lot.price + atr * sellThresh) {
        return {
          action: "SELL",
          price: price,
          amount: lot.amount,
          reason: `Grid SELL: price $${price} > grid entry $${lot.price} +${(atr*sellThresh).toFixed(5)}`
        };
      }
    }
    // Take-profit sell for priority cryptos if price rises > ATR*sellThresh above cost basis
    if (isPriority && price > costBasis + atr * sellThresh) {
      return {
        action: "SELL",
        price,
        amount: portfolio.cryptos[symbol]?.amount || 0,
        reason: "Priority take-profit sell"
      };
    }

    // No action
    return null;
  },

  updateStrategyState(symbol, state, config) {
    // Update trend, grid, upticks etc as your framework expects
    // Example: update upTicks
    if (!state.trendHistory) state.trendHistory = [];
    if (!state.priceHistory) state.priceHistory = [];
    // Track up ticks
    if (state.priceHistory.length >= 2) {
      const last = state.priceHistory[state.priceHistory.length - 2];
      const curr = state.priceHistory[state.priceHistory.length - 1];
      if (curr > last) {
        state.upTicks = (state.upTicks || 0) + 1;
      } else {
        state.upTicks = 0;
      }
    } else {
      state.upTicks = 0;
    }
  }
};
