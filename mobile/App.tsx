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

// project helpers
import { apiGet, apiPost, logout as apiLogout } from './api';
import { SnackProvider, useSnack } from './components/Snack';

// NEW: design system + BotCard + BotDetail screen
import { colors } from './src/theme/designSystem';
import BotCard from './src/components/BotCard';
import BotDetailScreen from './src/screens/BotDetailScreen';
import type { BotSummary } from './src/types';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string;
  name: string;
  status: BotStatus;
  mode?: string;
  strategy?: string;
  strategyFile?: string;
  symbols?: string[];
  pairs?: string[];
};

type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  BotDetail: { botId: string; botName?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const SIGNED_KEY = 'autotradepro.signedIn';

// Optional: themed navigation (dark)
const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
    notification: colors.primary,
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SnackProvider>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
            <Stack.Screen name="Auth" component={AuthGate} options={{ headerShown: false }} />
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Bots' }} />
            {/* NEW: use the modern BotDetailScreen (Freeze/Unfreeze/Jump) */}
            <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: 'Bot Detail' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SnackProvider>
    </GestureHandlerRootView>
  );
}

/** AuthGate decides whether to show Sign In or immediately jump to Home */
function AuthGate({ navigation }: any) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const signed = await SecureStore.getItemAsync(SIGNED_KEY);
        if (signed === '1') {
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          return;
        }
      } finally {
        setReady(true);
      }
    })();
  }, [navigation]);

  if (!ready) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  // Keep your existing Auth screen; if you prefer the new SignInScreen, swap it here.
  const AuthScreen = require('./screens/Auth').default;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <AuthScreen onSignedIn={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })} />
    </SafeAreaView>
  );
}

function HeaderButtons({ onRefresh, onSignOut }: { onRefresh: () => void; onSignOut: () => void }) {
  return (
    <View style={styles.headerRow}>
      <TouchableOpacity onPress={onRefresh}><Text style={styles.headerLink}>Refresh Bots</Text></TouchableOpacity>
      <TouchableOpacity onPress={onSignOut}><Text style={styles.headerLink}>Sign out</Text></TouchableOpacity>
    </View>
  );
}

