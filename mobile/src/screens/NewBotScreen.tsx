// /mobile/src/screens/NewBotScreen.tsx
import React, { useEffect, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList } from 'react-native';
import { apiGet, apiPost } from '../../api';

type Strategy = { id: string; name: string; version?: string; description?: string };

export default function NewBotScreen({ navigation }: any) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('bot-' + Math.random().toString(36).slice(2,7));
  const [symbols, setSymbols] = useState('BTCUSD, SOLUSD');
  const [strategyId, setStrategyId] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await apiGet('/strategies');
        const arr = Array.isArray(list) ? list : [];
        setStrategies(arr);
        if (arr.length) setStrategyId(arr[0].id);
      } catch (e:any) {
        console.warn('Failed to load strategies', e?.message || e);
      } finally { setLoading(false); }
    })();
  }, []);

  const createBot = async () => {
    if (!name.trim()) return Alert.alert('Name is required');
    if (!strategyId) return Alert.alert('Pick a strategy');
    try {
      const body = { name: name.trim(), strategyId, symbols: symbols.split(',').map(s => s.trim()).filter(Boolean) };
      const res = await apiPost('/bots', body);
      if (res?.id) {
        navigation.replace('BotDetail', { botId: res.id, botName: name.trim() });
      } else {
        Alert.alert('Error', 'Unexpected response creating bot');
      }
    } catch (e:any) {
      Alert.alert('Error', e?.message || String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={{ padding: 16 }}>
        <Text style={styles.h1}>New Bot</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Name"
          style={styles.input} placeholderTextColor="#7A8797" />

        <Text style={styles.label}>Symbols (comma-separated)</Text>
        <TextInput value={symbols} onChangeText={setSymbols} placeholder="BTCUSD, SOLUSD"
          style={styles.input} placeholderTextColor="#7A8797" />

        <Text style={styles.label}>Strategy</Text>
        <View style={styles.listBox}>
          <FlatList
            data={strategies}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.item, item.id===strategyId && styles.itemActive]} onPress={() => setStrategyId(item.id)}>
                <Text style={styles.itemTitle}>{item.name}{item.version ? ` (${item.version})` : ''}</Text>
                {!!item.description && <Text style={styles.itemDesc}>{item.description}</Text>}
              </TouchableOpacity>
            )}
          />
        </View>

        <TouchableOpacity onPress={createBot} style={styles.btn}>
          <Text style={styles.btnText}>Create & Open</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { color: '#E6EDF3', fontWeight: '700', fontSize: 20, marginBottom: 16 },
  label: { color: '#97A3B6', marginTop: 12 },
  input: { color: '#E6EDF3', borderWidth: 1, borderColor: '#2A3340', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  listBox: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 12, marginTop: 6, maxHeight: 220 },
  item: { padding: 12 },
  itemActive: { backgroundColor: '#0E2B5E33' },
  itemTitle: { color: '#E6EDF3', fontWeight: '600' },
  itemDesc: { color: '#97A3B6', marginTop: 4 },
  btn: { marginTop: 20, backgroundColor: '#0E2B5E', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '700' }
});
