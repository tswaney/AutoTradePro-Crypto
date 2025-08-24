import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useNavigation } from "@react-navigation/native";

type Strategy = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

export default function NewBotScreen() {
  const navigation = useNavigation<any>();
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (!isRefresh) setLoading(true);
      else setRefreshing(true);

      const res = await fetch(`${API_BASE}/api/strategies`, { signal: ac.signal });
      if (!res.ok) throw new Error(`List failed: ${res.status}`);
      const data = (await res.json()) as Strategy[] | { strategies?: Strategy[] };
      const list = Array.isArray(data) ? data : data?.strategies ?? [];
      setStrategies(list);
      // auto-select the first item if nothing picked yet
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.warn(err);
        Alert.alert("Error", `Failed to load strategies.\n${String(err?.message ?? err)}`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  const onRefresh = useCallback(() => load(true), [load]);

  const proceed = useCallback(() => {
    if (!selectedId) {
      Alert.alert("Pick a strategy", "Please select a strategy to continue.");
      return;
    }
    const picked = strategies?.find(s => s.id === selectedId);
    navigation.navigate("NewBotConfig", { pickedStrategy: picked ?? { id: selectedId } });
  }, [navigation, selectedId, strategies]);

  const keyExtractor = useCallback((item: Strategy) => item.id, []);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Strategy>) => {
      const active = item.id === selectedId;
      return (
        <TouchableOpacity
          onPress={() => setSelectedId(item.id)}
          style={[styles.card, active && styles.cardActive]}
        >
          <View style={styles.row}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title || item.name || item.id}
            </Text>
            {active ? <Text style={styles.badge}>✓</Text> : null}
          </View>
          {/* description should WRAP (no numberOfLines) */}
          {!!item.description && (
            <Text style={styles.desc}>{item.description}</Text>
          )}
          {/* id shown subtly */}
          <Text style={styles.subtle}>{item.id}</Text>
        </TouchableOpacity>
      );
    },
    [selectedId]
  );

  return (
    <View style={{ flex: 1 }}>
      {loading && !strategies ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.dim}>Loading strategies…</Text>
        </View>
      ) : strategies && strategies.length > 0 ? (
        <>
          <FlatList
            data={strategies}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 92 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          />
          <View style={styles.footer}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={proceed}>
              <Text style={styles.btnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={styles.dim}>No strategies found.</Text>
          <TouchableOpacity style={[styles.btn, styles.btnGhost, { marginTop: 12 }]} onPress={() => load(true)}>
            <Text style={styles.btnText}>Reload</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  dim: { color: "#9aa8b5" },
  card: {
    backgroundColor: "#121a22",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardActive: {
    borderColor: "#2563eb",
  },
  row: { flexDirection: "row", alignItems: "center" },
  title: { color: "white", fontWeight: "700", fontSize: 16, flex: 1 },
  badge: {
    color: "white",
    fontWeight: "700",
    backgroundColor: "#2563eb",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  desc: {
    color: "#c8d3dd",
    marginTop: 8,
    lineHeight: 18,
  },
  subtle: { color: "#8795a1", marginTop: 6, fontSize: 12 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(6,10,14,0.9)",
  },
  btn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: "#2563eb" },
  btnGhost: {
    backgroundColor: "#10151c",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
  },
  btnText: { color: "white", fontWeight: "700" },
});
