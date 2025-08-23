import React, { useCallback, useMemo, useRef, useState } from "react";
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

      // Minimal list endpoint: GET /api/bots
      // Fallback: if your control-plane only has /api/bots/:id/summary,
      // keep this list call — your server already exposes /api/bots (per previous steps).
      const res = await fetch(`${API_BASE}/api/bots`, { signal: ac.signal });
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = (await res.json()) as BotSummary[] | { bots?: BotSummary[] };

      const list = Array.isArray(data) ? data : data?.bots ?? [];
      setBots(list);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("fetchBots error:", err);
      Alert.alert("Error", `Failed to load bots.\n${String(err?.message ?? err)}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch whenever this screen gains focus (coming back from "Create Bot", etc.)
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
    ({ item }: ListRenderItemInfo<BotSummary>) => {
      return (
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
      );
    },
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
