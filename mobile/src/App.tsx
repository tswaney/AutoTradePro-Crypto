import React, { useEffect, useState, useCallback } from 'react';
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
import * as SecureStore from 'expo-secure-store';

// Local helpers (present in your project)
import { apiGet, apiPost, logout as apiLogout, openLogsSocket } from './api';
import { useSnack, SnackProvider } from './components/Snack';

// Screens
import AuthScreen from './screens/Auth';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string;
  name?: string;
  status: BotStatus;
  strategy?: string;
  strategyFile?: string;
  symbols?: string[];
  pairs?: string[];
  mode?: string;
};

type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  BotDetail: { botId: string; botName?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AUTH_KEY = 'authed';

export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await SecureStore.getItemAsync(AUTH_KEY);
        setSignedIn(v === '1');
      } catch {}
      setReady(true);
    })();
  }, []);

  const onSignedIn = useCallback(async () => {
    await SecureStore.setItemAsync(AUTH_KEY, '1');
    setSignedIn(true);
  }, []);

  const onSignedOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(AUTH_KEY);
    setSignedIn(false);
  }, []);

  if (!ready) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SnackProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={signedIn ? 'Home' : 'Auth'}
            screenOptions={{ headerTitleAlign: 'center' }}
          >
            {!signedIn ? (
              <Stack.Screen name="Auth" options={{ title: 'Welcome' }}>
                {(props) => <AuthScreen {...props} onSignedIn={onSignedIn} />}
              </Stack.Screen>
            ) : (
              <>
                <Stack.Screen name="Home" options={{ title: 'Bots' }}>
                  {(props) => (
                    <HomeScreen
                      {...props}
                      onSignOut={async () => {
                        try {
                          if (typeof apiLogout === 'function') {
                            await apiLogout();
                          } else {
                            // graceful fallbacks
                            try { await apiPost('/auth/logout'); } catch {}
                            try { await apiPost('/auth/signout'); } catch {}
                            try { await apiGet('/auth/signout'); } catch {}
                          }
                        } catch {}
                        onSignedOut();
                      }}
                    />
                  )}
                </Stack.Screen>
                <Stack.Screen
                  name="BotDetail"
                  component={BotDetailScreen}
                  options={{ title: 'Bot Detail' }}
                />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SnackProvider>
    </GestureHandlerRootView>
  );
}

function HeaderActions({
  onRefresh,
  onSignOut,
}: {
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.headerRow}>
      <TouchableOpacity onPress={onRefresh}>
        <Text style={styles.link}>Refresh Bots</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignOut}>
        <Text style={styles.link}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function HomeScreen({ navigation, onSignOut }: any) {
  const snack = useSnack();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({}); // per-bot network lock

  const fetchBots = async () => {
    try {
      setLoading(true);
      const data = await apiGet('/bots'); // flip to '/api/bots' if needed
      setBots(Array.isArray(data) ? data : []);
    } catch (err: any) {
      snack.show?.(err?.message || 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBots();
  }, []);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'Bots',
      headerLeft: () => (
        <TouchableOpacity onPress={fetchBots} style={{ paddingHorizontal: 12 }}>
          <Text style={styles.link}>Refresh Bots</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={onSignOut} style={{ paddingHorizontal: 12 }}>
          <Text style={styles.link}>Sign out</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, onSignOut]);

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
      await apiPost(`/bots/${id}/start`);
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
      await apiPost(`/bots/${id}/stop`);
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
      await apiPost(`/bots/${id}/restart`);
      snack.show?.('Bot restarted');
      await fetchBots();
    } catch (e: any) {
      snack.show?.(e?.message || 'Restart failed');
    } finally {
      setLock(id, false);
    }
  };

  const renderItem = ({ item }: { item: Bot }) => {
    const id = item.id || 'local-test';
    const locked = !!inFlight[id];
    const canStart = item.status !== 'running' && item.status !== 'starting' && !locked;
    const canStop = item.status === 'running' && !locked;
    const canRestart = item.status === 'running' && !locked;
    const strategy = item.strategy || item.strategyFile || 'strategy';
    const syms = item.symbols || item.pairs || [];

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{id}</Text>
            <Text style={styles.meta}>
              {strategy}
              {syms.length ? ` • ${syms.join(', ')}` : ''}
            </Text>
            <Text style={styles.meta}>
              Status: {item.status}{item.mode ? ` • Mode: ${item.mode}` : ''}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate('BotDetail', { botId: id, botName: id })}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <Text style={styles.link}>Logs</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.row, { marginTop: 8 }]}>
          <TouchableOpacity disabled={!canStart} onPress={() => startBot(item)}>
            <Text style={[styles.link, !canStart && styles.linkDisabled]}>Start</Text>
          </TouchableOpacity>
          <Text style={{ marginHorizontal: 8 }}>·</Text>
          <TouchableOpacity disabled={!canStop} onPress={() => stopBot(item)}>
            <Text style={[styles.link, !canStop && styles.linkDisabled]}>Stop</Text>
          </TouchableOpacity>
          <Text style={{ marginHorizontal: 8 }}>·</Text>
          <TouchableOpacity disabled={!canRestart} onPress={() => restartBot(item)}>
            <Text style={[styles.link, !canRestart && styles.linkDisabled]}>Restart</Text>
          </TouchableOpacity>

          {locked && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>
      </View>
    );
  };

  // Demo card when no bots
  const renderDemoCard = () => {
    const id = 'local-test';
    const locked = !!inFlight[id];
    const onStartDemo = async () => {
      if (locked) return;
      setLock(id, true);
      try {
        await apiPost(`/bots/${id}/start`);
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
        <Text style={styles.title}>Demo/Test Bot</Text>
        <Text style={styles.meta}>No bots were returned from the server.</Text>
        <View style={[styles.row, { marginTop: 10 }]}>
          <TouchableOpacity onPress={onStartDemo}>
            <Text style={styles.link}>Start Demo</Text>
          </TouchableOpacity>
          <Text style={{ marginHorizontal: 8 }}>·</Text>
          <TouchableOpacity onPress={fetchBots}>
            <Text style={styles.link}>Refresh</Text>
          </TouchableOpacity>
          {locked && <ActivityIndicator style={{ marginLeft: 8 }} />}
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
          keyExtractor={(b, idx) => (b.id || 'local-test') + ':' + idx}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </SafeAreaView>
  );
}

function BotDetailScreen({ route }: any) {
  const { botId, botName } = route.params;
  return <BotDetail botId={botId} botName={botName} />;
}

// Pull in the dedicated BotDetail component file
import BotDetail from './BotDetail';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { marginTop: 2, color: '#666' },
  link: { color: '#0A63FF', fontWeight: '600' },
  linkDisabled: { color: '#9DB6FF' },
});
