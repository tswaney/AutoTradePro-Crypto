// mobile/App.tsx
import React, { useCallback, useEffect, useState } from "react";
import {
  StatusBar,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { NavigationContainer, useFocusEffect } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackScreenProps } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";

import HeaderActions from "./src/components/HeaderActions";
import SignInScreen from "./src/screens/SignInScreen";
import BotDetailScreen from "./src/screens/BotDetailScreen";
import NewBotScreen from "./src/screens/NewBotScreen";
import NewBotConfigScreen from "./src/screens/NewBotConfigScreen";
import { apiLogout } from "./src/api";

/**
 * API base rules unchanged
 */
const API_BASE =
  (process as any)?.env?.EXPO_PUBLIC_API_BASE ||
  (global as any)?.EXPO_PUBLIC_API_BASE ||
  "http://localhost:4000";

const SIGNED_KEY = "autotradepro_signed_in";

type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  BotDetail: { id: string };
  NewBot: undefined;
  NewBotConfig: { draft?: any; strategy?: { id: string; name: string; version?: string } };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// -------------------- Home (Bot list) — LIVE POLLING --------------------
type HomeProps = NativeStackScreenProps<RootStackParamList, "Home">;

type BotRow = {
  id: string;
  name?: string;
  status: string;
  descriptiveName?: string;
  totalPL?: number;
  locked?: number;
  currentPortfolioValue?: number;
  ratePerHour24h?: number; // "24h P/L (avg) Rate Per Hr"
};

function HomeScreen({ navigation }: HomeProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bots, setBots] = useState<BotRow[]>([]);

  const REFRESH_MS = 8000; // live refresh cadence

  // Map server payload → UI fields
  const mapSummary = (base: BotRow, raw: any): BotRow => {
    // Your server returns: { id, name, status, summary: {...} }
    const s = raw?.summary ?? raw ?? {};
    return {
      ...base,
      descriptiveName: s?.descriptiveName ?? s?.strategy ?? s?.strategyName ?? s?.strategyLabel ?? undefined,
      totalPL: s?.totalPL ?? s?.totals?.profit ?? s?.profitTotal ?? undefined,
      locked: s?.locked ?? s?.totals?.locked ?? s?.cash?.locked ?? undefined,
      currentPortfolioValue:
        s?.currentValue ?? s?.currentPortfolioValue ?? s?.totals?.portfolioValue ?? s?.portfolio?.value ?? undefined,
      ratePerHour24h:
        s?.pl24hAvgRatePerHour ??
        s?.overall24hAvgRatePerHour ??
        s?.ratePerHour24h ??
        s?.metrics?.ratePerHour24h ??
        s?.pl24hRatePerHour ??
        undefined,
    };
  };

  // Fetch per-bot summaries (best-effort)
  const fetchSummaries = useCallback(async (base: BotRow[]): Promise<BotRow[]> => {
    return Promise.all(
      base.map(async (b) => {
        try {
          const res = await fetch(`${API_BASE}/api/bots/${encodeURIComponent(b.id)}/summary`, { cache: "no-store" });
          if (!res.ok) return b;
          const payload = await res.json();
          return mapSummary(b, payload);
        } catch {
          return b; // ignore failures; keep base row
        }
      })
    );
  }, []);

  // Load bots then enrich with summaries
  const loadOnce = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/bots`, { cache: "no-store" });
      const json = await res.json();
      const base: BotRow[] = Array.isArray(json) ? json : [];
      const withSummaries = await fetchSummaries(base);
      setBots(withSummaries);
    } catch {
      // keep last known values on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchSummaries]);

  useEffect(() => { loadOnce(); }, [loadOnce]);

  // Live polling while Home is focused
  useFocusEffect(
    React.useCallback(() => {
      let timer: any = null;
      const tick = async () => { await loadOnce(); };
      tick(); // run immediately
      timer = setInterval(tick, REFRESH_MS);
      return () => { if (timer) clearInterval(timer); };
    }, [loadOnce])
  );

  // Header actions
  useEffect(() => {
    navigation.setOptions({
      title: "Bots",
      headerRight: () => (
        <HeaderActions
          onNewBot={() => navigation.navigate("NewBot")}
          onRefresh={loadOnce}
          onSignOut={async () => {
            try { await apiLogout(); } catch {}
            await SecureStore.deleteItemAsync(SIGNED_KEY);
            navigation.reset({ index: 0, routes: [{ name: "SignIn" }] });
          }}
        />
      ),
    });
  }, [navigation, loadOnce]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B1117", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: "#97A3B6", marginTop: 10 }}>Loading…</Text>
      </View>
    );
  }

  const fmt = (n?: number) => (typeof n === "number" && isFinite(n) ? `$${n.toFixed(2)}` : "—");
  const fmtRate = (n?: number) => (typeof n === "number" && isFinite(n) ? `${n.toFixed(2)} / hr` : "—");

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: "#0B1117" }}
      contentContainerStyle={{ padding: 16 }}
      data={bots}
      keyExtractor={(b) => b.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadOnce} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => navigation.navigate("BotDetail", { id: item.id })} style={styles.botRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.botName}>{item.name || item.id}</Text>
            <Text style={styles.botSub}>
              {item.status}{item.descriptiveName ? ` • ${item.descriptiveName}` : ""}
            </Text>
            <View style={{ marginTop: 6 }}>
              <Text style={styles.botSub}>Total P/L: {fmt(item.totalPL)}</Text>
              <Text style={styles.botSub}>24h P/L (avg) Rate Per Hr: {fmtRate(item.ratePerHour24h)}</Text>
              <Text style={styles.botSub}>Locked: {fmt(item.locked)}</Text>
              <Text style={styles.botSub}>Current Portfolio Value: {fmt(item.currentPortfolioValue)}</Text>
            </View>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      )}
      ListEmptyComponent={<Text style={{ color: "#97A3B6" }}>No bots yet.</Text>}
    />
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#0B1117" },
          headerTintColor: "#E6EDF3",
          headerTitleStyle: { color: "#E6EDF3" },
          contentStyle: { backgroundColor: "#0B1117" },
        }}
      >
        {/* SignIn stays the same; Demo button triggers onSubmit here */}
        <Stack.Screen
          name="SignIn"
          options={{ headerShown: false, contentStyle: { backgroundColor: "#0B1117" } }}
          children={({ navigation }) => (
            <SignInScreen
              onSubmit={async () => {
                await SecureStore.setItemAsync(SIGNED_KEY, "1");
                navigation.reset({ index: 0, routes: [{ name: "Home" }] }); // lands on Bots list
              }}
            />
          )}
        />

        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Bots" }} />
        <Stack.Screen name="BotDetail" component={BotDetailScreen} options={{ title: "Bot" }} />
        <Stack.Screen
          name="NewBot"
          component={NewBotScreen}
          options={{ title: "New Bot", contentStyle: { backgroundColor: "#0B1117" } }}
        />
        <Stack.Screen
          name="NewBotConfig"
          component={NewBotConfigScreen}
          options={{ title: "Configure Bot", contentStyle: { backgroundColor: "#0B1117" } }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  botRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#283142",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#0E131A",
  },
  botName: { color: "#E6EDF3", fontWeight: "600" },
  botSub: { color: "#97A3B6", marginTop: 2, fontSize: 12 },
  chev: { color: "#97A3B6", fontSize: 24, marginLeft: 8 },
});
