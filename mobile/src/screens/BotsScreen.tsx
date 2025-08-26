// mobile/src/screens/BotsScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { listBots, getBotSummary, type BotSummary } from "../api";

type BotListItem = { id: string; name?: string; status?: string };

// Visible tag so we can prove this screen is mounted
const BUILD_TAG = "BotsScreen v4";

export default function BotsScreen({ navigation }: any) {
  const [bots, setBots] = useState<BotListItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, BotSummary>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load bot list
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const b = await listBots();
        if (!alive) return;
        setBots(b);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Poll summaries every 3s whenever the list changes
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (!bots.length) return;
      const pairs = await Promise.all(
        bots.map(async (bot) => {
          try {
            const s = await getBotSummary(bot.id);
            return [bot.id, s] as const;
          } catch {
            return [bot.id, undefined] as const;
          }
        })
      );
      if (!alive) return;
      const map: Record<string, BotSummary> = {};
      for (const [id, s] of pairs) if (s) map[id] = s;
      setSummaries((prev) => ({ ...prev, ...map }));
      console.info("[BotsScreen] summaries:", map);
    };
    pull();
    const t = setInterval(pull, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bots]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const b = await listBots();
      setBots(b);
    } finally {
      setRefreshing(false);
    }
  };

  const openBot = (bot: BotListItem) =>
    navigation?.navigate?.("BotDetail", { id: bot.id, name: bot.name || bot.id });

  const currency = (n?: number | null) => {
    if (n == null) return "—";
    try {
      return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    } catch {
      return `$${Number(n || 0).toFixed(2)}`;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0c10" }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: "white", fontSize: 22, fontWeight: "800" }}>
          Bots <Text style={{ color: "#6aa2ff", fontSize: 12 }}>({BUILD_TAG})</Text>
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
            onPress={() => navigation?.navigate?.("NewBot")}
            style={{ marginHorizontal: 8 }}
          >
            <Text style={{ color: "#8ab4f8", fontWeight: "700" }}>New Bot</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={doRefresh} style={{ marginHorizontal: 8 }}>
            <Text style={{ color: "#8ab4f8", fontWeight: "700" }}>
              {refreshing ? "…" : "Refresh"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation?.navigate?.("Auth")}
            style={{ marginHorizontal: 8 }}
          >
            <Text style={{ color: "#8ab4f8", fontWeight: "700" }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && bots.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              summary={summaries[bot.id]}
              setSummary={(s) =>
                setSummaries((prev) => ({ ...prev, [bot.id]: s }))
              }
              onPress={() => openBot(bot)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function StatusPill({ status }: { status?: string }) {
  const isRunning = (status || "").toLowerCase() === "running";
  const bg = isRunning ? "#123e9c" : "#3d3d3d";
  const fg = isRunning ? "#cfe0ff" : "#d9e1e8";
  const label = isRunning ? "running" : "stopped";
  return (
    <View
      style={{
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Metric({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <View style={{ width: "33.3%" }}>
      <Text
        style={{ color: "#a6adb4", fontSize: 12, textAlign: align, marginBottom: 2 }}
      >
        {label}
      </Text>
      <Text
        style={{ color: "white", fontWeight: "700", fontSize: 14, textAlign: align }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function BotCard({
  bot,
  summary,
  setSummary,
  onPress,
}: {
  bot: BotListItem;
  summary?: BotSummary;
  setSummary: (s: BotSummary) => void;
  onPress: () => void;
}) {
  // Self-fetch once so cards never stay blank
  useEffect(() => {
    let alive = true;
    (async () => {
      if (summary) return;
      try {
        const s = await getBotSummary(bot.id);
        if (alive && s) setSummary(s);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [bot.id]);

  const currency = (n?: number | null) => {
    if (n == null) return "—";
    try {
      return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    } catch {
      return `$${Number(n || 0).toFixed(2)}`;
    }
  };

  const pl24hAvg = summary?.pl24hAvg ?? summary?.pl24h ?? summary?.dayPL ?? null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        backgroundColor: "#13161b",
        borderRadius: 14,
        padding: 14,
        marginVertical: 6,
      }}
    >
      {/* top row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>
          {bot.name || bot.id}
        </Text>
        <StatusPill status={bot.status} />
      </View>

      {/* metrics row */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          backgroundColor: "#0e1116",
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
        }}
      >
        <Metric label="24h P/L (avg)" value={pl24hAvg == null ? "—" : currency(pl24hAvg)} />
        <Metric label="Current Value" value={summary ? currency(summary.currentValue) : "—"} />
        <Metric label="Total P/L" value={summary ? currency(summary.totalPL) : "—"} align="right" />
      </View>
    </TouchableOpacity>
  );
}
