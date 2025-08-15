// /mobile/src/screens/BotDetailScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LogViewer from '../components/LogViewer';
import SummaryBlock, { Summary } from '../components/SummaryBlock';
import HeaderActions from '../components/HeaderActions';
import { apiGet, apiPost, logout as apiLogout } from '../../api';
import * as SecureStore from 'expo-secure-store';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

type Props = { route: { params: { botId: string; botName?: string } } };
const SIGNED_KEY = 'autotradepro.signedIn';

export default function BotDetailScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const { botId, botName } = route.params;
  const [status, setStatus] = useState<'running'|'stopped'|'starting'|'stopping'|'unknown'>('unknown');
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(true);
  const [unread, setUnread] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary|undefined>(undefined);
  const lastLen = useRef(0);

  // cache picked endpoints (first one that works)
  const logPath = useRef<string | null>(null);
  const summaryPath = useRef<string | null>(null);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderActions
          onRefresh={() => { refreshStatus(); refreshSummary(); pollLogs(); }}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
          }}
        />
      )
    });
  }, [navigation]);

  const normalizeStatus = (s:any): typeof status => {
    if (typeof s === 'boolean') return s ? 'running' : 'stopped';
    if (typeof s === 'object' && s) {
      const raw = (s.status ?? s.state ?? s.running ?? s.isRunning ?? '').toString().toLowerCase();
      if (typeof s.running === 'boolean') return s.running ? 'running' : 'stopped';
      return raw.includes('running') ? 'running' :
             raw.includes('starting') ? 'starting' :
             raw.includes('stopping') ? 'stopping' :
             raw.includes('stopped') ? 'stopped' : 'unknown';
    }
    const str = String(s || '').toLowerCase();
    if (str.includes('running') || str === 'started' || str === 'active') return 'running';
    if (str.includes('starting')) return 'starting';
    if (str.includes('stopping')) return 'stopping';
    if (str.includes('stopped') || str === 'idle') return 'stopped';
    return 'unknown';
  };

  const refreshStatus = async () => {
    try {
      const s = await apiGet(`/bots/${botId}/status`);
      setStatus(normalizeStatus(s));
    } catch {}
  };

  const refreshSummary = async () => {
    const tryGet = async (u:string) => { try { return await apiGet(u); } catch { return undefined; } };
    const urls = summaryPath.current ? [summaryPath.current] : [`/bots/${botId}/summary`, `/bots/${botId}/portfolio`, `/bots/${botId}/stats`];
    for (const u of urls) {
      const raw = await tryGet(u);
      if (raw) {
        summaryPath.current = u;
        const r:any = raw;
        setSummary({
          beginningPortfolioValue: r.beginningPortfolioValue ?? r.begin ?? r.startValue ?? r.startingBalance,
          duration: r.duration ?? r.uptime ?? r.elapsed,
          buys: r.buys ?? r.buyCount,
          sells: r.sells ?? r.sellCount,
          totalPL: r.totalPL ?? r.pnl ?? r.pl ?? r.totalPnL,
          cash: r.cash ?? r.balance,
          cryptoMkt: r.cryptoMkt ?? r.crypto ?? r.marketValue,
          locked: r.locked ?? r.margin ?? r.held,
        });
        return;
      }
    }
  };

  const pollLogs = async () => {
    const tryGet = async (u:string) => { try { return await apiGet<string | { text?: string }>(u); } catch { return undefined; } };
    const urls = logPath.current ? [logPath.current] : [`/bots/${botId}/logs`, `/bots/${botId}/log`, `/bots/${botId}/stdout`];
    for (const u of urls) {
      const res = await tryGet(u);
      if (res != null) {
        logPath.current = u;
        const txt = typeof res === 'string' ? res : (res?.text || '');
        const next = (txt || '').split(/\r?\n/).filter(Boolean);
        setLines(prev => {
          const merged = next.length ? next : prev;
          if (!follow && merged.length > lastLen.current) setUnread(v => v + (merged.length - lastLen.current));
          lastLen.current = merged.length;
          return merged;
        });
        return;
      }
    }
  };

  useFocusEffect(useCallback(() => {
    refreshStatus(); refreshSummary(); pollLogs();
  }, []));

  useEffect(() => {
    const iv1 = setInterval(refreshStatus, 1500);
    const iv2 = setInterval(pollLogs, 1000);
    const iv3 = setInterval(refreshSummary, 5000);
    return () => { clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      await apiPost(`/bots/${botId}/start`);
      setStatus('starting');
      await refreshStatus();
      setFollow(true);
      await pollLogs();
    } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await apiPost(`/bots/${botId}/stop`);
      setStatus('stopping');
      await refreshStatus();
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={styles.card}>
        <Text style={styles.title}>{botName || botId}</Text>
        <Text style={styles.meta}>Status: {status}</Text>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Pill label="Start" disabled={busy || status==='running' || status==='starting'} onPress={start} kind="primary" />
          <Pill label="Stop" disabled={busy || (status!=='running' && status!=='starting')} onPress={stop} kind="danger" />
          <Pill label={follow ? 'Freeze' : 'Unfreeze'} onPress={() => { setFollow(!follow); if (follow) setUnread(0); }} />
          <Pill label="Jump to latest" onPress={() => { setFollow(true); setUnread(0); }} />
          {!follow && unread>0 && <Text style={styles.unread}>+{unread}</Text>}
        </View>
        {/* Summary visible even if empty */}
        <SummaryBlock s={summary} showPlaceholder />
      </View>
      <View style={{ paddingHorizontal: 12, marginTop: 12 }}>
        <LogViewer lines={lines} follow={follow} />
      </View>
    </SafeAreaView>
  );
}

function Pill({ label, onPress, disabled, kind }:{ label:string; onPress?:()=>void; disabled?:boolean; kind?:'primary'|'danger'}) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.pill, disabled?styles.pillDisabled:(kind==='danger'?styles.danger:kind==='primary'?styles.primary:styles.ghost)]}>
      <Text style={styles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 16, padding: 14, backgroundColor: '#11161C', margin: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#E6EDF3' },
  meta: { marginTop: 2, color: '#97A3B6' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginTop: 6, borderWidth: 1, borderColor: '#2A3340' },
  pillText: { fontWeight: '600', color: '#E6EDF3' },
  pillDisabled: { backgroundColor: '#1D2631', opacity: 0.6 },
  primary: { backgroundColor: '#0E2B5E' },
  danger: { backgroundColor: '#3A1111' },
  ghost: { backgroundColor: '#1A1F28' },
  unread: { color: '#7AA5FF', fontWeight: '700', marginLeft: 6, marginTop: 8 }
});
