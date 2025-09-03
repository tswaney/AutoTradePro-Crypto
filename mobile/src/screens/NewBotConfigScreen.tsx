// mobile/src/screens/NewBotConfigScreen.tsx
// ✅ Restores dynamic per‑strategy config fields and adds robust Create/Edit flows
// ✅ Works when opened from BotDetailScreen via "Config" (edit) or from New Bot (create)
// ✅ Seeds defaults from /api/strategies/:id/config, merges existing bot config when editing
// ✅ Mirrors chosen strategy into STRATEGY_NAME for backend runner compatibility

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

// -----------------------------
// Types
// -----------------------------
type StrategyField =
  | { key: string; label: string; type: "string"; default?: string }
  | { key: string; label: string; type: "number"; step?: number; min?: number; max?: number; default?: number }
  | { key: string; label: string; type: "enum"; options: string[]; default?: string };

type StrategyConfig = {
  id: string;
  defaults?: Record<string, any>;
  fields?: StrategyField[];
};

type Mode = "create" | "edit";

type RouteParams = {
  mode?: Mode; // default "create"
  botId?: string; // required for edit
  status?: "running" | "stopped" | "starting" | "stopping";
  // When coming from a picker (create flow)
  pickedStrategy?: { id: string };
  strategyId?: string; // or a direct id
  prefill?: { name?: string; symbols?: string };
};

