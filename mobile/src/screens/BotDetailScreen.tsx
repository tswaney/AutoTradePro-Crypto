import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';

import LogViewer from '../components/LogViewer';
import SummaryBlock, { Summary } from '../components/SummaryBlock';
import HeaderActions from '../components/HeaderActions';
import { apiDelete, apiGet, apiPost, logout as apiLogout } from '../../api';

type Props = { route: { params: { botId: string; botName?: string } } };
const SIGNED_KEY = 'autotradepro.signedIn';

// remove ANSI codes
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

export default function BotDetailScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const { botId, botName } = route.params;

  const [status, setStatus] = useState<'running'|'stopped'|'starting'|'stopping'|'unknown'>('unknown');
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(true);
  const [unread, setUnread] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | undefined>(undefined);

  // Gates
  const [bpvReady, setBpvReady] = useState(false);        // keep BPV at 0 until startup summary
  const [tradeReady, setTradeReady] = useState(false);    // hide buys/sells until “Initial cycle complete”

  // internals
  const summaryPath = useRef<string | null>(null);
  const logPath = useRef<string | null>(null);
  const lastLen = useRef(0);

  // locked monotonic accumulation
  const baseLockedRef = useRef<number>(0);
  const lockedDeltaRef = useRef<number>(0);

  useEffect(() => {
    navigation.setOptions({
      headerBackTitle: 'Bot List',
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Home')} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#7AA5FF', fontWeight: '600' }}>{'‹  Bot List'}</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <HeaderActions
          onRefresh={() => { refreshStatus(); refreshSummary(); pollLogs(); }}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          }}
        />
      ),
    });
  }, [navigation]);

  // ------------ helpers ------------
  const normalizeStatus = (s: any) => {
    const t = String(s?.status ?? s ?? '').toLowerCase();
    if (t.includes('running') || t === 'true') return 'running';
    if (t.includes('starting')) return 'starting';
    if (t.includes('stopping')) return 'stopping';
    if (t.includes('stopped') || t === 'false') return 'stopped';
    return 'unknown';
  };

  const pickNum = (obj: any, ...keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v == null) continue;
      const n = typeof v === 'string' ? Number(String(v).replace(/[$,]/g, '')) : Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const normalizeSummary = (r: any): Summary => ({
    beginningPortfolioValue: pickNum(r, 'beginningPortfolioValue','begin','startValue','startingBalance','beginValue'),
    duration: r?.duration ?? r?.uptime ?? r?.elapsed ?? r?.runtime,
    buys: r?.buys ?? r?.buyCount ?? r?.tradesBuy ?? r?.totalBuys,
    sells: r?.sells ?? r?.sellCount ?? r?.tradesSell ?? r?.totalSells,
    totalPL: pickNum(r, 'totalPL','totalPnL','pnl','pl','profitTotal','pnlTotal'),
    pl24h: pickNum(r, 'pl24h','pnl24h','dailyPL','pl_24h'),
    avgDailyPL: pickNum(r, 'avgDailyPL','avgPLPerDay','avgProfitPerDay'),
    cash: pickNum(r, 'cash','balance','free'),
    cryptoMkt: pickNum(r, 'cryptoMkt','crypto','marketValue','cryptoMarketValue','equity','holdingsValue','portfolioCryptoValue'),
    locked: pickNum(r, 'locked','margin','held','profitLocked'),
  });

  const ensureCryptoFallback = (s: Summary): Summary => {
  const hasCrypto = s.cryptoMkt != null && Number.isFinite(s.cryptoMkt as any);
  const hasBegin = Number.isFinite(s.beginningPortfolioValue as any);
  const hasPl = Number.isFinite(s.totalPL as any);
  const cash = Number.isFinite(s.cash as any) ? (s.cash as number) : 0; // assume 0 if unknown
  const locked = Number.isFinite(s.locked as any) ? (s.locked as number) : 0;
  if (!hasCrypto && hasBegin && hasPl) {
    const crypto = (s.beginningPortfolioValue as number) + (s.totalPL as number) - cash - locked;
    return { ...s, cryptoMkt: Math.max(0, Number.isFinite(crypto) ? Number(crypto) : 0) };
  }
  return s;
};

  // ------------ API polls ------------
  const refreshStatus = async () => {
    try { const s = await apiGet(`/bots/${botId}/status`); setStatus(normalizeStatus(s)); } catch {}
  };

  const refreshSummary = async () => {
    const tryGet = async (u: string) => { try { return await apiGet(u); } catch { return undefined; } };
    const urls = summaryPath.current ? [summaryPath.current] :
      [`/bots/${botId}/summary`, `/bots/${botId}/portfolio`, `/bots/${botId}/stats`, `/bots/${botId}/metrics`];
    for (const u of urls) {
      const r = await tryGet(u);
      if (r != null) {
        summaryPath.current = u;
        const norm = normalizeSummary(r);
        // remember initial locked (for monotonic accumulation)
        if (baseLockedRef.current === 0 && Number.isFinite(norm.locked)) baseLockedRef.current = Number(norm.locked);
        setSummary(ensureCryptoFallback(norm));
        return;
      }
    }
  };

  // ------------ log parsing ------------
  const toNum = (s: string) => {
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };

  const parseIncremental = (inc: string[]) => {
    const L = inc.map(stripAnsi);

    // “startup summary” gate for BPV
    if (!bpvReady && (L.some(l => /STARTUP SUMMARY/i.test(l)) || L.some(l => /Beginning Portfolio Value:\s*\$/i.test(l)))) {
      setBpvReady(true);
    }

    // “trading enabled” gate for buys/sells stabilization
    if (!tradeReady && L.some(l => /Initial cycle complete — trading now enabled/i.test(l))) {
      setTradeReady(true);
    }

    // accumulate locked deltas (never decrease)
    let lockedAdd = 0;
    for (const l of L) {
      // per-trade lock delta on SELL executed
      const m1 = l.match(/SELL executed:.*?Locked:\s*\$([-\d.,]+)/i);
      if (m1) lockedAdd += toNum(m1[1]) ?? 0;

      // daily/threshold profit lock line
      const m2 = l.match(/PROFIT LOCKED:\s*\$([-\d.,]+)\s*moved to locked cash/i);
      if (m2) lockedAdd += toNum(m2[1]) ?? 0;
    }
    if (lockedAdd > 0) {
      lockedDeltaRef.current += lockedAdd;
      setSummary(prev => {
        const base = prev?.locked ?? baseLockedRef.current;
        const nextLocked = (Number(base) || 0) + lockedDeltaRef.current;
        const next = { ...(prev || {}), locked: nextLocked };
        return ensureCryptoFallback(next);
      });
    }

    // cash (rare in your latest logs, but keep support)
    for (let i = L.length - 1; i >= 0; i--) {
      const lc = L[i];
      const mc = lc.match(/Cash:\s*\$([-\d.,]+)/i);
      if (mc) {
        const cash = toNum(mc[1]);
        if (cash != null) {
          setSummary(prev => ensureCryptoFallback({ ...(prev || {}), cash }));
        }
        break;
      }
    }

    // crypto market value (multiple variants)
    const cryptoRegexes = [
      /Crypto\s*\(mkt\)\s*:\s*\$([-\d.,]+)/i,
      /Crypto\s*:\s*\$([-\d.,]+)/i,
      /Market\s*Value\s*:\s*\$([-\d.,]+)/i,
      /Equity\s*:\s*\$([-\d.,]+)/i,
      /Holdings\s*:\s*\$([-\d.,]+)/i,
    ];
    outer: for (let i = L.length - 1; i >= 0; i--) {
      for (const rx of cryptoRegexes) {
        const mm = L[i].match(rx);
        if (mm) {
          const crypto = toNum(mm[1]);
          if (crypto != null) {
            setSummary(prev => ({ ...(prev || {}), cryptoMkt: crypto }));
          }
          break outer;
        }
      }
    }

    // total P/L (latest)
    for (let i = L.length - 1; i >= 0; i--) {
      const mp = L[i].match(/(?:^|\s)P\/L\s*\$([-\d.,]+)/i) || L[i].match(/Total\s*P\/L\s*:\s*\$([-\d.,]+)/i);
      if (mp) {
        const totalPL = toNum(mp[1]);
        if (totalPL != null) setSummary(prev => ensureCryptoFallback({ ...(prev || {}), totalPL }));
        break;
      }
    }
  };

  const pollLogs = async () => {
    const tryGet = async (u: string) => { try { return await apiGet<any>(u); } catch { return undefined; } };
    const urls = logPath.current ? [logPath.current] : [`/bots/${botId}/logs`, `/bots/${botId}/log`, `/bots/${botId}/stdout`];

    for (const u of urls) {
      const res = await tryGet(u);
      if (res == null) continue;

      logPath.current = u;
      let next: string[] = [];
      if (typeof res === 'string') next = res.split(/\r?\n/).filter(Boolean);
      else if (Array.isArray(res?.lines)) next = res.lines.filter(Boolean);
      else if (typeof res?.text === 'string') next = res.text.split(/\r?\n/).filter(Boolean);

      if (!next.length) return;

      // incremental section
      const inc = next.slice(lastLen.current);
      lastLen.current = next.length;

      setLines(next);
      if (!follow && inc.length > 0) setUnread((u) => u + inc.length);

      parseIncremental(inc);
      return;
    }
  };

  // ------------ lifecycle ------------
  useFocusEffect(useCallback(() => { refreshStatus(); refreshSummary(); pollLogs(); }, []));
  useEffect(() => {
    const iv1 = setInterval(refreshStatus, 1200);
    const iv2 = setInterval(pollLogs, 800);
    const iv3 = setInterval(refreshSummary, 5000);
    return () => { clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); };
  }, []);

  // ------------ actions ------------
  const start = async () => {
    setBusy(true);
    try {
      await apiPost(`/bots/${botId}/start`);
      setStatus('starting');
      setFollow(true);
      setUnread(0);
      await refreshStatus();
    } finally { setBusy(false); }
  };

  const ensureStopped = async (ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = await apiGet(`/bots/${botId}/status`).catch(() => null);
      if (s && normalizeStatus(s) === 'stopped') return true;
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  };

  const stop = async () => {
    setBusy(true);
    try {
      await apiPost(`/bots/${botId}/stop`);
      setStatus('stopping');
      const ok = await ensureStopped();
      if (!ok) Alert.alert('Note', 'Stop request sent; waiting for the process to exit.');
      await refreshStatus();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (status === 'running' || status === 'starting') return Alert.alert('Stop the bot before deleting.');
    setBusy(true);
    try {
      await apiDelete(`/bots/${botId}`);
      Alert.alert('Deleted');
      navigation.navigate('Home');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Delete failed');
    } finally { setBusy(false); }
  };

  const isRunning = status === 'running' || status === 'starting';

  // hide buys/sells until “trading now enabled”
  const displaySummary: Summary | undefined = summary
    ? { ...summary, buys: tradeReady ? summary.buys : 0, sells: tradeReady ? summary.sells : 0 }
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={styles.card}>
        <Text style={styles.title}>{botName || botId}</Text>
        <Text style={styles.meta}>Status: {status}</Text>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Pill label="Start" disabled={busy || isRunning} onPress={start} kind="primary" />
          <Pill label="Stop"  disabled={busy || !isRunning} onPress={stop}  kind="danger" />
          <Pill label={follow ? 'Freeze' : 'Unfreeze'} onPress={() => { setFollow(!follow); if (follow) setUnread(0); }} />
          <Pill label="Jump to latest" onPress={() => { setFollow(true); setUnread(0); }} />
          <Pill label="Delete" disabled={busy || isRunning} onPress={del} />
          {!follow && unread > 0 && <Text style={styles.unread}>+{unread}</Text>}
        </View>

        <SummaryBlock s={displaySummary} showPlaceholder bpvReady={bpvReady} />
      </View>

      <View style={{ paddingHorizontal: 12, marginTop: 12 }}>
        <LogViewer lines={lines.map(stripAnsi)} follow={follow} />
      </View>
    </SafeAreaView>
  );
}

function Pill({ label, onPress, disabled, kind }:{
  label:string; onPress?:()=>void; disabled?:boolean; kind?:'primary'|'danger'
}) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress}
      style={[styles.pill, disabled?styles.pillDisabled:(kind==='danger'?styles.danger:kind==='primary'?styles.primary:styles.ghost)]}>
      <Text style={styles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 16, padding: 14, backgroundColor: '#11161C', margin: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#E6EDF3' },
  meta: { marginTop: 2, color: '#97A3B6' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, marginTop: 6, borderWidth: 1, borderColor: '#2A3340' },
  pillText: { fontWeight: '600', color: '#E6EDF3' },
  pillDisabled: { backgroundColor: '#1D2631', opacity: 0.6 },
  primary: { backgroundColor: '#0E2B5E' },
  danger: { backgroundColor: '#3A1111' },
  ghost: { backgroundColor: '#1A1F28' },
  unread: { color: '#7AA5FF', fontWeight: '700', marginLeft: 6, marginTop: 8 },
});
