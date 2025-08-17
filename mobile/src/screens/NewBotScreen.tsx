import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert, SafeAreaView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, FlatList, Dimensions
} from 'react-native';
import { apiGet } from '../api/client';

type Strategy = { id: string; name: string; version?: string; description?: string };

export default function NewBotScreen({ navigation }: any) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('bot-' + Math.random().toString(36).slice(2,7));
  const [symbols, setSymbols] = useState('BTCUSD, SOLUSD');
  const [strategyId, setStrategyId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiGet('/strategies');
      const arr = Array.isArray(list) ? list : [];
      setStrategies(arr);
      if (!strategyId && arr[0]?.id) setStrategyId(arr[0].id);
    } catch {
      setStrategies([]); setStrategyId('');
    } finally {
      setLoading(false);
    }
  }, [strategyId]);

  useEffect(() => { load(); }, [load]);

  const continueNext = useCallback(async () => {
    if (!name.trim()) return Alert.alert('Name is required');
    if (!strategyId) return Alert.alert('No strategies found', 'Verify control-plane and STRATEGIES_DIR, then reload.');

    const draft = {
      name: name.trim(),
      strategyId,
      symbols: symbols.split(',').map(s => s.trim()).filter(Boolean),
    };
    const selected = strategies.find(s => s.id === strategyId) || null;

    navigation.navigate('NewBotConfig', { draft, strategy: selected });
  }, [name, strategyId, symbols, strategies, navigation]);

  const CARD_GAP = 10;
  const COLS = 2;
  const W = Dimensions.get('window').width - 16*2 - CARD_GAP;
  const CARD_W = Math.floor(W / COLS);

  const renderItem = ({ item }: { item: Strategy }) => {
    const selected = item.id === strategyId;
    return (
      <TouchableOpacity
        onPress={() => setStrategyId(item.id)}
        style={[styles.card, { width: CARD_W }, selected && styles.cardActive]}
        activeOpacity={0.9}
      >
        <Text style={[styles.cardTitle, selected && styles.cardTitleActive]}>
          {item.name}{item.version ? ` (${item.version})` : ''}
        </Text>
        {!!item.description && <Text style={styles.cardDesc} numberOfLines={3}>{item.description}</Text>}
        {selected && <Text style={styles.check}>✓</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={{ padding: 16, flex: 1 }}>
        <Text style={styles.h1}>New Bot</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          value={name} onChangeText={setName}
          placeholder="Name" style={styles.input} placeholderTextColor="#7A8797"
        />

        <Text style={styles.label}>Symbols (comma-separated)</Text>
        <TextInput
          value={symbols} onChangeText={setSymbols}
          placeholder="BTCUSD, SOLUSD" style={styles.input} placeholderTextColor="#7A8797"
        />

        <Text style={styles.label}>Strategy</Text>
        <View style={styles.gridShell}>
          {strategies.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No strategies found.</Text>
              <Text style={styles.emptyTextDim}>Check control-plane and STRATEGIES_DIR, then reload.</Text>
              <TouchableOpacity onPress={load} style={styles.reloadBtn}><Text style={styles.reloadTxt}>Reload</Text></TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={strategies}
              keyExtractor={(s) => s.id}
              renderItem={renderItem}
              numColumns={COLS}
              columnWrapperStyle={{ gap: CARD_GAP }}
              ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
              showsVerticalScrollIndicator
              indicatorStyle="white"
              nestedScrollEnabled
              style={{ maxHeight: 340 }}   // only the grid scrolls
            />
          )}
        </View>

        <TouchableOpacity onPress={continueNext} style={[styles.btn, { marginTop: 12 }]} disabled={loading || !strategyId}>
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:{ color:'#E6EDF3', fontWeight:'700', fontSize:20, marginBottom:16 },
  label:{ color:'#97A3B6', marginTop:12 },
  input:{ color:'#E6EDF3', borderWidth:1, borderColor:'#2A3340', borderRadius:12, paddingHorizontal:12, paddingVertical:10, marginTop:6 },

  gridShell:{ marginTop:6, borderWidth:1, borderColor:'#2A3340', borderRadius:12, padding:10 },
  card:{
    backgroundColor:'#0E1520', borderRadius:12, padding:12, minHeight:92, position:'relative',
    borderWidth:1, borderColor:'#1B2431', justifyContent:'space-between'
  },
  cardActive:{ backgroundColor:'#0E2B5E33', borderColor:'#3B82F6' },
  cardTitle:{ color:'#E6EDF3', fontWeight:'700' },
  cardTitleActive:{ color:'#FFFFFF' },
  cardDesc:{ color:'#97A3B6', marginTop:6, fontSize:12 },
  check:{ position:'absolute', right:8, top:8, color:'#3B82F6', fontSize:16, fontWeight:'800' },

  btn:{ backgroundColor:'#0E2B5E', borderRadius:12, paddingVertical:12, alignItems:'center' },
  btnText:{ color:'white', fontWeight:'700' },

  emptyBox:{ borderWidth:1, borderColor:'#2A3340', borderRadius:12, padding:16, alignItems:'center' },
  emptyText:{ color:'#E6EDF3', fontWeight:'600' },
  emptyTextDim:{ color:'#97A3B6', marginTop:4 },
  reloadBtn:{ marginTop:10, backgroundColor:'#0F4C81', paddingHorizontal:12, paddingVertical:8, borderRadius:10 },
  reloadTxt:{ color:'white', fontWeight:'700' },
});
