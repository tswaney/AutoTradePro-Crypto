import React, { useEffect, useState } from 'react';
import { SafeAreaView, Text, Button, View, Switch, FlatList, TouchableOpacity, Alert } from 'react-native';
import { signInInteractive, saveTokens, getStoredTokens, clearTokens, Tokens } from './auth/b2c';
import { apiGet, apiPost, setAuthFailedHandler } from './api';

type Bot = { botId: string; strategyFile: string; symbols: string[]; status: string; mode: 'demo'|'live'; aiEnabled: boolean; };

type Busy = { id: string; action: 'start'|'stop'|'restart' } | null;

export default function App() {
  const [tokens, setTokens] = useState<Tokens|null>(null);
  const [useFaceId, setUseFaceId] = useState(false);
  const [bots, setBots] = useState<Bot[]>([]);
  const [busy, setBusy] = useState<Busy>(null);

  // One-time init: try to load stored tokens and register global 401 handler
  useEffect(() => {
    (async () => {
      const t = await getStoredTokens(false);
      if (t) setTokens(t);
    })();

    // Auto sign-out on 401s from the API
    setAuthFailedHandler(() => {
      Alert.alert('Session expired', 'Please sign in again.');
      clearTokens();
      setTokens(null);
    });
    return () => setAuthFailedHandler(() => {});
  }, []);

  async function signIn() {
    const t = await signInInteractive();
    if (t) {
      setTokens(t);
      await saveTokens(t);
    }
  }
  async function signOut() {
    await clearTokens();
    setTokens(null);
  }

  // TEMP: Dev login (no B2C) — works because ALLOW_INSECURE_DEV=true on the API
  async function devLogin() {
    const t = { access_token: 'dev' } as Tokens;
    setTokens(t);
    await saveTokens(t);
  }

  async function refresh() {
    if (!tokens) return;
    const data = await apiGet<Bot[]>('/bots', tokens.access_token);
    setBots(data);
  }

  async function doBotAction(id: string, action: 'start'|'stop'|'restart') {
    if (!tokens) return;
    setBusy({ id, action });
    try {
      await apiPost(`/bots/${id}/${action}`, tokens.access_token);
      await refresh(); // pull latest status after action
    } catch (e: any) {
      const msg = e?.message || 'Action failed';
      Alert.alert('Error', msg);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => { if (tokens) refresh(); }, [tokens]);

  if (!tokens) {
    return (
      <SafeAreaView style={{ flex:1, alignItems:'center', justifyContent:'center', padding:20 }}>
        <Text style={{ fontSize:24, marginBottom:16 }}>AutoTradePro</Text>
        <View style={{ flexDirection:'row', alignItems:'center', marginBottom:16 }}>
          <Text style={{ marginRight:8 }}>Use Face ID</Text>
          <Switch value={useFaceId} onValueChange={setUseFaceId} />
        </View>
        <Button title="Sign in with Email/Password" onPress={signIn} />
        <View style={{ height:10 }} />
        <Button title="Dev Login (no B2C)" onPress={devLogin} />
        <Text style={{ marginTop:12, color:'#666' }}>Azure AD B2C flow will be added later.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex:1, padding:16 }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:12 }}>
        <Button title="Refresh Bots" onPress={refresh} />
        <Button title="Sign out" onPress={signOut} />
      </View>
      <FlatList
        data={bots}
        keyExtractor={(b) => b.botId}
        renderItem={({ item }) => {
          const isBusy = busy?.id === item.botId;
          const label = (a: Busy['action']) => (isBusy && busy?.action === a ? a[0].toUpperCase()+a.slice(1)+'…' : a[0].toUpperCase()+a.slice(1));
          return (
            <TouchableOpacity style={{ padding:12, borderWidth:1, borderRadius:8, marginBottom:8 }} activeOpacity={0.9}>
              <Text style={{ fontWeight:'600' }}>{item.botId}</Text>
              <Text>{item.strategyFile} • {item.symbols.join(', ')}</Text>
              <Text>Status: {item.status} • Mode: {item.mode}</Text>
              <View style={{ flexDirection:'row', marginTop:8 }}>
                <Button title={label('start')} onPress={() => doBotAction(item.botId, 'start')} disabled={isBusy} />
                <View style={{ width:8 }} />
                <Button title={label('stop')} onPress={() => doBotAction(item.botId, 'stop')} disabled={isBusy} />
                <View style={{ width:8 }} />
                <Button title={label('restart')} onPress={() => doBotAction(item.botId, 'restart')} disabled={isBusy} />
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}
