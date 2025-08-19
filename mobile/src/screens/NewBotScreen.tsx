import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

// If you have a central util, swap this for that import.
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string) || 'http://localhost:4000';

type Strategy = {
  id: string;
  name: string;
  version: string;
  description?: string;
};

export default function NewBotScreen() {
  const nav = useNavigation<any>();
  const [name] = useState<string>(`bot-${Math.random().toString(36).slice(2, 6)}`);
  const [symbols] = useState<string>('BTCUSD, SOLUSD');

  const [loading, setLoading] = useState(false);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const log = useCallback((...a: any[]) => console.log('[NewBot]', new Date().toISOString(), ...a), []);

  const load = useCallback(async () => {
    setLoading(true);
    setStrategies([]);
    setSelectedId(null);
    try {
      const url = `${API_BASE}/api/strategies`;
      log('GET strategies', JSON.stringify(url));
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      log('strategies status', res.status, 'textLen', text.length);
      let json: any = null;
      try { json = JSON.parse(text); } catch (e: any) { log('parse error', String(e?.message || e)); }
      if (Array.isArray(json)) {
        const list: Strategy[] = json.map((s: any) => ({
          id: String(s?.id ?? ''),
          name: String(s?.name ?? ''),
          version: String(s?.version ?? ''),
          description: typeof s?.description === 'string' ? s.description : '',
        })).filter(s => s.id && s.name);
        setStrategies(list);
        if (list.length) setSelectedId(list[0].id);
        log('parsed count', list.length, list.slice(0, 5).map(s => s.id));
      } else {
        setStrategies([]);
      }
    } catch (e: any) {
      log('load error', String(e?.message || e));
      setStrategies([]);
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    log('API BASE =>', JSON.stringify(API_BASE));
    load();
  }, [load, log]);

  const onContinue = useCallback(() => {
    if (!selectedId) {
      Alert.alert('Select a strategy', 'Please choose a strategy to continue.');
      return;
    }
    const draft = {
      name,
      // pass array so config screen doesn’t have to split again
      symbols: String(symbols).split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
      // pass BOTH keys for backward-compat
      strategyId: selectedId,
      strategy: selectedId,
    };
    log('Continue pressed with draft', JSON.stringify(draft));
    nav.navigate('NewBotConfig', { draft });
  }, [name, symbols, selectedId, nav, log]);

  const StrategyCard = ({ s }: { s: Strategy }) => {
    const selected = s.id === selectedId;
    return (
      <TouchableOpacity
        onPress={() => setSelectedId(s.id)}
        style={[
          styles.card,
          { borderColor: selected ? '#3b82f6' : '#1f2937', backgroundColor: selected ? '#121826' : '#0b1220' },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {s.name} <Text style={styles.cardVersion}>v{s.version}</Text>
          </Text>
          {/* simple green checkmark when selected */}
          {selected ? <Text style={styles.check}>✓</Text> : null}
        </View>
        {!!s.description && <Text style={styles.cardDesc}>{s.description}</Text>}
        <Text style={styles.cardId}>{s.id}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0f1a' }} contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <Text style={styles.h1}>New Bot</Text>

      <Text style={styles.label}>Name</Text>
      <View style={styles.inputLike}><Text style={styles.inputText}>{name}</Text></View>

      <Text style={styles.label}>Symbols (comma-separated)</Text>
      <View style={styles.inputLike}><Text style={styles.inputText}>{symbols}</Text></View>

      <Text style={styles.label}>Strategy</Text>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading strategies…</Text>
        </View>
      ) : strategies.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No strategies found.</Text>
          <Text style={styles.emptyText}>Check control-plane and STRATEGIES_DIR, then reload.</Text>
          <TouchableOpacity onPress={load} style={styles.reloadBtn}><Text style={{ color: 'white', fontWeight: '600' }}>Reload</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0b1220', padding: 8 }}>
          {strategies.map(s => <StrategyCard key={s.id} s={s} />)}
        </View>
      )}

      <TouchableOpacity
        onPress={onContinue}
        disabled={!selectedId || loading}
        style={[styles.primaryBtn, (!selectedId || loading) && { opacity: 0.6 }]}
      >
        <Text style={{ color: 'white', fontWeight: '700' }}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: '#e5e7eb', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  label: { color: '#9aa4b2', marginBottom: 6, marginTop: 8 },
  inputLike: { borderRadius: 12, borderWidth: 1, borderColor: '#243447', backgroundColor: '#0d1117', paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  inputText: { color: '#cbd5e1' },

  loadingBox: { borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0d1117', alignItems: 'center' },
  loadingText: { color: '#9aa4b2', marginTop: 8 },

  emptyBox: { borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0d1117', alignItems: 'center' },
  emptyTitle: { color: '#cbd5e1', fontWeight: '600', marginBottom: 6 },
  emptyText: { color: '#94a3b8', textAlign: 'center', marginBottom: 12 },
  reloadBtn: { backgroundColor: '#1f6feb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },

  card: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginVertical: 6, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#e5e7eb', fontWeight: '700' },
  cardVersion: { color: '#9ca3af', fontWeight: '500' },
  cardDesc: { color: '#94a3b8', marginTop: 4 },
  cardId: { color: '#64748b', marginTop: 4, fontSize: 12 },
  check: { color: '#22c55e', fontWeight: '900', fontSize: 18 },
  primaryBtn: { marginTop: 16, backgroundColor: '#1f6feb', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