type BotRecord = {
  id: string;
  name: string;
  symbols: string[] | string;
  strategyId: string;
  config?: Record<string, any>;
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

function randomSuffix(len = 4) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

export default function NewBotConfigScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const {
    mode = "create",
    botId,
    status,
    pickedStrategy,
    strategyId: strategyIdFromParams,
    prefill,
  } = (route.params as RouteParams) || {};

  // -----------------------------
  // Local state
  // -----------------------------
  const [name, setName] = useState<string>(prefill?.name ?? `bot-${randomSuffix()}`);
  const [symbols, setSymbols] = useState<string>(prefill?.symbols ?? "BTCUSD, SOLUSD");
  const [strategyId, setStrategyId] = useState<string | undefined>(pickedStrategy?.id ?? strategyIdFromParams);
  const [schema, setSchema] = useState<StrategyConfig | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  // -----------------------------
  // Helpers
  // -----------------------------
  const canSubmit = useMemo(() => {
    const hasBase = name.trim().length > 0 && symbols.trim().length > 0;
    if (mode === "create") return hasBase && !!strategyId;
    // edit mode allows saving even if strategy isn't changing (bot stopped check happens on submit)
    return hasBase;
  }, [mode, name, symbols, strategyId]);

  const normalizeSymbols = (s: string) => s.replace(/\s+/g, "");

  const onChangeValue = useCallback((k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
  }, []);

  const seedFromSchema = useCallback((cfg: StrategyConfig) => {
    const seeded: Record<string, any> = {};
    (cfg.fields ?? []).forEach((f) => {
      if (f.type === "number") {
        const v = (f as any).default;
        if (typeof v === "number") seeded[f.key] = v;
      } else if (f.type === "string") {
        const v = (f as any).default;
        if (typeof v === "string") seeded[f.key] = v;
      } else if (f.type === "enum") {
        const v = (f as any).default ?? (f as any).options?.[0];
        if (v != null) seeded[f.key] = v;
      }
    });
    return seeded;
  }, []);

  // -----------------------------
  // Load existing bot when in EDIT mode
  // -----------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mode !== "edit" || !botId) return;
      try {
        const res = await fetch(`${API_BASE}/api/bots/${botId}`);
        if (!res.ok) throw new Error(`Fetch bot failed: ${res.status}`);
        const bot = (await res.json()) as BotRecord;
        if (!mounted) return;

        // Name & symbols
        setName(bot.name ?? `bot-${randomSuffix()}`);
        const syms = Array.isArray(bot.symbols) ? bot.symbols.join(", ") : String(bot.symbols ?? "");
        setSymbols(syms || "BTCUSD, SOLUSD");

        // Strategy
        setStrategyId(bot.strategyId);

        // Load strategy schema next, then merge existing config 👇
        const cfgRes = await fetch(`${API_BASE}/api/strategies/${bot.strategyId}/config`);
        if (!cfgRes.ok) throw new Error(`Config ${bot.strategyId} failed: ${cfgRes.status}`);
        const cfg = (await cfgRes.json()) as StrategyConfig;
        if (!mounted) return;
        setSchema(cfg);

        // 🔥 Merge defaults with existing bot.config (existing wins)
        const seeded = seedFromSchema(cfg);
        const merged = { ...seeded, ...(bot.config || {}) };

        // Ensure STRATEGY_NAME mirrors the chosen strategy id
        merged.STRATEGY_NAME = bot.strategyId;
        setValues(merged);
      } catch (err: any) {
        console.warn(err);
        Alert.alert("Error", String(err?.message ?? err));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [mode, botId, seedFromSchema]);

  // -----------------------------
  // In CREATE mode (or when user changes strategy in future), load schema & seed defaults
  // -----------------------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!strategyId) {
        if (mode === "create") {
          Alert.alert("Pick a strategy", "Please select a strategy first.", [
            { text: "OK", onPress: () => navigation.goBack() },
          ]);
        }
        return;
      }
      if (mode === "edit") return; // schema comes from the edit loader above
      try {
        const res = await fetch(`${API_BASE}/api/strategies/${strategyId}/config`);
        if (!res.ok) throw new Error(`Config ${strategyId} failed: ${res.status}`);
        const cfg = (await res.json()) as StrategyConfig;
        if (!mounted) return;
        setSchema(cfg);

        // 🔥 RESTORED: per‑field default seeding (from older implementation)
        const seeded = seedFromSchema(cfg);
        // Always mirror chosen strategy
        seeded.STRATEGY_NAME = strategyId;
        setValues(seeded);
      } catch (err: any) {
        console.warn(err);
        Alert.alert("Error", `No config available for this strategy.\n${String(err?.message ?? err)}`);
        setSchema(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [mode, strategyId, navigation, seedFromSchema]);

  // -----------------------------
  // Submit (Create or Save)
  // -----------------------------
  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;

    // Safety: in edit mode, do not allow changes while running
    if (mode === "edit" && status === "running") {
      Alert.alert("Stop bot first", "Stop the bot before saving configuration changes.");
      return;
    }

    try {
      setBusy(true);
      const bodyBase = {
        name: name.trim(),
        symbols: normalizeSymbols(symbols),
      } as any;

      if (mode === "create") {
        if (!strategyId) throw new Error("Missing strategyId");
        const body = {
          ...bodyBase,
          strategyId,
          // IMPORTANT: mirror into STRATEGY_NAME for backend runner parity
          config: { ...values, STRATEGY_NAME: strategyId },
        };
        const res = await fetch(`${API_BASE}/api/bots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        Alert.alert("Bot created", "Your bot was created. You can start it from the detail screen.", [
          { text: "OK", onPress: () => navigation.popToTop?.() },
        ]);
      } else {
        if (!botId) throw new Error("Missing botId for edit");
        const body = {
          ...bodyBase,
          // Only send strategyId if present (future‑proof if you add a picker in edit mode)
          ...(strategyId ? { strategyId } : {}),
          config: { ...values, ...(strategyId ? { STRATEGY_NAME: strategyId } : {}) },
        };
        const res = await fetch(`${API_BASE}/api/bots/${botId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        Alert.alert("Saved", "Bot configuration updated.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      }
    } catch (err: any) {
      console.warn("Submit error", err);
      Alert.alert("Error", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, mode, status, name, symbols, strategyId, values, botId, navigation]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>{mode === "edit" ? "Configure Bot" : "Configure Bot"}</Text>

          {/* Strategy (read‑only id for now; change via New Bot flow) */}
          <Text style={styles.label}>Strategy</Text>
          <TextInput
            style={[styles.input, styles.disabled]}
            value={strategyId ?? ""}
            editable={false}
            placeholder="strategy id"
            placeholderTextColor="#6b7280"
          />
          {mode === "edit" && status === "running" && (
            <Text style={styles.warn}>Bot is running — stop it to change strategy or symbols.</Text>
          )}

          {/* Name */}
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Symbols */}
          <Text style={styles.label}>Symbols</Text>
          <TextInput
            style={styles.input}
            value={symbols}
            onChangeText={setSymbols}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="BTCUSD, SOLUSD"
            placeholderTextColor="#6b7280"
          />

          {/* 🔥 RESTORED: Dynamic fields rendered from strategy schema (string/number/enum) */}
          {(schema?.fields ?? []).map((f) => {
            if (f.type === "string") {
              return (
                <View key={f.key}>
                  <Text style={styles.label}>{f.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={String(values[f.key] ?? "")}
                    onChangeText={(t) => onChangeValue(f.key, t)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              );
            }
            if (f.type === "number") {
              const raw = values[f.key];
              const numText = raw == null ? "" : String(raw);
              return (
                <View key={f.key}>
                  <Text style={styles.label}>{f.label}</Text>
                  <TextInput
                    style={styles.input}
                    value={numText}
                    onChangeText={(t) => {
                      const cleaned = t.replace(/[^0-9.\-]/g, "");
                      onChangeValue(f.key, cleaned);
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
              );
            }
            if (f.type === "enum") {
              const options = (f as any).options || [];
              const v = values[f.key] ?? options[0] ?? "";
              return (
                <View key={f.key}>
                  <Text style={styles.label}>{f.label}</Text>
                  <View style={styles.enumRow}>
                    {options.map((opt: string) => {
                      const selected = v === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.enumPill, selected ? styles.enumPillOn : styles.enumPillOff]}
                          onPress={() => onChangeValue(f.key, opt)}
                        >
                          <Text style={selected ? styles.enumTextOn : styles.enumTextOff}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            }
            return null;
          })}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => navigation.goBack()}
            disabled={busy}
          >
            <Text style={styles.btnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, canSubmit ? styles.btnPrimary : styles.btnDisabled]}
            disabled={!canSubmit || busy || (mode === "edit" && status === "running")}
            onPress={onSubmit}
          >
            <Text style={styles.btnText}>{mode === "edit" ? "Save Changes" : "Create Bot"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 80 },
  h1: { color: "white", fontWeight: "700", fontSize: 22, marginBottom: 12 },
  label: { color: "#9aa8b5", fontSize: 13, marginBottom: 6, marginTop: 10 },
  input: {
    borderRadius: 12,
    backgroundColor: "#0b1016",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
    color: "white",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  disabled: {
    color: "#8b93a1",
    backgroundColor: "rgba(6,10,14,0.9)",
  },
  warn: { color: "#f59e0b", marginTop: 6 },
  enumRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  enumPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  enumPillOn: { backgroundColor: "#1f3a8a" },
  enumPillOff: { backgroundColor: "#0b1016", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.1)" },
  enumTextOn: { color: "white", fontWeight: "700" },
  enumTextOff: { color: "#b9c3cf", fontWeight: "600" },

  footer: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    backgroundColor: "rgba(6,10,14,0.9)",
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: { backgroundColor: "#10151c", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)" },
  btnPrimary: { backgroundColor: "#2563eb" },
  btnDisabled: { backgroundColor: "#233044" },
  btnText: { color: "white", fontWeight: "600" },
});
