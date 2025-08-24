import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

type BotSummary = {
  id: string;
  name: string;
  status?: "running" | "stopped" | "unknown";
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

/**
 * Try hard to get a list of bots from any server response:
 * - JSON array: [{id,name,...}]
 * - JSON object with { bots: [...] }
 * - Plain text that contains bot IDs (e.g., "bot-abc\nbot-xyz")
 */
async function parseBotsResponse(res: Response): Promise<BotSummary[]> {
  const text = await res.text();

  // 1) Try JSON first
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      return data.map((b: any) => ({
        id: String(b.id ?? b.name ?? ""),
        name: String(b.name ?? b.id ?? ""),
        status: (b.status as any) ?? "unknown",
      })).filter(b => b.id);
    }
    if (data && Array.isArray((data as any).bots)) {
      return (data as any).bots
        .map((b: any) => ({
          id: String(b.id ?? b.name ?? ""),
          name: String(b.name ?? b.id ?? ""),
          status: (b.status as any) ?? "unknown",
        }))
        .filter((b: BotSummary) => b.id);
    }
  } catch {
    // not JSON, fall through to text parsing
  }

  // 2) Text fallback: extract all tokens that look like bot IDs
  const ids = Array.from(new Set((text.match(/bot-[a-zA-Z0-9_-]+/g) ?? [])));
  if (ids.length > 0) {
    return ids.map((id) => ({ id, name: id, status: "unknown" as const }));
  }

  // 3) Give up—return empty
  return [];
}

export default function BotsScreen() {
  const navigation = useNavigation<any>();
  const [bots, setBots] = useState<BotSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBots = useCallback(async (isRefresh = false) => {
    try {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (!isRefresh) setLoading(true);
      else setRefreshing(true);

      const res = await fetch(`${API_BASE}/api/bots`, { signal: ac.signal });
      if (!res.ok) throw new Error(`List failed: ${res.status}`);

      const list = await parseBotsResponse(res);
      setBots(list);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("fetchBots error:", err);
      Alert.alert("Error", `Failed to load bots.\n${String(err?.message ?? err)}`);
      setBots([]); // avoid spinner loop
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch whenever this screen gains focus (e.g., after NewBotConfigScreen pops back)
  useFocusEffect(
    useCallback(() => {
      fetchBots(false);
      return () => {
        if (abortRef.current) abortRef.current.abort();
      };
    }, [fetchBots])
  );

  const onRefresh = useCallback(() => fetchBots(true), [fetchBots]);

  const keyExtractor = useCallback((item: BotSummary) => item.id, []);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<BotSummary>) => (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate("BotDetail", { botId: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.name || item.id}
          </Text>
          <View
            style={[
              styles.dot,
              item.status === "running"
                ? styles.dotRunning
                : item.status === "stopped"
                ? styles.dotStopped
                : styles.dotUnknown,
            ]}
          />
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>
          {item.id}
        </Text>
      </TouchableOpacity>
    ),
    [navigation]
  );

  if (loading && !bots) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.dim}>Loading bots…</Text>
      </View>
    );
  }

  const listEmpty = !bots || bots.length === 0;

  return (
    <View style={styles.container}>
      {listEmpty ? (
        <View style={styles.center}>
          <Text style={styles.dim}>No bots yet.</Text>
          <Text style={styles.dimSmall}>Create one from “New Bot”.</Text>
        </View>
      ) : (
        <FlatList
          data={bots}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  dim: { color: "#96a0ad" },
  dimSmall: { color: "#96a0ad", fontSize: 12 },
  card: {
    backgroundColor: "#121a22",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  cardTitle: { flex: 1, color: "white", fontWeight: "600", fontSize: 16 },
  cardSub: { color: "#91a0b0", marginTop: 6, fontSize: 12 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  dotRunning: { backgroundColor: "#22c55e" },
  dotStopped: { backgroundColor: "#ef4444" },
  dotUnknown: { backgroundColor: "#6b7280" },
});
