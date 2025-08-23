// mobile/src/screens/BotDetailScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';

// If your app exports an axios instance at this path, we'll use it;
// otherwise we fall back to fetch with a sensible API base.
import client from '../api/client';
import LogViewer from '../components/LogViewer';

type RootStackParamList = {
  BotDetail: { botId?: string; id?: string; bot?: { id?: string } };
};

type BotSummary = {
  id: string;
  name?: string;
  status: 'running' | 'stopped' | string;
  strategyId?: string;
  strategyName?: string;
  summary?: {
    beginningPortfolioValue?: number;
    duration?: string | number;
    buys?: number;
    sells?: number;
    totalPL?: number;
    cash?: number;
    cryptoMkt?: number;
    locked?: number;
    currentValue?: number;
    dayPL?: number;
  };
};

type ApiError = { message?: string };

// ---------- helpers ----------
const sanitizeId = (v?: string) => (v ? v.replace(/^\/+/, '').replace(/\/+$/, '') : undefined);

const guessApiBase = () =>
  (global as any).API_BASE ||
  (process as any)?.env?.API_BASE ||
  'http://localhost:4000/api';

const joinPath = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/');

async function apiGet<T = any>(path: string, params?: Record<string, any>): Promise<T> {
  if (client && typeof (client as any).get === 'function') {
    const res = await (client as any).get(path, params ? { params } : undefined);
    return res.data as T;
  }
  const base = guessApiBase();
  const url = new URL(path.startsWith('http') ? path : joinPath(base, path));
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
  return (await r.json()) as T;
}

async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  if (client && typeof (client as any).post === 'function') {
    const res = await (client as any).post(path, body);
    return res.data as T;
  }
  const base = guessApiBase();
  const url = path.startsWith('http') ? path : joinPath(base, path);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`POST ${url} failed: ${r.status}`);
  const contentType = r.headers.get('content-type') || '';
  return contentType.includes('application/json') ? r.json() : ({} as any);
}

// ---------- ui utils ----------
const fmtMoney = (n?: number) =>
  typeof n === 'number' && isFinite(n) ? `$${n.toFixed(2)}` : '—';
const toneFromNumber = (n?: number) =>
  typeof n === 'number' ? (n >= 0 ? 'positive' : 'negative') : undefined;

