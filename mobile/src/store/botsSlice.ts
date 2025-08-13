// mobile/src/store/botsSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from './index';
import { BotState, BotSummary, BotStatus } from '../types';
import { api } from '../api/client';

const stripAnsi = (s: string) => s.replaceAll(/\u001b\[[0-9;]*[A-Za-z]/g, '');

export const fetchBotStatus = createAsyncThunk('bots/status', async (botId: string) => {
  const res = await api.status(botId);
  return { botId, status: (res.status as BotStatus) || 'stopped' };
});

export const startBot = createAsyncThunk('bots/start', async (botId: string) => {
  await api.start(botId); return { botId, ok: true };
});

export const stopBot = createAsyncThunk('bots/stop', async (botId: string) => {
  await api.stop(botId); return { botId, ok: true };
});

export const fetchLogsStreamStart = createAsyncThunk('bots/logStreamStart', async (botId: string, { dispatch }) => {
  for await (const chunk of api.logs(botId)) {
    dispatch(appendLog({ botId, chunk: String(chunk) }));
  }
  return { botId };
});

const parseSummaryBlock = (text: string): BotSummary | null => {
  const blockRe = /===\s*TOTAL PORTFOLIO SUMMARY\s*===([\s\S]*?)=+/m;
  const m = blockRe.exec(text);
  if (!m) return null;
  const getNum = (label: string, d = 0) => {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*\\$?([0-9.,]+)');
    const mm = re.exec(m[1]);
    return mm ? parseFloat(mm[1].replace(/,/g, '')) : d;
  };
  const getStr = (label: string, d = '') => {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^\n]+)');
    const mm = re.exec(m[1]);
    return mm ? mm[1].trim() : d;
  };
  return {
    beginningValue: getNum('Beginning Portfolio Value', 0),
    duration: getStr('Duration', '—'),
    buys: getNum('Buys', 0),
    sells: getNum('Sells', 0),
    totalPL: getNum('Total P/L', 0),
    cash: getNum('Cash', 0),
    cryptoMkt: getNum('Crypto \\(mkt\\)', 0),
    locked: getNum('Locked', 0)
  };
};

type BotsSliceState = { byId: Record<string, BotState> };
const initialState: BotsSliceState = {
  byId: {
    'default': { id: 'default', name: 'Default Bot', status: 'stopped', follow: true, unreadCount: 0, lines: [] },
  }
};

const bots = createSlice({
  name: 'bots',
  initialState,
  reducers: {
    appendLog(state, action: PayloadAction<{ botId: string, chunk: string }>) {
      const { botId, chunk } = action.payload;
      const bot = state.byId[botId]; if (!bot) return;
      const clean = stripAnsi(chunk).replace(/\r/g, '');
      const lines = clean.split(/\n/);
      if (!bot.follow) bot.unreadCount += lines.filter(Boolean).length;
      bot.lines.push(...lines);
      if (bot.lines.length > 10000) bot.lines.splice(0, bot.lines.length - 8000);
      const maybe = parseSummaryBlock(clean);
      if (maybe) bot.summary = maybe;
    },
    toggleFollow(state, action: PayloadAction<string>) {
      const bot = state.byId[action.payload]; if (!bot) return;
      bot.follow = !bot.follow;
      if (bot.follow) bot.unreadCount = 0;
    },
    jumpToLatest(state, action: PayloadAction<string>) {
      const bot = state.byId[action.payload]; if (!bot) return;
      bot.follow = true; bot.unreadCount = 0;
    },
    setBots(state, action: PayloadAction<BotState[]>) {
      for (const b of action.payload) state.byId[b.id] = b;
    }
  },
  extraReducers: builder => {
    builder.addCase(fetchBotStatus.fulfilled, (state, action) => {
      const { botId, status } = action.payload;
      const bot = state.byId[botId]; if (!bot) return;
      bot.status = status;
    });
    builder.addCase(startBot.fulfilled, (state, action) => {
      const bot = state.byId[action.payload.botId]; if (!bot) return;
      bot.status = 'running';
    });
    builder.addCase(stopBot.fulfilled, (state, action) => {
      const bot = state.byId[action.payload.botId]; if (!bot) return;
      bot.status = 'stopped';
    });
  }
});

export const { appendLog, toggleFollow, jumpToLatest, setBots } = bots.actions;
export default bots.reducer;

export const selectBotById = (s: RootState, id: string) => s.bots.byId[id];