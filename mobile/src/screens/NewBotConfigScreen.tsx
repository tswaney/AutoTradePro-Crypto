import React, { useCallback, useEffect, useState } from "react";
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

type StrategyField =
  | { key: string; label: string; type: "string"; default?: string }
  | { key: string; label: string; type: "number"; step?: number; min?: number; max?: number; default?: number }
  | { key: string; label: string; type: "enum"; options: string[]; default?: string };

type StrategyConfig = {
  id: string;
  defaults?: Record<string, any>;
  fields?: StrategyField[];
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

  // accept either { pickedStrategy: {id,...} } or a direct { strategyId }
  const initialStrategyId: string | undefined =
    route.params?.pickedStrategy?.id ?? route.params?.strategyId;

  const [name, setName] = useState(`bot-${randomSuffix()}`);
  const [symbols, setSymbols] = useState("BTCUSD, SOLUSD");
  const [strategyId, setStrategyId] = useState<string | undefined>(initialStrategyId);
  const [schema, setSchema] = useState<StrategyConfig | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  // If we somehow got here without a strategy, guide the user back gracefully
  useEffect(() => {
    if (!strategyId) {
      Alert.alert("Pick a strategy", "Please select a strategy first.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    }
  }, [strategyId, navigation]);

  // fetch strategy schema (fields/defaults)
  useEffect(() => {
    let mounted = true;
    async function run() {
      if (!strategyId) return;
      try {
        const res = await fetch(`${API_BASE}/api/strategies/${strategyId}/config`);
        if (!res.ok) throw new Error(`Config ${strategyId} failed: ${res.status}`);
        const cfg = (await res.json()) as StrategyConfig;
        if (!mounted) return;
        setSchema(cfg);

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
        setValues(seeded);
      } catch (err: any) {
        console.warn(err);
        Alert.alert("Error", `No config available for this strategy.\n${String(err?.message ?? err)}`);
        setSchema(null);
      }
    }
    run();
    return () => {};
  }, [strategyId]);

  const canCreate = !!strategyId && name.trim().length > 0 && symbols.trim().length > 0;

  const onChangeValue = useCallback((k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
  }, []);

  // robust "back to bots" that does not depend on route names
  const goBackToBots = useCallback(() => {
    // First try to pop this stack back to its first screen (your Bots list).
    navigation.popToTop?.();

    // In case this screen sits inside a child navigator,
    // try to also pop the parent stack to top (no-op if absent).
    const parent = (navigation as any).getParent?.();
    parent?.popToTop?.();
  }, [navigation]);

  const onCreate = useCallback(async () => {
    if (!canCreate || !strategyId) return;

    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        symbols: symbols.replace(/\s+/g, ""),
        strategyId,
        // IMPORTANT: mirror the chosen strategy into STRATEGY_NAME
        // so the backend runner picks the correct module.
        config: { ...values, STRATEGY_NAME: strategyId },
      };
      const res = await fetch(`${API_BASE}/api/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      Alert.alert("Bot created", "Your bot was created and is currently stopped. You can start it from the detail screen.", [
        {
          text: "OK",
          onPress: () => {
            // Let the alert fully close, then pop back to the top.
            setTimeout(goBackToBots, 50);
          },
        },
      ]);
    } catch (err: any) {
      console.warn("Create bot error:", err);
      Alert.alert("Error", String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [canCreate, strategyId, name, symbols, values, goBackToBots]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>Configure Bot</Text>

          {/* Strategy (read-only id chosen in prior screen) */}
          <Text style={styles.label}>Strategy</Text>
          <TextInput
            style={[styles.input, styles.disabled]}
            value={strategyId ?? ""}
            editable={false}
            placeholder="strategy id"
            placeholderTextColor="#6b7280"
          />

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
          />

          {/* Dynamic fields from strategy schema */}
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

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => navigation.goBack()}
            disabled={busy}
          >
            <Text style={styles.btnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, canCreate ? styles.btnPrimary : styles.btnDisabled]}
            disabled={!canCreate || busy}
            onPress={onCreate}
          >
            <Text style={styles.btnText}>Create Bot</Text>
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