function HomeScreen({ navigation }: any) {
  const snack = useSnack();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  // NEW: summaries for cards (if backend exposes /bots/:id/summary)
  const [summaries, setSummaries] = useState<Record<string, BotSummary | undefined>>({});

  const fetchSummary = async (id: string) => {
    try {
      const s = await apiGet(`/bots/${id}/summary`);
      // Expecting keys to match BotSummary; if not, map here.
      setSummaries(prev => ({ ...prev, [id]: s as BotSummary }));
    } catch {
      // Ok if not available; BotCard will simply hide the summary block
    }
  };

  const fetchBots = async () => {
    try {
      setLoading(true);
      const res = await apiGet('/bots');
      const list = Array.isArray(res) ? (res as Bot[]) : [];
      setBots(list);
      // Opportunistically fetch summaries in the background
      await Promise.all(list.map(b => fetchSummary(b.id).catch(() => {})));
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to load bots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBots();
    const sub = DeviceEventEmitter.addListener('bots:refresh', fetchBots);
    return () => sub.remove();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBots();
    setRefreshing(false);
  };

  const setLock = (id: string, val: boolean) =>
    setInFlight((m) => ({ ...m, [id]: val }));

  const startBot = async (b: Bot) => {
    if (b.status === 'running' || b.status === 'starting') { snack.show?.('Already running'); return; }
    if (inFlight[b.id]) return;
    setLock(b.id, true);
    try {
      await apiPost(`/bots/${b.id}/start`);
      snack.show?.('Start requested');
      await fetchBots();
    } catch (e: any) { snack.show?.(e?.message || 'Start failed'); }
    finally { setLock(b.id, false); }
  };
  const stopBot = async (b: Bot) => {
    if (b.status !== 'running') { snack.show?.('Already stopped'); return; }
    if (inFlight[b.id]) return;
    setLock(b.id, true);
    try {
      await apiPost(`/bots/${b.id}/stop`);
      snack.show?.('Stop requested');
      await fetchBots();
    } catch (e: any) { snack.show?.(e?.message || 'Stop failed'); }
    finally { setLock(b.id, false); }
  };
  const restartBot = async (b: Bot) => {
    if (inFlight[b.id]) return;
    setLock(b.id, true);
    try {
      await apiPost(`/bots/${b.id}/restart`);
      snack.show?.('Restart requested');
      await fetchBots();
    } catch (e: any) { snack.show?.(e?.message || 'Restart failed'); }
    finally { setLock(b.id, false); }
  };

  useEffect(() => {
    // put header buttons into the nav bar
    navigation.setOptions({
      headerRight: () => <HeaderButtons onRefresh={fetchBots} onSignOut={async () => {
        try {
          if (typeof apiLogout === 'function') await apiLogout();
          else {
            try { await apiPost('/auth/logout'); } catch {}
            try { await apiPost('/auth/signout'); } catch {}
            try { await apiGet('/auth/signout'); } catch {}
          }
        } catch {}
        await SecureStore.deleteItemAsync(SIGNED_KEY);
        navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
      }} />,
      headerLeft: () => null,
      headerTitle: 'Bots',
    });
  }, [navigation]);

  const mapStatus = (s: BotStatus): 'running' | 'stopped' | 'idle' =>
    s === 'running' ? 'running' : s === 'stopped' ? 'stopped' : 'idle';

  const renderItem = ({ item }: { item: Bot }) => {
    const id = item.id || 'local-test';
    const name = item.name || id;
    const locked = !!inFlight[id];

    return (
      <View style={{ marginBottom: 12 }}>
        <BotCard
          id={id}
          name={name}
          status={mapStatus(item.status)}
          summary={summaries[id]}
          onStart={() => startBot(item)}
          onStop={() => stopBot(item)}
          onOpen={() => navigation.navigate('BotDetail', { botId: id, botName: name })}
        />
        {locked && <ActivityIndicator style={{ marginLeft: 8 }} />}
        {/* Keep your Restart action as a separate pill if you want */}
        <View style={[styles.row, { marginTop: 6, paddingHorizontal: 6 }]}>
          <TouchableOpacity disabled={item.status!=='running'||locked} onPress={() => restartBot(item)} style={[styles.btnPill, (item.status!=='running'||locked)?styles.pillDisabled:styles.pillWarn]}>
            <Text style={styles.pillText}>Restart</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator/></View>
      ) : (
        <FlatList
          data={bots}
          keyExtractor={(b) => b.id || 'local-test'}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<EmptyState onStartDemo={async () => {
            try {
              await apiPost('/bots/local-test/start');
              snack.show?.('Demo bot started');
              await fetchBots();
            } catch (e: any) { snack.show?.(e?.message || 'Failed to start demo'); }
          }} />}
        />
      )}
    </SafeAreaView>
  );
}

function EmptyState({ onStartDemo }: { onStartDemo: () => void }) {
  return (
    <View style={[styles.card, { marginTop: 20 }]}>
      <Text style={styles.title}>No bots found</Text>
      <Text style={styles.meta}>You can launch a demo bot to get started.</Text>
      <View style={[styles.row, { marginTop: 10 }]}>
        <TouchableOpacity onPress={onStartDemo} style={[styles.btnPill, styles.pillPrimary]}>
          <Text style={styles.pillText}>Start Demo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: 220 },
  headerLink: { color: '#7AA5FF', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },

  // legacy card styles used by EmptyState only (BotCard now handles bot UI)
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2A3340',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#11161C',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#E6EDF3' },
  meta: { marginTop: 2, color: '#97A3B6' },
  btnPill: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    marginRight: 8, marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2A3340',
  },
  pillText: { fontWeight: '600', color: '#E6EDF3' },
  pillPrimary: { backgroundColor: '#0E2B5E' },
  pillDanger: { backgroundColor: '#3A1111' },
  pillWarn: { backgroundColor: '#3A2A11' },
  pillGhost: { backgroundColor: '#1A1F28' },
  pillDisabled: { backgroundColor: '#1D2631', opacity: 0.6 },
});
