import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from "react-native";
import { apiGet, apiPost } from "../api";

type Summary = {
  beginningPortfolioValue?: number | null;
  duration?: string | number | null;
  buys?: number | null;
  sells?: number | null;
  totalPL?: number | null;
  cash?: number | null;
  cryptoMkt?: number | null;
  locked?: number | null;
  currentValue?: number | null;
  dayPL?: number | null;
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

export default function BotDetailScreen({ route, navigation }: any) {
  const botId: string = route?.params?.id || route?.params?.botId;
  const botName: string = route?.params?.name || route?.params?.botName || botId;
  const strategyName: string =
    route?.params?.strategyName || route?.params?.strategyId || "Unknown";

  const [status, setStatus] = useState<"running" | "stopped" | string>("stopped");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!botId) return;
    try {
      const s = await apiGet<{ id: string; status: string; summary: Summary }>(
        `/api/bots/${encodeURIComponent(botId)}/summary`
      );
      setStatus((s as any).status || "stopped");
      setSummary(s.summary || null);
    } catch (err: any) {
      console.warn("summary err:", err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [botId]);

  const start = useCallback(async () => {
    if (!botId) return;
    setWorking(true);
    try {
      await apiPost(`/api/bots/${encodeURIComponent(botId)}/start`);
      setStatus("running");
      setTimeout(fetchSummary, 300);
    } catch (err: any) {
      Alert.alert("Error", `start err: ${String(err?.message || err)}`);
    } finally {
      setWorking(false);
    }
  }, [botId, fetchSummary]);

  const stop = useCallback(async () => {
    if (!botId) return;
    setWorking(true);
    try {
      await apiPost(`/api/bots/${encodeURIComponent(botId)}/stop`);
      setStatus("stopped");
      setTimeout(fetchSummary, 300);
    } catch (err: any) {
      Alert.alert("Error", `stop err: ${String(err?.message || err)}`);
    } finally {
      setWorking(false);
    }
  }, [botId, fetchSummary]);

  const confirmDelete = useCallback(() => {
    if (!botId) return;
    Alert.alert(
      "Delete Bot",
      `Are you sure you want to delete “${botName}”? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setWorking(true);
            try {
              try {
                await apiPost(`/api/bots/${encodeURIComponent(botId)}/delete`);
              } catch {
                await fetch(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
              }
              navigation.goBack();
            } catch (err: any) {
              Alert.alert("Error", `delete err: ${String(err?.message || err)}`);
            } finally {
              setWorking(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [botId, botName, navigation]);

  useEffect(() => {
    fetchSummary();
    pollRef.current && clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchSummary, 4000);
    return () => {
      pollRef.current && clearInterval(pollRef.current);
    };
  }, [fetchSummary]);

  const disabledStart = working || status === "running";
  const disabledStop = working || status !== "running";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 140 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Text style={styles.strategyTitle}>{strategyName}</Text>
        <Text style={styles.botSubtitle}>{botName}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Total Portfolio Summary</Text>
        <Row k="Beginning Portfolio Value" v={money(summary?.beginningPortfolioValue ?? null)} />
        <Row k="Duration" v={`${summary?.duration ?? "—"}`} />
        <Row k="Buys" v={`${summary?.buys ?? 0}`} />
        <Row k="Sells" v={`${summary?.sells ?? 0}`} />
        <Row k="24h P/L" v={money(summary?.dayPL ?? 0)} />
        <Row k="Total P/L" v={money(summary?.totalPL ?? 0)} />
        <Row k="Cash" v={money(summary?.cash ?? null)} />
        <Row k="Crypto (mkt)" v={money(summary?.cryptoMkt ?? null)} />
        <Row k="Locked" v={summary?.locked == null ? "—" : money(summary?.locked)} />
        <Row k="Current Portfolio Value" v={money(summary?.currentValue ?? 0)} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Logs</Text>
        <View style={styles.logBox}>
          {loading ? <ActivityIndicator /> : <Text style={styles.logText}>No log output yet…</Text>}
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="Start" onPress={start} disabled={disabledStart} kind="primary" />
        <Button label="Stop" onPress={stop} disabled={disabledStop} />
        <Button label="Delete" onPress={confirmDelete} kind="danger" disabled={working} />
      </View>
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  kind = "secondary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
}) {
  const bg =
    kind === "primary" ? "#2563eb" : kind === "danger" ? "#ef4444" : "#334155";
  const bgDisabled =
    kind === "primary" ? "rgba(37,99,235,0.45)" : kind === "danger" ? "rgba(239,68,68,0.45)" : "rgba(51,65,85,0.45)";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!!disabled}
      style={[styles.btn, { backgroundColor: disabled ? bgDisabled : bg }]}
    >
      <Text style={styles.btnLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  strategyTitle: { color: "white", fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
  botSubtitle: { color: "#9aa0a6", fontSize: 12, marginTop: 2 },
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    backgroundColor: "#121821",
    borderRadius: 14,
    borderColor: "#1f2937",
    borderWidth: 1,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  k: { color: "#9aa0a6" },
  v: { color: "white", fontWeight: "700" },
  logBox: { borderWidth: 1, borderColor: "#1f2937", borderRadius: 10, padding: 10, minHeight: 120, backgroundColor: "#0b1118" },
  logText: { color: "#cfe1f5", fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "Courier" }) },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, gap: 10, flexDirection: "row",
    backgroundColor: "rgba(9,13,19,0.92)", borderTopWidth: 1, borderTopColor: "#1f2937",
  },
  btn: { flex: 1, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  btnLabel: { color: "white", fontWeight: "700" },
});
