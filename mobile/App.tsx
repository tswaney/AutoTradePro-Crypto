// App.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, Theme, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { Provider } from 'react-redux';

// store path per your tree: mobile/src/store/index.ts
import { store } from './src/store';

// screens per your tree: mobile/src/screens/*
import Auth from './src/screens/Auth';
import BotDetailScreen from './src/screens/BotDetailScreen';
import NewBotScreen from './src/screens/NewBotScreen';
import NewBotConfigScreen from './src/screens/NewBotConfigScreen';

// components per your tree: mobile/src/components/*
import SummaryBlock, { Summary } from './src/components/SummaryBlock';
import { SnackProvider } from './src/components/Snack';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';
async function http(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE_URL}/api${path}`, {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.headers.get('content-type')?.includes('application/json') ? r.json() : r.text();
}

type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  BotDetail: { botId: string; botName?: string };
  NewBot: undefined;
  NewBotConfig: { strategyId: string; suggestedName?: string; symbolsCsv?: string };
};
const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#0B1117',
    card: '#0B1117',
    text: '#E6EDF3',
    border: '#2A3340',
    primary: '#7AA5FF',
  },
};

type BotRow = {
  id: string;
  name?: string;
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
  bpvSource?: 'initial' | 'log';
} & Summary;

function mapSummary(r: any): Summary {
  return {
    beginningPortfolioValue: r.beginningPortfolioValue ?? r.begin ?? r.startValue ?? r.startingBalance,
    duration: r.duration ?? r.uptime ?? r.elapsed ?? r.runtime,
    buys: r.buys ?? r.buyCount,
    sells: r.sells ?? r.sellCount,
    totalPL: r.totalPL ?? r.pnl ?? r.pl ?? r.totalPnL,
    pl24h: r.pl24h ?? r.pl_24h ?? r['24hTotalPL'] ?? r.totalPL24h ?? r.plLast24h ?? r.pl_last24h ?? r['24h_pl'],
    avgDailyPL: r.avgDailyPL ?? r.dailyAvgPL ?? r.avgPLPerDay ?? r.avg_per_day ?? r.averageDailyPL,
    cash: r.cash ?? r.balance,
    cryptoMkt: r.cryptoMkt ?? r.crypto ?? r.marketValue,
    locked: r.locked ?? r.margin ?? r.held,
  };
}

function StatusPill({ status }: { status: BotRow['status'] }) {
  const bg = status === 'running' ? '#1E6F3D' : status === 'stopped' ? '#6A2A2A' : '#2D3A4A';
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8 }}>
      <Text style={{ color: '#E6EDF3', fontWeight: '700' }}>{status.toUpperCase()}</Text>
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ backgroundColor: '#1F4E99', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8 }}>
      <Text style={{ color: '#E6EDF3', fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function BotListScreen({ navigation }: any) {
  const [rows, setRows] = useState<BotRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list: any[] = await http('/bots/snapshots'); // backend v3.7
      const mapped: BotRow[] = list.map((s) => ({
        id: s.id, name: s.name, status: (s.status || 'unknown') as BotRow['status'],
        bpvSource: s.bpvSource, ...mapSummary(s),
      }));
      setRows(mapped);
    } catch {
      try {
        const list: any[] = await http('/bots');
        const stats = await Promise.all(list.map((b) => http(`/bots/${b.id}/summary`).catch(() => null)));
        const mapped: BotRow[] = list.map((b, i) => {
          const r: any = stats[i] || {};
          return { id: b.id, name: b.name, status: (b.status || 'unknown') as BotRow['status'], bpvSource: r.bpvSource, ...mapSummary(r) };
        });
        setRows(mapped);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const iv = setInterval(load, 4000); return () => clearInterval(iv); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const renderItem = ({ item }: { item: BotRow }) => (
    <View style={{ borderWidth: 1, borderColor: '#2A3340', borderRadius: 16, padding: 14, backgroundColor: '#11161C', marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#E6EDF3' }}>{item.name || item.id}</Text>
        <StatusPill status={item.status} />
      </View>

      <SummaryBlock s={item} showPlaceholder={item.bpvSource !== 'log'} />

      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Pill label="Start" onPress={() => http(`/bots/${item.id}/start`, { method: 'POST' }).then(load)} />
        <Pill label="Logs"  onPress={() => navigation.navigate('BotDetail', { botId: item.id, botName: item.name })} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#E6EDF3' }}>Bots</Text>
        <TouchableOpacity onPress={() => navigation.navigate('NewBot')}>
          <Text style={{ color: '#7AA5FF', fontWeight: '700' }}>New Bot</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

// Small wrapper so Auth can navigate to Home once signed in / demo
function AuthGate({ navigation }: any) {
  return <Auth onSignedIn={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })} />;
}

export default function App() {
  return (
    <Provider store={store}>
      <SnackProvider>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }} initialRouteName="Auth">
            <Stack.Screen name="Auth" component={AuthGate as any} options={{ headerShown: false }} />
            <Stack.Screen name="Home" component={BotListScreen} options={{ title: 'Bots' }} />
            <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot' }} />
            <Stack.Screen name="NewBot" component={NewBotScreen} options={{ title: 'New Bot' }} />
            <Stack.Screen name="NewBotConfig" component={NewBotConfigScreen} options={{ title: 'Configure Bot' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SnackProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
