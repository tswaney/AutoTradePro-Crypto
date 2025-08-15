// /mobile/App.tsx – WITH New Bot route + SnackProvider wrapper
import { Provider } from 'react-redux';
import { store } from './src/store';
import React from 'react';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BotCard from './src/components/BotCard';
import SummaryBlock, { Summary } from './src/components/SummaryBlock';
import BotDetailScreen from './src/screens/BotDetailScreen';
import NewBotScreen from './src/screens/NewBotScreen';
import Auth from './src/screens/Auth';
import { apiGet, apiPost } from './api';
import { SnackProvider } from './src/components/Snack';

type RootStackParamList = { Auth: undefined; Home: undefined; NewBot: undefined; BotDetail: { botId: string; botName?: string } };
const Stack = createNativeStackNavigator<RootStackParamList>();

type Bot = { id: string; name: string; status?: string; strategyId?: string; symbols?: string[] };

const navTheme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, card: '#0B1117', background: '#0B1117', text: '#E6EDF3', border: '#2A3340', primary: '#7AA5FF', notification: '#7AA5FF' } };

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <SnackProvider>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
              <Stack.Screen name="Auth" options={{ headerShown: false }}>
              {props => <Auth onSignedIn={() => props.navigation.replace('Home')} />}
            </Stack.Screen>
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
              <Stack.Screen name="NewBot" component={NewBotScreen} options={{ title: 'New Bot' }} />
              <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot' }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SnackProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}

function HomeScreen({ navigation }: any) {
  const [bots, setBots] = React.useState<Bot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [inFlight, setInFlight] = React.useState<Record<string, boolean>>({});
  const [summaries, setSummaries] = React.useState<Record<string, Summary | undefined>>({});

  React.useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('NewBot')}>
          <Text style={{ color: '#7AA5FF', fontWeight: '600' }}>New Bot</Text>
        </TouchableOpacity>
      )
    });
  }, [navigation]);

  const mapSummary = (s:any): Summary => ({
    beginningPortfolioValue: s.beginningPortfolioValue ?? s.begin ?? s.startValue ?? s.startingBalance,
    duration: s.duration ?? s.uptime ?? s.elapsed,
    buys: s.buys ?? s.buyCount,
    sells: s.sells ?? s.sellCount,
    totalPL: s.totalPL ?? s.pnl ?? s.pl ?? s.totalPnL,
    cash: s.cash ?? s.balance,
    cryptoMkt: s.cryptoMkt ?? s.crypto ?? s.marketValue,
    locked: s.locked ?? s.margin ?? s.held,
    pl24h: s.pl24h ?? s['24h'] ?? s.last24h ?? s.pnl24h ?? s.pl24hTotal,
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

  const refresh = async () => {
    setRefreshing(true);
    try {
      const list = await apiGet('/bots');
      setBots(Array.isArray(list) ? list : []);
      await refreshSummaries(Array.isArray(list) ? list : []);
    } finally { setRefreshing(false); setLoading(false); }
  };

  React.useEffect(() => { refresh(); }, []);

  const onStart = async (id: string) => {
    setInFlight(s => ({ ...s, [id]: true }));
    try { await apiPost(`/bots/${id}/start`); await refresh(); }
    finally { setInFlight(s => { const n = { ...s }; delete n[id]; return n; }); }
  };
  const onStop = async (id: string) => {
    setInFlight(s => ({ ...s, [id]: true }));
    try { await apiPost(`/bots/${id}/stop`); await refresh(); }
    finally { setInFlight(s => { const n = { ...s }; delete n[id]; return n; }); }
  };

  const renderItem = ({ item }: { item: Bot }) => {
    const summary = summaries[item.id];
    const status = (item.status || 'stopped') as 'running'|'stopped'|'idle';
    return (
      <View style={{ paddingHorizontal: 12 }}>
        <BotCard
          id={item.id}
          name={item.name || item.id}
          status={status}
          summary={summary}
          onStart={() => onStart(item.id)}
          onStop={() => onStop(item.id)}
          onOpen={() => navigation.navigate('BotDetail', { botId: item.id, botName: item.name })}
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
          keyExtractor={(b) => b.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
