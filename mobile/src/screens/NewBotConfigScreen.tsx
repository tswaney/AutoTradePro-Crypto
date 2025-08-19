import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";

type StrategyMeta = { id: string; name: string; version?: string; description?: string };
type RouteParams = { draft?: { name: string; symbols: string }; strategy?: StrategyMeta };

// Robust defaults (simulator/device)
const iosLocal = "http://127.0.0.1:4000";
const androidLocal = "http://10.0.2.2:4000";
const DEFAULT_BASE = Platform.select({ ios: iosLocal, android: androidLocal, default: "http://localhost:4000" })!;
const API_BASE =
  (process as any)?.env?.EXPO_PUBLIC_API_BASE ||
  (global as any)?.EXPO_PUBLIC_API_BASE ||
  DEFAULT_BASE;

export default function NewBotConfigScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { draft, strategy } = (route?.params || {}) as RouteParams;

  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- debug tray (starts visible) ---
  const [showDebug, setShowDebug] = useState(true);
  const tapsRef = useRef(0);
  const [logs, setLogs] = useState<string[]>([]);
  const log = (m: string, o?: any) => {
    const s = `${new Date().toISOString()}  ${m}${o === undefined ? "" : " " + safeInspect(o)}`;
    console.log("[NewBotConfig]", s);
    setLogs((prev) => [s, ...prev].slice(0, 250));
  };

  useEffect(() => {
    log("API BASE =>", API_BASE);
    if (!strategy?.id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `${API_BASE}/api/strategies/${encodeURIComponent(strategy.id)}/config`;
        log("GET defaults", url);
        const txt = await fetchWithTimeoutText(url);
        const json = safeJSON(txt);
        log("defaults ok", json);
        const defaults = (json as any)?.defaults || {};
        const str: Record<string, string> = {};
        Object.entries(defaults).forEach(([k, v]) => (str[k] = String(v)));
        if (alive) setCfg(str);
      } catch (e: any) {
        log("defaults error", e?.message || String(e));
        setError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [strategy?.id]);

  const kvPairs = useMemo(() => Object.entries(cfg), [cfg]);
  const updateKey = (k: string, v: string) => setCfg((s) => ({ ...s, [k]: v }));

  const createBot = async () => {
    log("Create Bot pressed");
    const missing =
      !draft?.name?.trim() ? "name" :
      !draft?.symbols?.trim() ? "symbols" :
      !strategy?.id ? "strategy" : "";

    if (missing) {
      const msg = `Missing data: ${missing}`;
      log("guard fail", { missing, draft, strategyId: strategy?.id });
      Alert.alert("Missing data", msg);
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: draft!.name.trim(),
        strategyId: strategy!.id,
        config: { ...cfg, SYMBOLS: draft!.symbols.trim() },
      };

      // avoid stringify traps in log (BigInt/cycles)
      log("POST /api/bots payload keys", Object.keys(body.config).length);

      const url = `${API_BASE}/api/bots`;
      const { ok, status, text } = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      log("POST response meta", { ok, status, len: text?.length });

      if (!ok) throw new Error(`HTTP ${status}: ${text?.slice(0, 200) || "no body"}`);

      const json = safeJSON(text);
      const id = (json as any)?.id || guessIdFromText(text);
      log("parsed id", id);

      if (!id) throw new Error(`Create bot response missing 'id': ${text?.slice(0, 200)}`);

      Alert.alert("Bot created", `ID: ${id}`, [
        { text: "OK", onPress: () => nav.replace("BotDetail", { id }) },
      ]);
    } catch (e: any) {
      log("Create failed", e?.message || String(e));
      Alert.alert("Create failed", e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onTitleTap = () => {
    tapsRef.current += 1;
    if (tapsRef.current >= 5) {
      setShowDebug((s) => !s);
      tapsRef.current = 0;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1117" }}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Text style={styles.title} onPress={onTitleTap}>Configure Strategy</Text>
          <Text style={styles.subTitle}>
            {strategy?.name || strategy?.id} {strategy?.version ? `v${strategy.version}` : ""}
          </Text>
          {!!draft && (
            <Text style={styles.caption}>
              Draft: <Text style={styles.bold}>{draft.name}</Text> — Symbols: {draft.symbols}
            </Text>
          )}

          {loading ? (
            <ActivityIndicator />
          ) : error ? (
            <Text style={styles.error}>Failed to load defaults: {error}</Text>
          ) : kvPairs.length === 0 ? (
            <Text style={{ opacity: 0.7, marginTop: 8 }}>No configurable options for this strategy.</Text>
          ) : (
            <FlatList
              data={kvPairs}
              keyExtractor={([k]) => k}
              renderItem={({ item: [k, v] }) => (
                <View style={styles.row}>
                  <Text style={styles.key}>{k}</Text>
                  <TextInput
                    value={v}
                    onChangeText={(t) => updateKey(k, t)}
                    style={styles.value}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={/^[0-9.\-]+$/.test(v) ? "decimal-pad" : "default"}
                  />
                </View>
              )}
              style={{ marginTop: 8 }}
            />
          )}

          <View style={styles.btnRow}>
            <Pressable style={[styles.btn, styles.btnSecondary]} onPress={() => nav.goBack()}>
              <Text style={styles.btnText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.7 }]}
              disabled={submitting}
              onPress={() => { void createBot().catch(() => {}); }}
            >
              <Text style={[styles.btnText, styles.btnTextPrimary]}>{submitting ? "Creating..." : "Create Bot"}</Text>
            </Pressable>
          </View>

          {showDebug && (
            <View style={styles.debugBox}>
              <Text style={styles.debugTitle}>Debug</Text>
              <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ paddingBottom: 6 }}>
                {logs.map((l, i) => (
                  <Text key={i} style={styles.debugLine}>{l}</Text>
                ))}
              </ScrollView>
              <Text style={styles.debugHint}>Tap “Configure Strategy” 5× to toggle this box.</Text>
              <Text style={styles.debugHint}>API_BASE = {API_BASE}</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* -------- helpers -------- */
function safeJSON(t?: string) { try { return t ? JSON.parse(t) : {}; } catch { return {}; } }
function guessIdFromText(t?: string) {
  if (!t) return null;
  const m = /"id"\s*:\s*"([^"]+)"/.exec(t) || /id[:=]\s*([A-Za-z0-9._-]+)/.exec(t);
  return m?.[1] || null;
}
function safeInspect(o: any) {
  try { return JSON.stringify(o); } catch { return String(o); }
}
async function fetchWithTimeoutText(url: string, ms = 10000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal }); const t = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${t?.slice(0, 200) || "no body"}`); return t; }
  finally { clearTimeout(to); }
}
async function fetchWithTimeout(url: string, init?: RequestInit, ms = 10000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { ...(init || {}), signal: ctrl.signal });
        const t = await r.text().catch(() => ""); return { ok: r.ok, status: r.status, text: t }; }
  finally { clearTimeout(to); }
}

/* -------- styles -------- */
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10, backgroundColor: "#0B1117" },
  title: { fontSize: 22, fontWeight: "600", color: "#E6EDF3" },
  subTitle: { fontSize: 16, opacity: 0.85, color: "#E6EDF3" },
  caption: { fontSize: 13, opacity: 0.75, marginTop: 2, color: "#97A3B6" },
  bold: { fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 6 },
  key: { flex: 0.9, fontSize: 13, opacity: 0.85, color: "#E6EDF3" },
  value: {
    flex: 1.1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(127,127,127,0.07)",
    fontSize: 15, color: "#E6EDF3",
  },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  btnPrimary: { backgroundColor: "#4C82F7", borderColor: "#4C82F7" },
  btnSecondary: {},
  btnText: { fontSize: 16, color: "#E6EDF3" },
  btnTextPrimary: { color: "white" },
  error: { color: "#f55", marginVertical: 6 },
  debugBox: {
    marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#2A3340",
    borderRadius: 10, padding: 10, backgroundColor: "#0E131A",
  },
  debugTitle: { color: "#E6EDF3", fontWeight: "700", marginBottom: 6 },
  debugLine: { color: "#9DB0C5", fontSize: 12, marginBottom: 2 },
  debugHint: { color: "#6E7E94", fontSize: 11, marginTop: 4 },
});
