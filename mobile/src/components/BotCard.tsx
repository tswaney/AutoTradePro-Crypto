// mobile/src/components/BotCard.tsx
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { useSnack } from "./Snack";
import { apiGet, apiPost, apiPatch } from "../api"; // adjust if your paths differ

export type Bot = {
  botId: string;
  status: "running" | "stopped" | string;
  mode?: string;
  aiEnabled?: boolean;
  strategyFile?: string | null;
  symbols?: string[];
  updatedAt?: string;
};

export default function BotCard({
  bot,
  onRefresh,
}: {
  bot: Bot;
  onRefresh: () => Promise<void> | void;
}) {
  const snack = useSnack();

  const start = useAsyncAction(async () => {
    await apiPost(`/bots/${bot.botId}/start`, {
      strategyFile: bot.strategyFile ?? "moderateRetainMode_v4.js",
      symbols: bot.symbols ?? ["BTCUSD", "SOLUSD"],
      mode: bot.mode ?? "demo",
      aiEnabled: bot.aiEnabled ?? true,
    });
    snack.show("Bot started");
    await onRefresh();
  });

  const stop = useAsyncAction(async () => {
    await apiPost(`/bots/${bot.botId}/stop`, {});
    snack.show("Bot stopped");
    await onRefresh();
  });

  const restart = useAsyncAction(async () => {
    await apiPost(`/bots/${bot.botId}/restart`, {});
    snack.show("Bot restarted");
    await onRefresh();
  });

  const logs = () => {
    // navigate to your logs screen if you have one; otherwise no-op
    snack.show("Opening logs…");
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{bot.botId}</Text>
      <Text style={styles.meta}>
        {bot.strategyFile ?? "—"} • {(bot.symbols || []).join(", ") || "—"}
      </Text>
      <Text style={styles.meta}>
        Status: {bot.status} • Mode: {bot.mode || "—"}
      </Text>

      <View style={styles.row}>
        <ButtonSmall label="Start" onPress={start.run} disabled={start.busy || stop.busy || restart.busy} />
        <ButtonSmall label="Stop" onPress={stop.run} disabled={start.busy || stop.busy || restart.busy} />
        <ButtonSmall label="Restart" onPress={restart.run} disabled={start.busy || stop.busy || restart.busy} />
        <ButtonSmall label="Logs" onPress={logs} />
      </View>
    </View>
  );
}

function ButtonSmall({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 10,
    borderColor: "#ddd",
    borderWidth: 1,
  },
  title: { fontWeight: "700", color: "#111" },
  meta: { color: "#555", marginTop: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#0b5fff0f",
    borderWidth: 1, borderColor: "#0b5fff44",
  },
  btnPressed: { backgroundColor: "#0b5fff22" },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#0b5fff", fontWeight: "700" },
  btnTextDisabled: { color: "#7a9cff" },
});
