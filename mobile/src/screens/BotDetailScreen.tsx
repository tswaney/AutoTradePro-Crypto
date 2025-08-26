// mobile/src/screens/BotDetailScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Alert,
} from "react-native";
import {
  getBotOverview,
  getBotLog,
  startBot,
  stopBot,
  deleteBot,
  type BotSummary,
} from "../api";

type Props = {
  route: { params?: { id?: string; name?: string; strategy?: string } };
  navigation: any;
};

export default function BotDetailScreen({ route, navigation }: Props) {
  const botId = route?.params?.id || "default";
  const botName = route?.params?.name || botId;

  const [summary, setSummary] = useState<BotSummary | null>(null);
  const [logText, setLogText] = useState<string>("No log output yet…");
  const [loading, setLoading] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Strategy label: prefer summary.strategy; fallback to parsed log, then route param
  const [strategy, setStrategy] = useState<string>(
    (route?.params?.strategy || "—").trim()
  );

  // Poll overview (status + summary) and logs every 3s
  useEffect(() => {
    let alive = true;

    const pull = async () => {
      try {
        const o = await getBotOverview(botId);
        if (!alive) return;
        setSummary(o.summary);
        setIsRunning((o.status || "").toLowerCase() === "running");
        // If strategy arrives in summary, lock it in
        if (o.summary.strategy && o.summary.strategy !== "—") {
          setStrategy(o.summary.strategy);
        }
      } catch {
        if (alive) setIsRunning(false);
      }
      try {
        const txt = await getBotLog(botId, 300);
        if (!alive) return;
        setLogText(txt || "No log output yet…");
        // parse strategy from log only if we don't already have it
        if (!summary?.strategy) {
          const m = /Auto-selected strategy:\s*(.+)/i.exec(txt);
          if (m?.[1]) setStrategy(m[1].trim());
        }
      } catch {
        if (alive) setLogText("No log output yet…");
      }
    };

    pull();
    const id = setInterval(pull, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [botId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== Logs: Freeze / Unfreeze + autoscroll-to-bottom behavior =====
  const logScrollRef = useRef<ScrollView>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);

  const onLogContentSizeChange = () => {
    if (autoScroll && logScrollRef.current) {
      logScrollRef.current.scrollToEnd({ animated: true });
    }
  };

  const onLogScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const threshold = 24; // px tolerance from bottom
    const atBottom =
      contentOffset.y + layoutMeasurement.height >=
      contentSize.height - threshold;
    setIsAtBottom(atBottom);
    if (!atBottom && autoScroll) setAutoScroll(false);
  };

  const onFreezeToggle = () => setAutoScroll((v) => !v);
  const jumpToBottom = () => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollToEnd({ animated: true });
      setAutoScroll(true);
    }
  };

  // ===== Helpers =====
  function currency(n?: number | null) {
    if (n == null) return "—";
    try {
      return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    } catch {
      return `$${Number(n || 0).toFixed(2)}`;
    }
  }
  const displayMoney = (v?: number | null) => (v == null ? "—" : currency(v));

  const pl24hAvgDisplay = useMemo(() => {
    const v = summary?.pl24hAvg ?? summary?.pl24h ?? summary?.dayPL ?? undefined;
    return displayMoney(v);
  }, [summary]);

  // ===== Actions =====
  async function onStart() {
    setLoading(true);
    try {
      await startBot(botId);
      setIsRunning(true);
    } catch (e) {
      Alert.alert("Start failed", String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }
  async function onStop() {
    setLoading(true);
    try {
      await stopBot(botId);
      setIsRunning(false);
    } catch (e) {
      Alert.alert("Stop failed", String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }
  async function onDelete() {
    if (isRunning) {
      Alert.alert("Cannot delete while running", "Stop the bot first.");
      return;
    }
    Alert.alert(
      "Delete Bot",
      `Are you sure you want to delete "${botName}"? This removes its data folder.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await deleteBot(botId);
              navigation?.goBack?.();
            } catch (e) {
              Alert.alert("Delete failed", String(e instanceof Error ? e.message : e));
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0c10" }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* Title */}
        <View style={{ marginBottom: 8 }}>
          <Text
            style={{ color: "white", fontSize: 28, fontWeight: "800", marginBottom: 4 }}
            numberOfLines={1}
          >
            {botName}
          </Text>
          {/* Strategy from summary (preferred) or parsed log */}
          <Text style={{ color: "#c5c6c7", fontSize: 14, fontWeight: "700" }} numberOfLines={2}>
            {summary?.strategy || strategy}
          </Text>
        </View>

        {/* Summary Card */}
        <View
          style={{
            backgroundColor: "#13161b",
            borderRadius: 16,
            padding: 16,
            marginTop: 12,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "700", marginBottom: 12 }}>
            Total Portfolio Summary
          </Text>

          <Row label="Beginning Portfolio Value" value={displayMoney(summary?.beginningPortfolioValue)} />
          <Row label="Duration" value={summary?.duration || "—"} />
          <Row label="Buys" value={String(summary?.buys ?? 0)} />
          <Row label="Sells" value={String(summary?.sells ?? 0)} />
          <Row label="24h P/L (avg)" value={pl24hAvgDisplay} />
          <Row label="Total P/L" value={displayMoney(summary?.totalPL)} />
          <Row label="Cash" value={displayMoney(summary?.cash)} />
          <Row label="Crypto (mkt)" value={displayMoney(summary?.cryptoMkt)} />
          <Row label="Locked" value={displayMoney(summary?.locked)} />
          <Row label="Current Portfolio Value" value={displayMoney(summary?.currentValue)} />
        </View>

        {/* Logs Card */}
        <View
          style={{
            backgroundColor: "#13161b",
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>Logs</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <PillButton text={autoScroll ? "Live" : "Frozen"} onPress={() => setAutoScroll((v) => !v)} kind={autoScroll ? "live" : "frozen"} />
              <View style={{ width: 8 }} />
              <PillButton text="Jump to bottom" onPress={jumpToBottom} />
            </View>
          </View>

          <View
            style={{
              backgroundColor: "#0e1116",
              borderRadius: 12,
              height: 260, // fixed, scrollable window
              padding: 12,
            }}
          >
            <ScrollView
              ref={logScrollRef}
              onContentSizeChange={onLogContentSizeChange}
              onScroll={onLogScroll}
              scrollEventThrottle={16}
              nestedScrollEnabled
            >
              <Text style={{ color: "#9aa0a6", fontFamily: "Courier", fontSize: 12, lineHeight: 16 }}>
                {logText}
              </Text>
            </ScrollView>
            {!isAtBottom && autoScroll ? (
              <Text style={{ color: "#8ab4f8", fontSize: 11, marginTop: 6, textAlign: "right" }}>
                Scrolled up — tap “Jump to bottom” to resume
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Fixed button row */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: 16,
          backgroundColor: "#0b0c10",
          borderTopWidth: 1,
          borderTopColor: "#171a1f",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Btn text="Start" onPress={onStart} disabled={isRunning || loading} color="#1f5cff" />
          <View style={{ width: 10 }} />
          <Btn text="Stop" onPress={onStop} disabled={!isRunning || loading} color="#2b3440" />
          <View style={{ width: 10 }} />
          <Btn text="Delete" onPress={onDelete} disabled={loading || isRunning} color="#c92132" />
          {loading ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
        </View>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginVertical: 4 }}>
      <Text style={{ color: "#a6adb4" }}>{label}</Text>
      <Text style={{ color: "white", fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

function Btn({
  text,
  onPress,
  disabled,
  color,
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        backgroundColor: color,
        opacity: disabled ? 0.5 : 1,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: "center",
      }}
    >
      <Text style={{ color: "white", fontWeight: "700" }}>{text}</Text>
    </TouchableOpacity>
  );
}

function PillButton({
  text,
  onPress,
  kind,
}: {
  text: string;
  onPress: () => void;
  kind?: "live" | "frozen";
}) {
  const bg = kind === "live" ? "#123e9c" : kind === "frozen" ? "#3d3d3d" : "#263238";
  const fg = kind === "live" ? "#cfe0ff" : "#d9e1e8";
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: bg }}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: 12 }}>{text}</Text>
    </TouchableOpacity>
  );
}
