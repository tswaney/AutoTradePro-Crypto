import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, Button, FlatList, TextInput, TouchableOpacity, Alert } from 'react-native';
import type { Tokens } from './auth/b2c';
import { apiGet, apiPost, openLogsSocket } from './api';

type Bot = { botId: string; strategyFile: string; symbols: string[]; status: string; mode: 'demo'|'live'; aiEnabled: boolean; };
type Strategy = { id: number; name: string; desc?: string };

type Props = {
  bot: Bot;
  tokens: Tokens;
  onBack: () => void;
};

type Line = { ts: number; msg: string };

export default function BotDetail({ bot, tokens, onBack }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const listRef = useRef<FlatList<Line>>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Load strategies
  useEffect(() => {
    (async () => {
      try {
        const s = await apiGet<Strategy[]>('/strategies', tokens.access_token);
        setStrategies(s);
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to load strategies');
      }
    })();
  }, [tokens.access_token]);

  // Logs socket
  useEffect(() => {
    const ws = openLogsSocket(bot.botId, tokens.access_token);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(String(evt.data));
        const msg = typeof payload?.msg === 'string' ? payload.msg : String(evt.data);
        const ts = Number(payload?.ts) || Date.now();
        setLines((prev) => {
          const next = [...prev, { ts, msg }];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      } catch {
        const s = String(evt.data || '');
        setLines((prev) => [...prev, { ts: Date.now(), msg: s }]);
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      }
    };
    return () => {
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
  }, [bot.botId, tokens.access_token]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => l.msg.toLowerCase().includes(f));
  }, [lines, filter]);

  async function startWithStrategy(id: number) {
    try {
      await apiPost(`/bots/${bot.botId}/start`, tokens.access_token, { strategyChoice: id });
      Alert.alert('Started', `Bot started with strategy #${id}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Start failed');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Button title="‹ Back" onPress={onBack} />
        <Text style={{ fontWeight: '600' }}>{bot.botId}</Text>
        <Text>{connected ? '● Live' : '○ Offline'}</Text>
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 12, color: '#666' }}>{bot.strategyFile} • {bot.symbols.join(', ')}</Text>
      </View>

      {/* Strategies List */}
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>Strategies</Text>
      <FlatList
        horizontal
        data={strategies}
        keyExtractor={(s) => String(s.id)}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity style={{ padding: 10, borderWidth: 1, borderRadius: 10, marginRight: 8, width: 240 }} activeOpacity={0.9}>
            <Text style={{ fontWeight: '600' }}>#{item.id} {item.name}</Text>
            {item.desc ? <Text style={{ color: '#666', marginTop: 4, fontSize: 12 }}>{item.desc}</Text> : null}
            <View style={{ height: 8 }} />
            <Button title="Start with this" onPress={() => startWithStrategy(item.id)} />
          </TouchableOpacity>
        )}
      />

      <View style={{ height: 12 }} />

      {/* Logs */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <TextInput
          placeholder="Filter logs (e.g., BUY, SELL, ERROR)"
          value={filter}
          onChangeText={setFilter}
          style={{ flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 }}
        />
        <View style={{ width: 8 }} />
        <Button title="Clear" onPress={() => setLines([])} />
      </View>

      <FlatList
        ref={listRef}
        data={filtered}
        keyExtractor={(_, idx) => String(idx)}
        renderItem={({ item }) => (
          <Text style={{ fontFamily: 'Courier', fontSize: 12, marginBottom: 2 }}>
            {new Date(item.ts).toLocaleTimeString()}  {item.msg}
          </Text>
        )}
      />
    </SafeAreaView>
  );
}
