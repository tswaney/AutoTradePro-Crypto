import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string) || 'http://localhost:4000';

type BotMeta = {
  id: string;
  name: string;
  status: 'running' | 'stopped' | string;
  strategyId?: string;
  symbols?: string[];
  config?: Record<string, any>;
};

type Summary = {
  id: string;
  name: string;
  status: string;
  beginningPortfolioValue: number;
  bpvSource?: string;
  duration: string;
  buys: number;
  sells: number;
  totalPL: number;
  cash: number;
  cryptoMkt: number;
  locked: number;
  currentPortfolioValue: number;
  pl24h: number;
  avgDailyPL: number;
};

export default function BotDetailScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const botId: string | undefined = route?.params?.id;

  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<BotMeta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [freeze, setFreeze] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const log = useCallback((...a: any[]) => console.log('[BotDetail]', new Date().toISOString(), ...a), []);
  const scrollRef = useRef<ScrollView>(null);

  const idSafe = useMemo(() => String(botId || meta?.id || '').trim(), [botId, meta]);

  const fetchJson = useCallback(async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch (e: any) {
      throw new Error(`Failed to parse JSON from ${url}: ${String(e?.message || e)} (len=${text.length})`);
    }
    return { res, json };
  }, []);

  const loadMeta = useCallback(async () => {
    if (!idSafe) return;
    log('GET meta', `${API_BASE}/api/bots/${idSafe}`);
    try {
      const { res, json } = await fetchJson(`${API_BASE}/api/bots/${idSafe}`);
      log('meta status', res.status);
      if (res.ok) setMeta(json as BotMeta);
      else throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      log('meta error', String(e?.message || e));
      setMeta(null);
    }
  }, [idSafe, fetchJson, log]);

  const loadSummary = useCallback(async () => {
    if (!idSafe) return;
    log('GET summary', `${API_BASE}/api/bots/${idSafe}/summary`);
    try {
      const { res, json } = await fetchJson(`${API_BASE}/api/bots/${idSafe}/summary`);
      log('summary status', res.status);
      if (res.ok) setSummary(json as Summary);
      else throw new Error(`HTTP ${res.status}`);
    } catch (e: any) {
      log('summary error', String(e?.message || e));
      setSummary(null);
    }
  }, [idSafe, fetchJson, log]);

  const loadLogs = useCallback(async () => {
    if (!idSafe) return;
    const url = `${API_BASE}/api/bots/${idSafe}/logs?cursor=${cursor}`;
    log('GET logs', url);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch (e: any) {
        log('logs parse error', String(e?.message || e));
        return;
      }
      const lines: string[] = Array.isArray(json?.lines) ? json.lines : [];
      const nextCursor = Number(json?.cursor || 0);
      setCursor(nextCursor);
      if (lines.length) {
        setLogs(prev => [...prev, ...lines]);
        if (!freeze) {
          requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
        }
      }
      log('logs got', lines.length, 'cursor', nextCursor);
    } catch (e: any) {
      log('logs error', String(e?.message || e));
    }
  }, [idSafe, cursor, freeze, log]);

  const refreshAll = useCallback(async () => {
    if (!idSafe) return;
    setLoading(true);
    try {
      await loadMeta();
      await loadSummary();
      await loadLogs();
    } catch (e: any) {
      // everything is already caught; this is just a belt-and-suspenders guard
      log('refreshAll caught', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [idSafe, loadMeta, loadSummary, loadLogs, log]);

  useEffect(() => {
    if (!idSafe) {
      Alert.alert('No bot id', 'This screen requires a bot id.');
      return;
    }
    log('API_BASE =>', JSON.stringify(API_BASE), 'id=', idSafe);
    refreshAll().catch(err => log('initial refresh err', String(err)));
    // Optional: small poll to keep summary live (stop when frozen)
    const t = setInterval(() => { loadSummary().catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [idSafe, refreshAll, loadSummary, log]);

  const doStart = useCallback(async () => {
    if (!idSafe) return;
    try {
      setBusy(true);
      log('POST start', `${API_BASE}/api/bots/${idSafe}/start`);
      const res = await fetch(`${API_BASE}/api/bots/${idSafe}/start`, { method: 'POST' });
      const text = await res.text();
      log('start done', res.status, text.slice(0, 120));
      if (!res.ok) Alert.alert('Start failed', text.slice(0, 800));
      await refreshAll();
    } catch (e: any) {
      log('start error', String(e?.message || e));
      Alert.alert('Start failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [idSafe, refreshAll, log]);

  const doStop = useCallback(async () => {
    if (!idSafe) return;
    try {
      setBusy(true);
      log('POST stop', `${API_BASE}/api/bots/${idSafe}/stop`);
      const res = await fetch(`${API_BASE}/api/bots/${idSafe}/stop`, { method: 'POST' });
      const text = await res.text();
      log('stop done', res.status, text.slice(0, 120));
      if (!res.ok) Alert.alert('Stop failed', text.slice(0, 800));
      await refreshAll();
    } catch (e: any) {
      log('stop error', String(e?.message || e));
      Alert.alert('Stop failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [idSafe, refreshAll, log]);

  const doDelete = useCallback(async () => {
    if (!idSafe) return;
    Alert.alert('Delete Bot', 'This will delete the bot and its data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy(true);
            log('DELETE bot', `${API_BASE}/api/bots/${idSafe}`);
            const res = await fetch(`${API_BASE}/api/bots/${idSafe}`, { method: 'DELETE' });
            const text = await res.text();
            log('delete done', res.status, text.slice(0, 120));
            if (!res.ok) {
              Alert.alert('Delete failed', text.slice(0, 800));
            } else {
              Alert.alert('Deleted', 'Bot deleted.', [{ text: 'OK', onPress: () => nav.goBack() }]);
            }
          } catch (e: any) {
            log('delete error', String(e?.message || e));
            Alert.alert('Delete failed', String(e?.message || e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [idSafe, nav, log]);

  const statusText = meta?.status || summary?.status || 'unknown';
  const bpv = summary?.beginningPortfolioValue ?? null;
  const cur = summary?.currentPortfolioValue ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0f1a' }}>
      {/* Header row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()}><Text style={styles.link}>&lt; Bot List</Text></TouchableOpacity>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={() => refreshAll()}><Text style={styles.link}>Refresh</Text></TouchableOpacity>
          <Text style={{ color: '#334155' }}>{'  '}</Text>
          <TouchableOpacity onPress={() => nav.navigate('SignIn')}><Text style={styles.link}>Sign out</Text></TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        {/* Status + actions */}
        <View style={styles.card}>
          <Text style={styles.statusLine}>Status: <Text style={{ color: '#e5e7eb' }}>{statusText}</Text></Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity disabled={busy} style={styles.btnPrimary} onPress={doStart}><Text style={styles.btnPrimaryText}>Start</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy} style={styles.btn} onPress={doStop}><Text style={styles.btnText}>Stop</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => setFreeze(f => !f)}><Text style={styles.btnText}>{freeze ? 'Unfreeze' : 'Freeze'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}><Text style={styles.btnText}>Jump to latest</Text></TouchableOpacity>
          </View>
          <TouchableOpacity disabled={busy} style={styles.btnDanger} onPress={doDelete}><Text style={styles.btnDangerText}>Delete</Text></TouchableOpacity>
        </View>

        {/* Portfolio Summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Total Portfolio Summary</Text>
          {loading && <ActivityIndicator style={{ marginTop: 8 }} />}
          <View style={styles.row}><Text style={styles.key}>Beginning Portfolio Value</Text><Text style={styles.val}>{bpv == null ? '—' : `$${bpv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Duration</Text><Text style={styles.val}>{summary?.duration ?? '—'}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Buys</Text><Text style={styles.val}>{summary?.buys ?? 0}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Sells</Text><Text style={styles.val}>{summary?.sells ?? 0}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Total P/L</Text><Text style={styles.val}>{summary?.totalPL == null ? '—' : `$${summary.totalPL.toFixed(2)}`}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Cash</Text><Text style={styles.val}>{summary?.cash == null ? '—' : `$${summary.cash.toFixed(2)}`}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Crypto (mkt)</Text><Text style={styles.val}>{summary?.cryptoMkt == null ? '—' : `$${summary.cryptoMkt.toFixed(2)}`}</Text></View>
          <View style={styles.row}><Text style={styles.key}>Locked</Text><Text style={styles.val}>{summary?.locked == null ? '—' : `$${summary.locked.toFixed(2)}`}</Text></View>
          <View style={styles.row}><Text style={[styles.key, { fontWeight: '700' }]}>Current Portfolio Value</Text><Text style={[styles.val, { fontWeight: '800' }]}>{cur == null ? '$0.00' : `$${cur.toFixed(2)}`}</Text></View>
        </View>

        {/* Logs */}
        <View style={[styles.card, { minHeight: 160 }]}>
          <Text style={styles.cardTitle}>Logs</Text>
          <ScrollView ref={scrollRef} style={{ marginTop: 8, maxHeight: 220 }}>
            {logs.length === 0 ? (
              <Text style={{ color: '#64748b' }}>No logs yet.</Text>
            ) : (
              logs.map((ln, idx) => (
                <Text key={idx} style={{ color: '#9aa4b2', fontSize: 12, marginBottom: 2 }}>{ln}</Text>
              ))
            )}
          </ScrollView>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity style={styles.btn} onPress={() => loadLogs().catch(() => {})}><Text style={styles.btnText}>Load more</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}><Text style={styles.btnText}>Jump to latest</Text></TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: '#60a5fa', fontWeight: '600' },

  card: { borderRadius: 14, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0b1220', padding: 12, marginBottom: 12 },
  cardTitle: { color: '#e5e7eb', fontWeight: '700', marginBottom: 8 },
  statusLine: { color: '#9aa4b2' },

  btn: { backgroundColor: '#111827', borderColor: '#1f2937', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginRight: 8 },
  btnText: { color: '#e5e7eb', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#1f6feb', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  btnPrimaryText: { color: 'white', fontWeight: '700' },
  btnDanger: { backgroundColor: '#3f1d1d', borderColor: '#7f1d1d', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginTop: 8, alignSelf: 'flex-start' },
  btnDangerText: { color: '#fecaca', fontWeight: '700' },

  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  key: { color: '#9aa4b2' },
  val: { color: '#e5e7eb' },
});
