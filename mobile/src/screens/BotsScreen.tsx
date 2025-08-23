import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

type BotRow = {
  id: string;
  name: string;
  status: 'running' | 'stopped' | string;
  strategyId?: string;
  symbols?: string[] | string;
  createdAt?: string | null;
};

const API_BASE =
  (global as any).API_BASE ||
  (process as any)?.env?.API_BASE ||
  'http://localhost:4000/api';

export default function BotsScreen() {
  const navigation = useNavigation();
  const [rows, setRows] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/bots`);
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ⤴️ Refresh every time the screen becomes active (solves Issue #2b)
  useFocusEffect(React.useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={styles.h1}>Bots</Text>
      {loading ? (
        <View style={styles.loading}><ActivityIndicator /><Text style={styles.loadingText}>Loading…</Text></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(b) => b.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                // @ts-ignore
                navigation.navigate('BotDetail', { id: item.id });
              }}
              style={styles.card}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.title}>{item.name || item.id}</Text>
                <View style={[styles.statusDot, item.status === 'running' ? styles.dotRun : styles.dotStop]} />
              </View>
              <Text style={styles.meta}>
                {item.strategyId ? `Strategy: ${item.strategyId}` : 'Strategy: —'}
              </Text>
              <Text style={styles.meta}>
                {item.symbols ? `Symbols: ${Array.isArray(item.symbols) ? item.symbols.join(', ') : item.symbols}` : 'Symbols: —'}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: '#e2e8f0', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  loadingText: { color: '#a0aec0' },
  card: { padding: 12, borderRadius: 12, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1f2937' },
  title: { flex: 1, color: '#e2e8f0', fontWeight: '700', fontSize: 16 },
  meta: { color: '#cbd5e1', marginTop: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 10, marginLeft: 8 },
  dotRun: { backgroundColor: '#22c55e' },
  dotStop: { backgroundColor: '#ef4444' },
});
