import React, { useEffect, useLayoutEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Helpers expected in your project
// - apiGet(path: string, token?: string)
// - apiPost(path: string, token?: string, body?: any)
// - openLogsSocket?(botId: string, token?: string)
// - useSnack() + SnackProvider in mobile/src/components/Snack
import { apiGet, apiPost } from './api';
import { useSnack, SnackProvider } from './components/Snack';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string;
  name: string;
  status: BotStatus;
  strategy?: string;
  strategyFile?: string;
  symbols?: string[];
  pairs?: string[];
  mode?: string;
};

type RootStackParamList = {
  Home: undefined;
  BotDetail: { botId: string; botName: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SnackProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
            <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot Detail' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SnackProvider>
    </GestureHandlerRootView>
  );
}

function HomeScreen({ navigation }: any) {
  const snack = useSnack();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({}); // per-bot network lock

  // Header: Refresh left, Sign out right
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity onPress={fetchBots}>
          <Text style={styles.headerLink}>Refresh Bots</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.headerLink}>Sign out</Text>
        </TouchableOpacity>
      ),
    });
  });

  async function signOut() {
    try {
      // Try common endpoints; don't explode if missing
      try { await apiPost('/auth/logout' as any, undefined); } catch {}
      try { await apiPost('/auth/signout' as any, undefined); } catch {}
      try { await apiGet('/auth/signout' as any, undefined); } catch {}
      snack.show?.('Signed out');
    } catch (e: any) {
      snack.show?.(e?.message || 'Sign out failed');
    }
  }

  async function fetchBots() {
    try {
      setLoading(true);
      const data = await apiGet('/bots' as any, undefined); // NOTE: flip to '/api/bots' if your base URL doesn't include /api
      setBots(Array.isArray(data) ? data : []);
    } catch (err: any) {
      snack.show?.(err?.message || 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBots();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBots();
    setRefreshing(false);
  };

  const setLock = (id: string, val: boolean) =>
    setInFlight((m) => ({ ...m, [id]: val }));

  const startBot = async (bot: Bot) => {
    const id = bot.id || 'local-test';
    if (bot.status === 'running' || bot.status === 'starting') {
      snack.show?.('Already running');
      return;
    }
    if (inFlight[id]) return;
    setLock(id, true);
    try {
      await apiPost(`/bots/${id}/start` as any, undefined);
      snack.show?.('Bot started');
      await fetchBots();
    } catch (e: any) {
      snack.show?.(e?.message || 'Start failed');
    } finally {
      setLock(id, false);
    }
  };

  const stopBot = async (bot: Bot) => {
    const id = bot.id || 'local-test';
    if (bot.status !== 'running') {
      snack.show?.('Already stopped');
      return;
    }
    if (inFlight[id]) return;
    setLock(id, true);
    try {
      await apiPost(`/bots/${id}/stop` as any, undefined);
      snack.show?.('Bot stopped');
      await fetchBots();
    } catch (e: any) {
      snack.show?.(e?.message || 'Stop failed');
    } finally {
      setLock(id, false);
    }
  };

  const restartBot = async (bot: Bot) => {
    const id = bot.id || 'local-test';
    if (inFlight[id]) return;
    setLock(id, true);
    try {
      await apiPost(`/bots/${id}/restart` as any, undefined);
      snack.show?.('Bot restarted');
      await fetchBots();
    } catch (e: any) {
      snack.show?.(e?.message || 'Restart failed');
    } finally {
      setLock(id, false);
    }
  };

  const renderSubtitle = (b: Bot) => {
    const file = b.strategy || b.strategyFile || 'strategy';
    const syms = b.symbols || b.pairs || [];
    const symsText = Array.isArray(syms) ? syms.join(', ') : String(syms || '');
    return `${file}${symsText ? ` • ${symsText}` : ''}`;
  };

  const renderItem = ({ item }: { item: Bot }) => {
    const id = item.id || 'local-test';
    const locked = !!inFlight[id];
    const canStart = item.status !== 'running' && item.status !== 'starting' && !locked;
    const canStop = item.status === 'running' && !locked;
    const canRestart = item.status === 'running' && !locked;

    return (
      <View style={styles.card}>
        <View style={{ marginBottom: 6 }}>
          <Text style={styles.title}>{id}</Text>
          <Text style={styles.meta}>{renderSubtitle(item)}</Text>
          <Text style={styles.meta}>
            Status: {item.status}{item.mode ? ` • Mode: ${item.mode}` : ''}
          </Text>
        </View>

        <View style={[styles.row, { marginTop: 4 }]}>
          <TouchableOpacity
            disabled={!canStart}
            onPress={() => startBot(item)}
            style={[styles.linkLike, !canStart && styles.linkDisabled]}
          >
            <Text style={[styles.linkText, !canStart && styles.linkTextDisabled]}>Start</Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!canStop}
            onPress={() => stopBot(item)}
            style={[styles.linkLike, !canStop && styles.linkDisabled]}
          >
            <Text style={[styles.linkText, !canStop && styles.linkTextDisabled]}>Stop</Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!canRestart}
            onPress={() => restartBot(item)}
            style={[styles.linkLike, !canRestart && styles.linkDisabled]}
          >
            <Text style={[styles.linkText, !canRestart && styles.linkTextDisabled]}>Restart</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('BotDetail', { botId: id, botName: id })}
            style={styles.linkLike}
          >
            <Text style={styles.linkText}>Logs</Text>
          </TouchableOpacity>

          {locked ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
        </View>
      </View>
    );
  };

  // --- Demo/Test Bot card when backend returns no bots ---
  const renderDemoCard = () => {
    const id = 'local-test';
    const name = 'Demo/Test Bot';
    const locked = !!inFlight[id];
    const onStartDemo = async () => {
      if (locked) return;
      setLock(id, true);
      try {
        await apiPost(`/bots/${id}/start` as any, undefined);
        snack.show?.('Demo bot started');
        await fetchBots();
      } catch (e: any) {
        snack.show?.(e?.message || 'Failed to start demo bot');
      } finally {
        setLock(id, false);
      }
    };

    return (
      <View style={[styles.card, { margin: 12 }]}>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.meta}>No bots were returned from the server.</Text>
        <Text style={[styles.meta, { marginTop: 4 }]}>
          You can launch a demo bot now; the list will refresh automatically.
        </Text>
        <View style={[styles.row, { marginTop: 10 }]}>
          <TouchableOpacity onPress={onStartDemo} style={[styles.btn, styles.btnPrimary]} disabled={locked}>
            <Text style={styles.btnText}>Start Demo</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={fetchBots} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnText}>Refresh</Text>
          </TouchableOpacity>

          {locked ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : bots.length === 0 ? (
        renderDemoCard()
      ) : (
        <FlatList
          data={bots}
          keyExtractor={(b, i) => (b?.id ? String(b.id) : `row-${i}`)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

function BotDetailScreen({ route }: any) {
  const { botId, botName } = route.params;
  const Detail = require('./BotDetail').default;
  return <Detail botId={botId} botName={botName} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
    borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: '#fafafa',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 2, color: '#666' },
  headerLink: { color: '#0a66ff', fontWeight: '600' },
  linkLike: { paddingRight: 12, paddingVertical: 6 },
  linkText: { color: '#0a66ff', fontWeight: '600' },
  linkDisabled: { opacity: 0.5 },
  linkTextDisabled: { color: '#9db7ff' },
  btn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, marginRight: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  btnText: { fontWeight: '600' },
  btnPrimary: { backgroundColor: '#E7F1FF' },
  btnGhost: { backgroundColor: '#F2F2F2' },
});