export default function BotDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'BotDetail'>>();

  // accept multiple param shapes
  const rawParams = (route.params ?? {}) as any;
  const rawId: string | undefined = rawParams.botId ?? rawParams.id ?? rawParams.bot?.id;
  const botId = sanitizeId(rawId);

  const [data, setData] = useState<BotSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [lines, setLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(true);

  const isRunning = useMemo(
    () => (data?.status ?? '').toLowerCase() === 'running',
    [data?.status]
  );

  useEffect(() => {
    navigation.setOptions({ title: data?.name || botId || 'Bot' });
  }, [navigation, data?.name, botId]);

  // ----- data fetch -----
  const fetchSummary = useCallback(async () => {
    if (!botId) return;
    try {
      if (!refreshing) setLoading(true);
      const res = await apiGet<BotSummary>(joinPath('/bots', botId, 'summary'));
      setData(res);
    } catch (e: any) {
      const msg = (e?.response?.data as ApiError)?.message || e?.message || 'Failed to load summary';
      Alert.alert('Load Failed', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [botId, refreshing]);

  const fetchLogs = useCallback(async (limit = 1000) => {
    if (!botId) return;
    try {
      setLogsLoading(true);
      const res = await apiGet<{ lines?: string[] }>(joinPath('/bots', botId, 'logs'), { limit });
      setLines(Array.isArray(res?.lines) ? res.lines : []);
    } catch {
      setLines([]);
    } finally {
      setLogsLoading(false);
    }
  }, [botId]);

  useFocusEffect(
    useCallback(() => {
      fetchSummary();
      fetchLogs();

      let cancelled = false;
      let timer: NodeJS.Timeout | undefined;
      const loop = () => {
        const ms = isRunning ? 2000 : 6000;
        timer = setTimeout(() => {
          if (cancelled) return;
          fetchSummary();
          fetchLogs();
          loop();
        }, ms);
      };
      loop();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [fetchSummary, fetchLogs, isRunning])
  );

  const onRefresh = useCallback(() => setRefreshing(true), []);
  useEffect(() => {
    if (refreshing) Promise.all([fetchSummary(), fetchLogs()]);
  }, [refreshing, fetchSummary, fetchLogs]);

  // ----- actions -----
  const callAction = useCallback(async (action: 'start' | 'stop' | 'delete') => {
    if (!botId) {
      Alert.alert('Missing Bot Id', 'No bot id was provided to this screen.');
      return;
    }
    try {
      setSubmitting(true);

      if (action === 'delete') {
        const confirm = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Delete Bot',
            'Are you sure you want to delete this bot?',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true }
          );
        });
        if (!confirm) return;
      }

      await apiPost(joinPath('/bots', botId, action));
      // After delete, navigate back to list
      if (action === 'delete') {
        Alert.alert('Bot deleted', `Removed ${botId}`);
        // @ts-expect-error - navigation type varies by app setup
        navigation.goBack?.();
        return;
      }
      await Promise.all([fetchSummary(), fetchLogs()]);
    } catch (e: any) {
      const msg = (e?.response?.data as ApiError)?.message || e?.message || 'Operation failed';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [botId, fetchSummary, fetchLogs, navigation]);

  const onStart = useCallback(() => callAction('start'), [callAction]);
  const onStop = useCallback(() => callAction('stop'), [callAction]);
  const onDelete = useCallback(() => callAction('delete'), [callAction]);

  const s = data?.summary ?? {};
  const strategyLabel = data?.strategyName || data?.strategyId || 'Unknown';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <Pill label={strategyLabel} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total Portfolio Summary</Text>
        <KV label="Beginning Portfolio Value" value={fmtMoney(s.beginningPortfolioValue)} />
        <KV label="Duration" value={String(s.duration ?? '—')} />
        <KV label="Buys" value={String(s.buys ?? 0)} />
        <KV label="Sells" value={String(s.sells ?? 0)} />
        <KV label="Total P/L" value={fmtMoney(s.totalPL)} tone={toneFromNumber(s.totalPL)} />
        <KV label="Cash" value={fmtMoney(s.cash)} />
        <KV label="Crypto (mkt)" value={fmtMoney(s.cryptoMkt)} />
        <KV label="Locked" value={fmtMoney(s.locked)} />
        <KV label="Current Portfolio Value" value={fmtMoney(s.currentValue)} />
      </View>

      <View style={styles.btnRow}>
        <Pressable
          style={[styles.btn, styles.primary, (submitting || isRunning) && styles.btnDisabled]}
          onPress={onStart}
          disabled={submitting || isRunning}
        >
          <Text style={styles.btnText}>Start</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, (submitting || !isRunning) && styles.btnDisabled]}
          onPress={onStop}
          disabled={submitting || !isRunning}
        >
          <Text style={styles.btnText}>Stop</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.danger, (submitting || isRunning) && styles.btnDisabled]}
          onPress={onDelete}
          disabled={submitting || isRunning}
        >
          <Text style={styles.btnText}>Delete</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator />
          <Text style={styles.loaderText}>Loading summary…</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Logs</Text>
        <View style={styles.logCard}>
          <LogViewer
            lines={Array.isArray(lines) ? lines : []}
            follow
            emptyText={logsLoading ? 'Loading logs…' : 'No log output yet…'}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function Pill({ label, muted = false }: { label: string; muted?: boolean }) {
  const textColor = muted ? '#718096' : '#1a202c';
  const bg = muted ? '#f7fafc' : '#e2e8f0';
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.pillDot, { backgroundColor: muted ? '#a0aec0' : '#2d3748' }]} />
      <Text style={[styles.pillText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  const toneStyle =
    tone === 'positive' ? { color: '#22c55e' } : tone === 'negative' ? { color: '#ef4444' } : null;
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, toneStyle as any]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillDot: { width: 8, height: 8, borderRadius: 999, marginRight: 6 },
  pillText: { fontWeight: '700' },

  card: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 16, marginBottom: 8 },

  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  kvLabel: { color: '#cbd5e1' },
  kvValue: { color: '#f8fafc', fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: 12 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2d3748',
  },
  primary: { backgroundColor: '#2563eb' },
  danger: { backgroundColor: '#dc2626' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700' },

  loaderWrap: { paddingVertical: 12, alignItems: 'center', gap: 8 },
  loaderText: { color: '#a0aec0' },

  section: { marginTop: 8 },
  sectionTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 16, marginBottom: 8 },

  logCard: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0b1220',
  },
});
