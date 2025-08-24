import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

type Summary = {
  beginningPortfolioValue?: number | null;
  duration?: number | null;
  buys?: number | null;
  sells?: number | null;
  totalPL?: number | null;
  cash?: number | null;
  cryptoMkt?: number | null;
  locked?: number | null;
  currentValue?: number | null;
  dayPL?: number | null; // 24h P/L
};

type SummaryResp = {
  id: string;
  name: string;
  status: "running" | "stopped" | "unknown" | string;
  strategyId?: string;
  strategyName?: string;
  summary?: Summary;
};

function fmtMoney(v?: number | null) {
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

async function robustPost(urls: string[]): Promise<Response> {
  let lastErr: any;
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "POST" });
      if (r.ok) return r;
      lastErr = new Error(`${url} -> ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export default function BotDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  // Resolve params
  const extractId = (p: any): string | undefined =>
    p?.botId ?? p?.id ?? p?.bot?.id ?? p?.botID ?? p?.bot_id;
  const extractName = (p: any): string | undefined =>
    p?.botName ?? p?.name ?? p?.bot?.name;
  const extractStrategy = (p: any): { id?: string; name?: string } => ({
    id: p?.strategyId ?? p?.strategy?.id,
    name: p?.strategyName ?? p?.strategy?.name,
  });

  const [botId, setBotId] = useState<string | undefined>(() => extractId(route.params));
  const [botName, setBotName] = useState<string | undefined>(() => extractName(route.params));
  const initialStrat = extractStrategy(route.params ?? {});
  const [strategyId, setStrategyId] = useState<string | undefined>(initialStrat.id);
  const [strategyLabel, setStrategyLabel] = useState<string | undefined>(initialStrat.name ?? initialStrat.id);

  const [status, setStatus] = useState<"running" | "stopped" | "unknown">("unknown");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<string>("No log output yet…");
  const [busy, setBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = extractId(route.params);
    const nm = extractName(route.params);
    const st = extractStrategy(route.params ?? {});
    if (id && id !== botId) setBotId(id);
    if (nm && nm !== botName) setBotName(nm);
    if (st.id && st.id !== strategyId) setStrategyId(st.id);
    const label = st.name ?? st.id;
    if (label && label !== strategyLabel) setStrategyLabel(label);
  }, [route.params, botId, botName, strategyId, strategyLabel]);

  const loadOnce = useCallback(async () => {
    if (!botId) return;
    try {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const res = await fetch(`${API_BASE}/api/bots/${botId}/summary`, { signal: ac.signal });
      if (res.ok) {
        const data: SummaryResp = await res.json();
        setStatus((data.status as any) ?? "unknown");
        setSummary(data.summary ?? null);
        if (!botName && data?.name) setBotName(data.name);
        if (!strategyId && data?.strategyId) setStrategyId(data.strategyId);
        const label = data?.strategyName ?? data?.strategyId;
        if (label && label !== strategyLabel) setStrategyLabel(label);
      }
      const r2 = await fetch(`${API_BASE}/api/bots/${botId}/logs?limit=200`, { signal: ac.signal });
      if (r2.ok) {
        const data = await r2.json();
        const text = (data?.lines ?? []).join("\n").trim();
        setLogs(text.length ? text : "No log output yet…");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("loadOnce:", err);
    }
  }, [botId, botName, strategyId, strategyLabel]);

  useFocusEffect(
    useCallback(() => {
      loadOnce();
      pollRef.current = setInterval(loadOnce, 2500);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        abortRef.current?.abort();
      };
    }, [loadOnce])
  );

  const onStart = useCallback(async () => {
    if (!botId) {
      Alert.alert("Missing bot id", "Cannot start because bot id was not provided.");
      return;
    }
    setBusy(true);
    try {
      const urls = [
        `${API_BASE}/api/bots/${botId}/start`,
        `${API_BASE}/api/bot/${botId}/actions/start`,
      ];
      const r = await robustPost(urls);
      if (!r.ok) throw new Error(`Start failed: ${r.status}`);
      setStatus("running");
      Alert.alert("Bot started", `${botName ?? botId} is starting…`);
      setTimeout(loadOnce, 300);
    } catch (err: any) {
      console.warn("start err:", err);
      Alert.alert("Error", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [botId, botName, loadOnce]);

  const onStop = useCallback(async () => {
    if (!botId) {
      Alert.alert("Missing bot id", "Cannot stop because bot id was not provided.");
      return;
    }
    setBusy(true);
    try {
      const urls = [
        `${API_BASE}/api/bots/${botId}/stop`,
        `${API_BASE}/api/bot/${botId}/actions/stop`,
      ];
      const r = await robustPost(urls);
      if (!r.ok) throw new Error(`Stop failed: ${r.status}`);
      setStatus("stopped");
      Alert.alert("Bot stopped", `${botName ?? botId} has stopped.`);
      setTimeout(loadOnce, 300);
    } catch (err: any) {
      console.warn("stop err:", err);
      Alert.alert("Error", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [botId, botName, loadOnce]);

  const onDelete = useCallback(async () => {
    if (!botId) {
      Alert.alert("Missing bot id", "Cannot delete because bot id was not provided.");
      return;
    }
    Alert.alert("Delete bot", `Delete ${botName ?? botId}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const r = await fetch(`${API_BASE}/api/bots/${botId}`, { method: "DELETE" });
            if (!r.ok) {
              const r2 = await fetch(`${API_BASE}/api/bots/${botId}/delete`, { method: "POST" });
              if (!r2.ok) throw new Error(`Delete failed: ${r.status}/${r2.status}`);
            }
            setTimeout(() => {
              navigation.popToTop?.();
              (navigation as any).getParent?.()?.popToTop?.();
            }, 50);
          } catch (err: any) {
            console.warn("delete err:", err);
            Alert.alert("Error", String(err?.message ?? err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [botId, botName, navigation]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Strategy on top, bot name below */}
        <Text style={styles.h1}>{strategyLabel ?? "Strategy"}</Text>
        <Text style={styles.sub}>{botName ?? botId ?? "—"}</Text>

        {!botId && (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>No bot id provided</Text>
            <Text style={styles.warnText}>
              Open this screen from the Bots list, or navigate with{" "}
              <Text style={styles.code}>navigate('BotDetail', {'{ botId }'})</Text>.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Total Portfolio Summary</Text>
          <Row label="Beginning Portfolio Value" value={fmtMoney(summary?.beginningPortfolioValue)} />
          <Row label="Duration" value={summary?.duration ?? "—"} />
          <Row label="Buys" value={summary?.buys ?? "—"} />
          <Row label="Sells" value={summary?.sells ?? "—"} />
          <Row label="24h P/L" value={fmtMoney(summary?.dayPL)} />
          <Row label="Total P/L" value={fmtMoney(summary?.totalPL)} />
          <Row label="Cash" value={fmtMoney(summary?.cash)} />
          <Row label="Crypto (mkt)" value={fmtMoney(summary?.cryptoMkt)} />
          <Row label="Locked" value={fmtMoney(summary?.locked)} />
          <Row label="Current Portfolio Value" value={fmtMoney(summary?.currentValue)} />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Logs</Text>
        <View style={styles.logBox}>
          {logs === null ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.dim}>Loading logs…</Text>
            </View>
          ) : (
            <Text style={styles.logText}>{logs}</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, (!botId || busy) && styles.btnDisabled]}
          onPress={onStart}
          disabled={!botId || busy}
        >
          <Text style={styles.btnText}>Start</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, (!botId || busy) && styles.btnDisabled]}
          onPress={onStop}
          disabled={!botId || busy}
        >
          <Text style={styles.btnText}>Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnDanger, (!botId || busy) && styles.btnDisabled]}
          onPress={onDelete}
          disabled={!botId || busy}
        >
          <Text style={styles.btnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: "white", fontWeight: "800", fontSize: 22 },
  sub: { color: "#8ea0b2", marginTop: 4, marginBottom: 12, fontSize: 12 },

  warnBox: {
    backgroundColor: "#2b1f15",
    borderColor: "#b45309",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  warnTitle: { color: "#f59e0b", fontWeight: "700", marginBottom: 4 },
  warnText: { color: "#fffbeb" },
  code: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: "#fcd34d" },

  card: {
    backgroundColor: "#0f1620",
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTitle: { color: "white", fontWeight: "700", fontSize: 16, marginBottom: 10 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowLabel: { flex: 1, color: "#9fb0c3" },
  rowValue: { color: "white", fontWeight: "700" },

  sectionTitle: { color: "white", fontWeight: "700", fontSize: 16 },
  logBox: {
    backgroundColor: "#0b1118",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.06)",
    minHeight: 160,
  },
  logText: {
    color: "#cfe1f5",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
  },

  footer: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(6,10,14,0.95)",
  },
  btn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnPrimary: { backgroundColor: "#2563eb" },
  btnGhost: { backgroundColor: "#233044" },
  btnDanger: { backgroundColor: "#ef4444" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "white", fontWeight: "700" },

  center: { alignItems: "center", justifyContent: "center", gap: 6 },
  dim: { color: "#8ea0b2" },
});
