import React from 'react';
import { ActivityIndicator, DeviceEventEmitter, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import * as SecureStore from 'expo-secure-store';

import { store } from './src/store';
import BotDetailScreen from './src/screens/BotDetailScreen';
import NewBotScreen from './src/screens/NewBotScreen';
import NewBotConfigScreen from './src/screens/NewBotConfigScreen';
import BotCard from './src/components/BotCard';
import HeaderActions from './src/components/HeaderActions';
import { SnackProvider, useSnack } from './src/components/Snack';
import { Summary } from './src/components/SummaryBlock';
import { apiDelete, apiGet, apiPost, logout as apiLogout, apiProbe } from './api';

const Stack = createNativeStackNavigator();
const SIGNED_KEY = 'autotradepro.signedIn';

const navTheme: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#0B1117', card: '#0B1117', text: '#E6EDF3', border: '#2A3340', primary: '#7AA5FF' },
};

type Bot = { id: string; name?: string; status?: any; strategy?: string; strategyFile?: string; symbols?: string[]; pairs?: string[]; };
type BotSummaryMap = Record<string, Summary | undefined>;
type HasLogsMap = Record<string, boolean>;

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <SnackProvider>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerTitleAlign: 'center', headerStyle: { backgroundColor: '#0B1117' }, headerTintColor: '#E6EDF3', headerTitleStyle: { color: '#E6EDF3' } }}>
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
              <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot', headerBackTitle: 'Bot List' }} />
              <Stack.Screen name="NewBot" component={NewBotScreen} options={{ title: 'New Bot' }} />
              <Stack.Screen name="NewBotConfig" component={NewBotConfigScreen} options={{ title: 'Configure Bot' }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SnackProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}

function HomeScreen({ navigation }: any) {
  const snack = useSnack();
  const [bots, setBots] = React.useState<Bot[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [sums, setSums] = React.useState<BotSummaryMap>({});
  const [hasLogs, setHasLogs] = React.useState<HasLogsMap>({});

  React.useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity onPress={() => navigation.navigate('NewBot')}>
            <Text style={{ color: '#7AA5FF', fontWeight: '700' }}>New Bot</Text>
          </TouchableOpacity>
          <HeaderActions
            onRefresh={fetchBots}
            onSignOut={async () => {
              try { await apiLogout(); } catch {}
              await SecureStore.deleteItemAsync(SIGNED_KEY);
            }}
          />
        </View>
      ),
    });
  }, [navigation]);

  const ensureCryptoFallback = (s: Summary | undefined): Summary | undefined => {
    if (!s) return s;
    if ((s.cryptoMkt == null || !Number.isFinite(s.cryptoMkt)) &&
        Number.isFinite(s.beginningPortfolioValue) &&
        Number.isFinite(s.totalPL) &&
        Number.isFinite(s.cash)) {
      const locked = Number.isFinite(s.locked) ? (s.locked as number) : 0;
      const crypto = (s.beginningPortfolioValue as number) + (s.totalPL as number) - (s.cash as number) - locked;
      return { ...s, cryptoMkt: Math.max(0, Number.isFinite(crypto) ? Number(crypto) : 0) };
    }
    return s;
  };

  const fetchBots = async () => {
    try {
      setLoading(true);
      const res = await apiGet('/bots');
      const list = Array.isArray(res) ? (res as Bot[]) : [];
      setBots(list);

      const entries = await Promise.all(
        list.map(async (b) => {
          const raw =
            (await safeGet(`/bots/${b.id}/summary`)) ??
            (await safeGet(`/bots/${b.id}/portfolio`)) ??
            (await safeGet(`/bots/${b.id}/stats`)) ??
            (await safeGet(`/bots/${b.id}/metrics`));
          const norm = normalizeSummary(raw);
          return [b.id, ensureCryptoFallback(norm)] as const;
        })
      );
      setSums(Object.fromEntries(entries));

      const logs = await Promise.all(
        list.map(async (b) => {
          const ok =
            (await apiProbe(`/bots/${b.id}/logs?limit=1`)) ||
            (await apiProbe(`/bots/${b.id}/log`)) ||
            (await apiProbe(`/bots/${b.id}/stdout`));
          return [b.id, ok] as const;
        })
      );
      setHasLogs(Object.fromEntries(logs));
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchBots();
    const sub = DeviceEventEmitter.addListener('bots:refresh', fetchBots);
    const iv = setInterval(() => fetchBots().catch(() => {}), 5000);
    return () => { sub.remove(); clearInterval(iv); };
  }, []);

  const onRefresh = async () => { setRefreshing(true); await fetchBots(); setRefreshing(false); };
  const setLock = (id: string, v: boolean) => setBusy((m) => ({ ...m, [id]: v }));

  const start = async (b: Bot) => { if (busy[b.id]) return; setLock(b.id, true); try { await apiPost(`/bots/${b.id}/start`); await fetchBots(); } finally { setLock(b.id, false); } };
  const stop  = async (b: Bot) => { if (busy[b.id]) return; setLock(b.id, true); try { await apiPost(`/bots/${b.id}/stop`); await fetchBots(); } finally { setLock(b.id, false); } };
  const del   = async (b: Bot) => { if (busy[b.id]) return; setLock(b.id, true); try { await apiDelete(`/bots/${b.id}`); await fetchBots(); } finally { setLock(b.id, false); } };

  const renderItem = ({ item }: { item: Bot }) => {
    const id = item.id;
    const status = (item.status || 'stopped') as any;
    const strat = item.strategy || item.strategyFile || 'Strategy';
    const syms = (item.symbols?.length ? item.symbols : item.pairs) || [];
    const subtitle = syms.length ? `${strat} • ${syms.join(', ')}` : strat;

    return (
      <View style={{ marginBottom: 12 }}>
        <BotCard
          id={id}
          name={item.name || id}
          status={status}
          subtitle={subtitle}
          summary={sums[id]}
          hasLogs={hasLogs[id]}
          onStart={() => start(item)}
          onStop={() => stop(item)}
          onDelete={() => del(item)}
          onOpen={() => navigation.navigate('BotDetail', { botId: id, botName: item.name || id })}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={bots}
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

async function safeGet(path: string) { try { return await apiGet(path); } catch { return undefined; } }

function normalizeSummary(r: any): Summary | undefined {
  if (!r) return undefined;
  const pickNum = (...k: string[]) => {
    for (const key of k) {
      const v = r?.[key];
      if (v == null) continue;
      const n = typeof v === 'string' ? Number(String(v).replace(/[$,]/g, '')) : Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };
  return {
    beginningPortfolioValue: pickNum('beginningPortfolioValue','begin','startValue','startingBalance','beginValue'),
    duration: r?.duration ?? r?.uptime ?? r?.elapsed ?? r?.runtime,
    buys: r?.buys ?? r?.buyCount ?? r?.tradesBuy ?? r?.totalBuys,
    sells: r?.sells ?? r?.sellCount ?? r?.tradesSell ?? r?.totalSells,
    totalPL: pickNum('totalPL','totalPnL','pnl','pl','profitTotal','pnlTotal'),
    pl24h: pickNum('pl24h','pnl24h','dailyPL','pl_24h'),
    avgDailyPL: pickNum('avgDailyPL','avgPLPerDay','avgProfitPerDay'),
    cash: pickNum('cash','balance','free'),
    cryptoMkt: pickNum('cryptoMkt','crypto','marketValue','cryptoMarketValue','equity','holdingsValue','portfolioCryptoValue'),
    locked: pickNum('locked','margin','held','profitLocked'),
  };
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
