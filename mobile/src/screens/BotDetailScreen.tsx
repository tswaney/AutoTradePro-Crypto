// /mobile/src/screens/BotDetailScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SummaryBlock, { Summary } from '../components/SummaryBlock';
import LogViewer from '../components/LogViewer';
import { apiGet } from '../../api';

type Props = { route: any; navigation: any };

export default function BotDetailScreen({ route, navigation }: Props) {
  const botId: string = route.params?.botId;
  const botName: string = route.params?.botName || botId;

  const [status, setStatus] = useState<string>('unknown');
  const [summary, setSummary] = useState<Summary | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [unread, setUnread] = useState(0);

  const lastLen = useRef(0);
  const logPath = useRef<string | undefined>(undefined);
  const summaryPath = useRef<string | undefined>(undefined);
  const polling = useRef({ logs: false, summary: false, status: false });

  useEffect(() => { navigation.setOptions({ title: botName }); }, [navigation, botName]);

  const normalizeStatus = (s:any) => {
    if (!s) return 'unknown';
    if (typeof s === 'string') return s;
    return s.status || s.state || 'unknown';
  };

  const refreshStatus = async () => {
    polling.current.status = true;
    try {
      const s = await apiGet(`/bots/${botId}/status`);
      setStatus(normalizeStatus(s));
      return;
    } catch (e) {}
    try {
      const list: any = await apiGet('/bots');
      const me = Array.isArray(list) ? list.find((b:any) => (b.id===botId || b.name===botId)) : null;
      if (me) { setStatus(normalizeStatus(me)); return; }
    } catch(e) {}
    setStatus('unknown');
  };

  const refreshSummary = async () => {
    if (polling.current.summary) return;
    polling.current.summary = true;
    const tryGet = async (u:string) => { try { return await apiGet(u); } catch { return undefined; } };
    const urls = summaryPath.current ? [summaryPath.current] : [
      `/bots/${botId}/summary`, `/api/bots/${botId}/summary`,
      `/bots/${botId}/portfolio`, `/api/bots/${botId}/portfolio`,
      `/bots/${botId}/stats`, `/api/bots/${botId}/stats`
    ];
    for (const u of urls) {
      const r:any = await tryGet(u);
      if (r) {
        summaryPath.current = u;
        setSummary({
          beginningPortfolioValue: r.beginningPortfolioValue ?? r.begin ?? r.startValue ?? r.startingBalance,
          duration: r.duration ?? r.uptime ?? r.elapsed,
          buys: r.buys ?? r.buyCount,
          sells: r.sells ?? r.sellCount,
          totalPL: r.totalPL ?? r.pnl ?? r.pl ?? r.totalPnL,
          cash: r.cash ?? r.balance,
          cryptoMkt: r.cryptoMkt ?? r.crypto ?? r.marketValue,
          locked: r.locked ?? r.margin ?? r.held,
          pl24h: r.pl24h ?? r['24h'] ?? r.last24h ?? r.pnl24h ?? r.pl24hTotal,
        });
        polling.current.summary = false;
        return;
      }
    }
    polling.current.summary = false;
  };

  const pollLogs = async () => {
    if (polling.current.logs) return;
    polling.current.logs = true;
    const tryGet = async (u:string) => { try { return await apiGet(u); } catch { return undefined; } };
    const urls = logPath.current ? [logPath.current] : [
      `/bots/${botId}/logs`, `/api/bots/${botId}/logs`,
      `/bots/${botId}/log`, `/api/bots/${botId}/log`,
      `/bots/${botId}/stdout`, `/api/bots/${botId}/stdout`
    ];
    for (const u of urls) {
      const res:any = await tryGet(u);
      if (res != null) {
        logPath.current = u;
        const text = typeof res === 'string'
          ? res
          : (Array.isArray(res?.lines) ? res.lines.join('\n') : (res?.text || ''));
        const next = (text || '').split(/\r?\n/).filter(Boolean);
        setLines(prev => {
          const merged = next.length ? next : prev;
          if (!follow && merged.length > lastLen.current) setUnread(v => v + (merged.length - lastLen.current));
          lastLen.current = merged.length;
          return merged;
        });
        polling.current.logs = false;
        return;
      }
    }
    polling.current.logs = false;
  };

  const tick = useCallback(() => {
    refreshStatus();
    refreshSummary();
    pollLogs();
  }, []);

  useEffect(() => {
    setLoading(true);
    const t = setInterval(tick, 1200);
    tick();
    setLoading(false);
    return () => clearInterval(t);
  }, [botId]);

  const jumpToLatest = () => { setFollow(true); setUnread(0); };
  const toggleFollow = () => { setFollow(f => !f); if (!follow) setUnread(0); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.header}>
          <Text style={styles.title}>{botName}</Text>
          <View style={[styles.status, status==='running'?styles.good:styles.bad]}>
            <Text style={styles.statusText}>{status.toUpperCase()}</Text>
          </View>
        </View>

        <SummaryBlock summary={summary} />

        <View style={styles.tools}>
          <TouchableOpacity onPress={jumpToLatest} style={styles.btn}><Text style={styles.btnText}>Jump to latest{unread?` (+${unread})`:''}</Text></TouchableOpacity>
          <TouchableOpacity onPress={toggleFollow} style={styles.btn}><Text style={styles.btnText}>{follow?'Freeze':'Unfreeze'}</Text></TouchableOpacity>
        </View>

        <Text style={styles.h2}>Live Log</Text>
        {loading ? <ActivityIndicator/> : <LogViewer lines={lines} follow={follow} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#E6EDF3', fontWeight: '700', fontSize: 20 },
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { color: 'white', fontWeight: '700' },
  good: { backgroundColor: '#0F8C3E' },
  bad: { backgroundColor: '#7A0000' },
  tools: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { backgroundColor: '#0E2B5E', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  btnText: { color: 'white', fontWeight: '700' },
  h2: { color: '#E6EDF3', fontWeight: '700', marginTop: 16, marginBottom: 6, fontSize: 16 }
});
