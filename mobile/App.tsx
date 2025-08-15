// /mobile/App.tsx
import { Provider } from 'react-redux';
import { store } from './src/store';
import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { apiGet, apiPost, logout as apiLogout } from './api';
import { SnackProvider, useSnack } from './src/components/Snack';

import { colors } from './src/theme/designSystem';
import BotCard from './src/components/BotCard';
import BotDetailScreen from './src/screens/BotDetailScreen';
import HeaderActions from './src/components/HeaderActions';
import type { Summary } from './src/components/SummaryBlock';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string; name: string; status: BotStatus;
  mode?: string; strategy?: string; strategyFile?: string;
  symbols?: string[]; pairs?: string[];
};

type RootStackParamList = { Auth: undefined; Home: undefined; BotDetail: { botId: string; botName?: string } };
const Stack = createNativeStackNavigator<RootStackParamList>();
const SIGNED_KEY = 'autotradepro.signedIn';

const navTheme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.background, card: '#11161C', text: '#E6EDF3', border: '#2A3340', primary: '#7AA5FF', notification: '#7AA5FF' } };

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <SnackProvider>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
              <Stack.Screen name="Auth" component={AuthGate} options={{ headerShown: false }} />
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
              <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot Detail' }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SnackProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}

function AuthGate({ navigation }: any) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const signed = await SecureStore.getItemAsync(SIGNED_KEY);
        if (signed === '1') { navigation.reset({ index: 0, routes: [{ name: 'Home' }] }); return; }
      } finally { setReady(true); }
    })();
  }, [navigation]);

  if (!ready) return (<SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator /></SafeAreaView>);

  const AuthScreen = require('./src/screens/Auth').default;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <AuthScreen onSignedIn={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })} />
    </SafeAreaView>
  );
}

function HomeScreen({ navigation }: any) {
  const snack = useSnack();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const [summaries, setSummaries] = useState<Record<string, Summary | undefined>>({});

  const mapSummary = (s:any): Summary => ({
    beginningPortfolioValue: s.beginningPortfolioValue ?? s.begin ?? s.startValue ?? s.startingBalance,
    duration: s.duration ?? s.uptime ?? s.elapsed,
    buys: s.buys ?? s.buyCount,
    sells: s.sells ?? s.sellCount,
    totalPL: s.totalPL ?? s.pnl ?? s.pl ?? s.totalPnL,
    cash: s.cash ?? s.balance,
    cryptoMkt: s.cryptoMkt ?? s.crypto ?? s.marketValue,
    locked: s.locked ?? s.margin ?? s.held,
  });

  const trySummary = async (id: string) => {
    const tryGet = async (u:string) => { try { return await apiGet(u); } catch { return undefined; } };
    return await tryGet(`/bots/${id}/summary`) || await tryGet(`/bots/${id}/portfolio`) || await tryGet(`/bots/${id}/stats`);
  };

  const refreshSummaries = async (list: Bot[]) => {
    const entries = await Promise.all(list.map(async b => {
      const raw = await trySummary(b.id);
      return [b.id, raw ? mapSummary(raw) : undefined] as const;
    }));
    setSummaries(Object.fromEntries(entries));
  };

  const fetchBots = async () => {
    try {
      setLoading(true);
      const res = await apiGet('/bots');
      const list = Array.isArray(res) ? (res as Bot[]) : [];
      setBots(list);
      await refreshSummaries(list);
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBots();
    const sub = DeviceEventEmitter.addListener('bots:refresh', fetchBots);
    const iv = setInterval(() => fetchBots().catch(()=>{}), 5000);
    return () => { sub.remove(); clearInterval(iv); };
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderActions
          onRefresh={fetchBots}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
          }}
        />
      ),
      headerLeft: () => null,
      headerTitle: 'Bots',
    });
  }, [navigation]);

  const onRefresh = async () => { setRefreshing(true); await fetchBots(); setRefreshing(false); };
  const setLock = (id: string, val: boolean) => setInFlight((m) => ({ ...m, [id]: val }));

  // strict: no auto-start anywhere; ONLY call /start inside this handler
  const startBot = async (b: Bot) => {
    if (b.status === 'running' || b.status === 'starting') { snack.show?.('Already running'); return; }
    if (inFlight[b.id]) return;
    setLock(b.id, true);
    try { await apiPost(`/bots/${b.id}/start`); snack.show?.('Start requested'); await fetchBots(); }
    catch (e:any) { snack.show?.(e?.message || 'Start failed'); }
    finally { setLock(b.id, false); }
  };
  const stopBot = async (b: Bot) => {
    if (b.status !== 'running') { snack.show?.('Already stopped'); return; }
    if (inFlight[b.id]) return;
    setLock(b.id, true);
    try { await apiPost(`/bots/${b.id}/stop`); snack.show?.('Stop requested'); await fetchBots(); }
    catch (e:any) { snack.show?.(e?.message || 'Stop failed'); }
    finally { setLock(b.id, false); }
  };

  const renderItem = ({ item }: { item: Bot }) => {
    const id = item.id || 'local-test';
    const name = item.name || id;
    const strat = item.strategy || item.strategyFile || 'strategy';
    const syms = (item.symbols && item.symbols.length ? item.symbols : item.pairs) || [];
    const subtitle = syms.length ? `${strat} • ${syms.join(', ')}` : `${strat}`;

    return (
      <View style={{ marginBottom: 12 }}>
        <BotCard
          id={id}
          name={name}
          status={item.status === 'running' ? 'running' : item.status === 'stopped' ? 'stopped' : 'idle'}
          subtitle={subtitle}
          summary={summaries[id]}
          onStart={() => startBot(item)}
          onStop={() => stopBot(item)}
          onOpen={() => navigation.navigate('BotDetail', { botId: id, botName: name })}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator/></View>
      ) : (
        <FlatList
          data={bots}
          keyExtractor={(b) => b.id || 'local-test'}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
