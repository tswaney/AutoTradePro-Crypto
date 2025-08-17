// src/screens/BotDetailScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';

// ✅ matches your tree for components
import SummaryBlock, { Summary } from '../components/SummaryBlock';
import LogViewer from '../components/LogViewer';
import HeaderActions from '../components/HeaderActions';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';
async function apiGet<T=any>(p:string){ const r=await fetch(`${BASE_URL}/api${p}`); if(!r.ok) throw new Error(await r.text()); return r.headers.get('content-type')?.includes('json')? r.json(): r.text(); }
async function apiPost<T=any>(p:string, body?:any){ const r=await fetch(`${BASE_URL}/api${p}`,{method:'POST', headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined}); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function apiLogout(){ try{ await fetch(`${BASE_URL}/api/auth/logout`, { method:'POST' }); }catch{} }

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
  const [summary, setSummary] = useState<Summary | undefined>(undefined);
  const [bpvReady, setBpvReady] = useState(false); // hide $150 until STARTUP SUMMARY

  const lastLen = useRef(0);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderActions
          onRefresh={() => { refreshStatus(); refreshSummary(); refreshLogs(); }}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
          }}
        />
      ),
    });
  }, [navigation]);

  const normalizeStatus = (s:any): typeof status => {
    if (typeof s === 'boolean') return s ? 'running' : 'stopped';
    if (typeof s === 'object' && s) {
      const raw = (s.status ?? s.state ?? s.running ?? s.isRunning ?? '').toString().toLowerCase();
      if (typeof s.running === 'boolean') return s.running ? 'running' : 'stopped';
      return raw.includes('running') ? 'running'
        : raw.includes('starting') ? 'starting'
        : raw.includes('stopping') ? 'stopping'
        : raw.includes('stopped') ? 'stopped' : 'unknown';
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
    try {
      const r:any = await apiGet(`/bots/${botId}/summary`);
      setSummary({
        beginningPortfolioValue: r.beginningPortfolioValue,
        duration: r.duration,
        buys: r.buys,
        sells: r.sells,
        totalPL: r.totalPL,
        pl24h: r.pl24h,
        avgDailyPL: r.avgDailyPL,
        cash: r.cash,
        cryptoMkt: r.cryptoMkt,
        locked: r.locked,
      });
      setBpvReady(String(r.bpvSource||'initial') === 'log');
    } catch {}
  };

  const refreshLogs = async () => {
    try {
      const res:any = await apiGet(`/bots/${botId}/logs`);
      const next = Array.isArray(res?.lines) ? res.lines : String(res||'').split(/\r?\n/).filter(Boolean);
      setLines(prev => {
        const merged = next.length ? next : prev;
        if (!follow && merged.length > lastLen.current) setUnread(v => v + (merged.length - lastLen.current));
        lastLen.current = merged.length;
        return merged;
      });
    } catch {}
  };

  useFocusEffect(useCallback(() => { refreshStatus(); refreshSummary(); refreshLogs(); }, []));

  useEffect(() => {
    const iv1 = setInterval(refreshStatus, 1500);
    const iv2 = setInterval(refreshLogs, 1000);
    const iv3 = setInterval(refreshSummary, 4000);
    return () => { clearInterval(iv1); clearInterval(iv2); clearInterval(iv3); };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      await apiPost(`/bots/${botId}/start`);
      setStatus('starting');
      await refreshStatus();
      setFollow(true);
      setUnread(0);
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

        <SummaryBlock s={summary} showPlaceholder={!bpvReady} />
      </View>

      <View style={{ paddingHorizontal: 12, marginTop: 12 }}>
        <LogViewer lines={lines} follow={follow} />
      </View>
    </SafeAreaView>
  );
}

function Pill({ label, onPress, disabled, kind }:{ label:string; onPress?:()=>void; disabled?:boolean; kind?:'primary'|'danger'}) {
  return (
    <TouchableOpacity disabled={!!disabled} onPress={onPress}
      style={[styles.pill, disabled ? styles.pillDisabled : (kind==='danger' ? styles.danger : styles.primary)]}>
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
  pillDisabled: { backgroundColor: '#1D2631' },
  primary: { backgroundColor: '#1F4E99' },
  danger: { backgroundColor: '#7A1C1C' },
  unread: { color: '#E6EDF3', marginLeft: 6, marginTop: 8, fontWeight: '700' },
});
