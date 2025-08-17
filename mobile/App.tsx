// /mobile/App.tsx – New Bot + Sign out + SnackProvider + live polling + subtitle
import { Provider } from 'react-redux';
import { store } from './src/store';
import React from 'react';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BotCard from './src/components/BotCard';
import { Summary } from './src/components/SummaryBlock';
import BotDetailScreen from './src/screens/BotDetailScreen';
import NewBotScreen from './src/screens/NewBotScreen';
import NewBotConfigScreen from './src/screens/NewBotConfigScreen';
import Auth from './src/screens/Auth';
import { apiGet, apiPost } from './api';
import { SnackProvider, useSnack } from './src/components/Snack';

type RootStackParamList = { Auth: undefined; Home: undefined; NewBot: undefined; NewBotConfig: { draft: any }; BotDetail: { botId: string; botName?: string } };
const Stack = createNativeStackNavigator<RootStackParamList>();

type Bot = { id: string; name: string; status?: string; strategyId?: string; symbols?: string[]; config?: Record<string, any> };
type Strategy = { id: string; name: string; version?: string };

const navTheme: Theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, card: '#0B1117', background: '#0B1117', text: '#E6EDF3', border: '#2A3340', primary: '#7AA5FF', notification: '#7AA5FF' } };

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <SnackProvider>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
              <Stack.Screen name="Auth" component={AuthScreenWrapper} options={{ headerShown: false }} />
              <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
              <Stack.Screen name="NewBot" component={NewBotScreen} options={{ title: 'New Bot' }} />
              <Stack.Screen name="NewBotConfig" component={NewBotConfigScreen} options={{ title: 'Bot Settings' }} />
              <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot' }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SnackProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}
function AuthScreenWrapper({ navigation }: any) {
  const onSignedIn = () => navigation.replace('Home');
  return <Auth onSignedIn={onSignedIn} />;
}

function HomeScreen({ navigation }: any) {
  const [bots, setBots] = React.useState<Bot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [summaries, setSummaries] = React.useState<Record<string, Summary | undefined>>({});
  const [strategiesIndex, setStrategiesIndex] = React.useState<Record<string, Strategy>>({});
  const { showSnack } = useSnack();

  React.useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <TouchableOpacity onPress={() => navigation.navigate('NewBot')}>
            <Text style={{ color: '#7AA5FF', fontWeight: '600' }}>New Bot</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => { try { await apiPost('/auth/logout'); } catch {} navigation.replace('Auth'); }}>
            <Text style={{ color: '#97A3B6', fontWeight: '600' }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      )
    });
  }, [navigation]);

  // in HomeScreen:
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
    plAvgLifetime: s.plAvgLifetime ?? s.pl_avg_lifetime ?? s.avgPLLifetime, // <-- NEW
  });
  const trySummary = async (id: string) => {
    const tryGet = async (u:string) => { try { return await apiGet(u); } catch { return undefined; } };
    return await tryGet(`/bots/${id}/summary`) || await tryGet(`/bots/${id}/portfolio`) || await tryGet(`/bots/${id}/stats`);
  };
  const refreshStrategies = async () => {
    try {
      const list = await apiGet('/strategies');
      const idx: any = {}; if (Array.isArray(list)) for (const s of list) idx[s.id] = s;
      setStrategiesIndex(idx);
    } catch {}
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
      await refreshStrategies();
    } finally { setRefreshing(false); setLoading(false); }
  };
  React.useEffect(() => { refresh(); }, []);
  React.useEffect(() => {
    const t = setInterval(async () => {
      try {
        const list = await apiGet('/bots');
        setBots(Array.isArray(list) ? list : []);
        await refreshSummaries(Array.isArray(list) ? list : []);
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, []);
  const onStart = async (id: string) => { try { await apiPost(`/bots/${id}/start`); } catch(e:any){ showSnack?.(e?.message || 'Failed to start'); } };
  const onStop  = async (id: string) => { try { await apiPost(`/bots/${id}/stop`); }  catch(e:any){ showSnack?.(e?.message || 'Failed to stop'); } };

  const renderItem = ({ item }: { item: Bot }) => {
    const summary = summaries[item.id];
    const status = (item.status || 'stopped') as 'running'|'stopped'|'idle';
    const strategyName = strategiesIndex[item.strategyId || '']?.name || item.strategyId || '';
    const options = item.config ? Object.entries(item.config).slice(0,2).map(([k,v])=>`${k}=${v}`).join(' • ') : '';
    const subtitle = [strategyName, options].filter(Boolean).join('  ·  ');
    return (
      <View style={{ paddingHorizontal: 12 }}>
        <BotCard id={item.id} name={item.name || item.id} status={status} subtitle={subtitle} summary={summary}
                 onStart={() => onStart(item.id)} onStop={() => onStop(item.id)}
                 onOpen={() => navigation.navigate('BotDetail', { botId: item.id, botName: item.name })} />
      </View>
    );
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      {loading ? (<View style={styles.center}><ActivityIndicator/></View>) : (
        <FlatList data={bots} keyExtractor={(b) => b.id} renderItem={renderItem}
                  contentContainerStyle={{ paddingVertical: 12 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' }});
