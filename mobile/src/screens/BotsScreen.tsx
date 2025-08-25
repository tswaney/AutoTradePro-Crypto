import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

type Bot = {
  id: string;
  name?: string;
  status?: "running" | "stopped" | string;
  strategyId?: string;
  strategyName?: string;
};

type Summary = {
  totalPL?: number | null;
  locked?: number | null;
  currentValue?: number | null;
};

type SummaryResp = {
  id: string;
  name?: string;
  status?: string;
  strategyId?: string;
  strategyName?: string;
  summary?: Summary;
};

function money(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `$${Number(v).toFixed(2)}`;
  }
}

export default function BotsScreen() {
  const nav = useNavigation<any>();
  const [bots, setBots] = useState<Bot[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({}); // live status per bot
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botsRef = useRef<Bot[]>([]); // avoid stale closure in setInterval

  // keep ref in sync
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  const fetchBots = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/bots`);
      if (!r.ok) throw new Error(`GET /api/bots -> ${r.status}`);
      const data: Bot[] = await r.json();
      setBots(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("fetchBots:", e);
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummaries = useCallback(async (list: Bot[]) => {
    if (!list.length) {
      setSummaries({});
      setStatuses({});
      return;
    }
    try {
      const pairs = await Promise.all(
        list.map(async (b) => {
          try {
            const r = await fetch(`${API_BASE}/api/bots/${encodeURIComponent(b.id)}/summary`);
            if (!r.ok) throw new Error(`summary ${b.id} -> ${r.status}`);
            const js: SummaryResp = await r.json();
            return [b.id, js.summary ?? {}, js.status ?? b.status ?? "stopped"] as const;
          } catch (e) {
            // keep previous if any
            return [b.id, summaries[b.id] ?? {}, statuses[b.id] ?? (b.status ?? "stopped")] as const;
          }
        })
      );
      const nextSummaries: Record<string, Summary> = {};
      const nextStatuses: Record<string, string> = {};
      for (const [id, sum, st] of pairs) {
        nextSummaries[id] = sum;
        nextStatuses[id] = st;
      }
      setSummaries(nextSummaries);
      setStatuses(nextStatuses);
    } catch (e) {
      console.warn("fetchSummaries:", e);
    }
  }, [summaries, statuses]);

  const loadAll = useCallback(async () => {
    await fetchBots();
  }, [fetchBots]);

  // load summaries whenever bots change
  useEffect(() => {
    fetchSummaries(bots);
  }, [bots, fetchSummaries]);

  // focus & polling
  useFocusEffect(
    useCallback(() => {
      loadAll();
      pollRef.current = setInterval(() => {
        const list = botsRef.current;
        if (list && list.length) fetchSummaries(list);
      }, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [loadAll, fetchSummaries])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const onOpen = useCallback(
    (b: Bot) => {
      // NOTE: if your navigator uses "Bot" instead of "BotDetail",
      // change the route name below to "Bot".
      nav.navigate("BotDetail", {
        id: b.id,               // also pass as 'id' for compatibility
        botId: b.id,
        name: b.name ?? b.id,   // and 'name'/'botName'
        botName: b.name ?? b.id,
        strategyId: b.strategyId,
        strategyName: b.strategyName,
      });
    },
    [nav]
  );

  const renderItem = useCallback(
    ({ item }: { item: Bot }) => {
      const s = summaries[item.id] ?? {};
      const liveStatus = statuses[item.id] ?? item.status ?? "—";
      return (
        <TouchableOpacity onPress={() => onOpen(item)} style={styles.card} activeOpacity={0.8}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={styles.title}>{item.name ?? item.id}</Text>
            <Text style={[styles.status, liveStatus === "running" ? styles.ok : styles.dim]}>
              {liveStatus}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Total P/L</Text>
            <Text style={styles.value}>{money(s.totalPL)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Locked</Text>
            <Text style={styles.value}>{money(s.locked)}</Text>
          </View>
          <View style={styles.rowLast}>
            <Text style={styles.label}>Current Portfolio Value</Text>
            <Text style={styles.value}>{money(s.currentValue)}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [onOpen, summaries, statuses]
  );

  const empty = useMemo(
    () => (
      <View style={styles.emptyBox}>
        {loading ? (
          <>
            <ActivityIndicator />
            <Text style={styles.dim}>Loading bots…</Text>
          </>
        ) : (
          <Text style={styles.dim}>No bots yet.</Text>
        )}
      </View>
    ),
    [loading]
  );

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={bots}
        keyExtractor={(x) => x.id}
        renderItem={renderItem}
        ListEmptyComponent={empty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9fb0c3" />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0f1620",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "white", fontWeight: "700", fontSize: 16 },
  status: { fontWeight: "700", fontSize: 12 },
  ok: { color: "#22c55e" },
  dim: { color: "#8ea0b2" },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowLast: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
  label: { color: "#9fb0c3" },
  value: { color: "white", fontWeight: "700" },

  emptyBox: { alignItems: "center", justifyContent: "center", marginTop: 60, gap: 10 },
});
