// mobile/src/screens/BotsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { listBots, getBotSummary } from "../api";

type BotListItem = { id: string; name?: string; status?: string };

// Visible tag to verify the deployed screen version
const BUILD_TAG = "BotsScreen v10 (colors + sparkline)";

type BotRow = BotListItem & {
  // mapped/flattened summary fields (best-effort)
  strategy?: string;
  totalPL?: number | null;
  locked?: number | null;
  cryptoMkt?: number | null;
  cash?: number | null;
  currentValue?: number | null;

  // derived
  rate24hPerHr?: number | null;            // 24h P/L (avg) Rate Per Hr
  overallAvgPerHrSinceStart?: number | null;

  // optional timeseries for sparkline
  plHistory?: number[] | null;
};

export default function BotsScreen({ navigation }: any) {
  const [bots, setBots] = useState<BotListItem[]>([]);
  const [rows, setRows] = useState<Record<string, BotRow>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const REFRESH_MS = 4000;

  // --- Colors --------------------------------------------------------------
  const c = {
    bg: "#0B1117",
    card: "#0E131A",
    border: "#283142",
    text: "#E6EDF3",
    sub: "#97A3B6",
    pos: "#3fb950", // green
    neg: "#f85149", // red
    muted: "#7b8794",
    accent: "#8ab4f8",
  };

  // --- Helpers -------------------------------------------------------------

  const currency = (n?: number | null) => {
    if (n == null || !isFinite(Number(n))) return "—";
    try {
      return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
    } catch {
      return `$${Number(n).toFixed(2)}`;
    }
  };

  const signedColor = (n?: number | null) => {
    if (n == null || !isFinite(Number(n))) return c.sub;
    if (Number(n) > 0) return c.pos;
    if (Number(n) < 0) return c.neg;
    return c.sub;
  };

  // Parse duration: number of minutes OR strings like "7h 21m 53s" / "441 min"
  const toMinutes = (d?: number | string | null) => {
    if (d == null) return 0;
    if (typeof d === "number" && isFinite(d)) return Math.max(0, d);
    const s = String(d);
    const hms = /(?:(\d+)\s*h)?\s*(\d+)\s*m(?:in)?(?:\s*(\d+)\s*s)?/i.exec(s);
    if (hms) {
      const h = Number(hms[1] || 0), m = Number(hms[2] || 0), sec = Number(hms[3] || 0);
      return h * 60 + m + Math.floor(sec / 60);
    }
    const mOnly = /(-?\d+)\s*min/i.exec(s);
    if (mOnly) return Math.max(0, parseInt(mOnly[1], 10));
    const n = Number(s);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };

  // Try multiple common keys for PL history; returns null if not found
  const extractPlHistory = (payload: any): number[] | null => {
    const s = payload?.summary ?? payload ?? {};
    const cand =
      s?.metrics?.totalPLHistory ||
      s?.metrics?.plHistory ||
      s?.totalPLHistory ||
      s?.pnlHistory ||
      s?.profitHistory ||
      null;
    if (!Array.isArray(cand)) return null;
    const nums = cand.map((x: any) => Number(x)).filter((x: any) => isFinite(x));
    return nums.length ? nums : null;
  };

  // Normalize a `/api/bots/:id/summary` payload into the fields we render
  const mapSummary = (base: BotListItem, payload: any): BotRow => {
    // Your server returns: { id, name, status, summary: {...}, (flattened fields)... }
    const s = payload?.summary ?? payload ?? {};
    const durationMins = toMinutes(s?.duration);

    // Prefer canonical fields; fall back intelligently
    const rate24hPerHr =
      s?.pl24hAvgRatePerHour ??
      s?.overall24hAvgRatePerHour ??
      (s?.pl24h != null ? Number(s.pl24h) / 24 : null);

    const overallAvgPerHrSinceStart =
      s?.overall24hAvgRatePerHour ??
      (durationMins > 0 && s?.totalPL != null
        ? Number(s.totalPL) / (durationMins / 60)
        : null);

    return {
      ...base,
      strategy: s?.strategy ?? s?.strategyName ?? s?.strategyLabel ?? undefined,
      totalPL: s?.totalPL ?? s?.dayPL ?? s?.totals?.profit ?? null,
      locked: s?.locked ?? s?.totals?.locked ?? s?.cash?.locked ?? null,
      cryptoMkt: s?.cryptoMkt ?? null,
      cash: s?.cash ?? null,
      currentValue:
        s?.currentValue ?? s?.currentPortfolioValue ?? s?.totals?.portfolioValue ?? s?.portfolio?.value ?? null,
      rate24hPerHr,
      overallAvgPerHrSinceStart,
      plHistory: extractPlHistory(payload),
    };
  };

  // --- Data loading --------------------------------------------------------

  const loadList = useCallback(async () => {
    const b = await listBots();
    setBots(b || []);
    return b || [];
  }, []);

  const loadSummaries = useCallback(async (ids: string[]) => {
    const updates: Record<string, BotRow> = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const payload = await getBotSummary(id);
          const base = bots.find((b) => b.id === id) || { id };
          updates[id] = mapSummary(base, payload);
        } catch {
          if (rows[id]) updates[id] = rows[id]; // keep previous values if fetch fails
        }
      })
    );
    setRows((prev) => ({ ...prev, ...updates }));
  }, [bots, rows]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const b = await loadList();
      await loadSummaries(b.map((x) => x.id));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadList, loadSummaries]);

  // Initial load
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live polling (while focused)
  useFocusEffect(
    useCallback(() => {
      let timer: any;
      const tick = async () => {
        try {
          const b = await loadList();
          await loadSummaries(b.map((x) => x.id));
        } catch {}
      };
      timer = setInterval(tick, REFRESH_MS);
      return () => clearInterval(timer);
    }, [loadList, loadSummaries])
  );

  // --- Rendering -----------------------------------------------------------

  const orderedRows: BotRow[] = useMemo(() => {
    const arr = bots.map((b) => rows[b.id] || { ...b });
    return arr;
  }, [bots, rows]);

  const openBot = (bot: BotListItem) =>
    navigation?.navigate?.("BotDetail", { id: bot.id, name: bot.name });

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: c.sub, marginTop: 10 }}>Loading… {BUILD_TAG}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <Text style={{ color: "#55667a", fontSize: 12, marginBottom: 8 }}>{BUILD_TAG}</Text>

      {orderedRows.length === 0 ? (
        <Text style={{ color: c.sub }}>No bots yet.</Text>
      ) : (
        orderedRows.map((row) => (
          <BotCard
            key={row.id}
            row={row}
            onPress={() => openBot(row)}
            currency={currency}
            colors={c}
          />
        ))
      )}
    </ScrollView>
  );
}

// --- Small presentational components --------------------------------------

function BotCard({
  row,
  onPress,
  currency,
  colors,
}: {
  row: BotRow;
  onPress: () => void;
  currency: (n?: number | null) => string;
  colors: Record<string, string>;
}) {
  const name = row.name || row.id;
  const statusLine = `${row.status || "—"}${row.strategy ? ` • ${row.strategy}` : ""}`;

  const totalPLColor = signedColorLocal(row.totalPL, colors);
  const rate24Color = signedColorLocal(row.rate24hPerHr, colors);
  const overallRateColor = signedColorLocal(row.overallAvgPerHrSinceStart, colors);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        marginBottom: 12,
      }}
    >
      {/* Header Row */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>{name}</Text>
          <Text style={{ color: colors.sub, marginTop: 2 }}>{statusLine}</Text>
        </View>
        {/* Mini sparkline (Total P/L history if available) */}
        <Sparkline
          data={row.plHistory || null}
          width={96}
          height={28}
          colors={colors}
        />
        <Text style={{ color: colors.sub, fontSize: 24, marginLeft: 8 }}>›</Text>
      </View>

      {/* Metrics */}
      <View style={{ marginTop: 8 }}>
        <Metric label="Total P/L" value={currency(row.totalPL)} valueColor={totalPLColor} colors={colors} />
        <Metric
          label="24h P/L (avg) Rate Per Hr"
          value={row.rate24hPerHr == null ? "—" : currency(row.rate24hPerHr)}
          valueColor={rate24Color}
          colors={colors}
        />
        <Metric
          label="Overall 24h P/L (avg) Rate Per Hr"
          value={row.overallAvgPerHrSinceStart == null ? "—" : currency(row.overallAvgPerHrSinceStart)}
          valueColor={overallRateColor}
          colors={colors}
        />
        <Metric label="Locked" value={currency(row.locked)} colors={colors} />
        <Metric label="Crypto (mkt)" value={currency(row.cryptoMkt)} colors={colors} />
        <Metric label="Current Portfolio Value" value={currency(row.currentValue)} colors={colors} />
      </View>
    </TouchableOpacity>
  );
}

function Metric({
  label,
  value,
  valueColor,
  align = "left",
  colors,
}: {
  label: string;
  value: string;
  valueColor?: string;
  align?: "left" | "right";
  colors: Record<string, string>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: colors.sub }}>{label}</Text>
      <Text
        style={{
          color: valueColor || colors.text,
          fontWeight: "600",
          textAlign: align,
          marginLeft: 8,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function signedColorLocal(n?: number | null, colors?: Record<string, string>) {
  if (n == null || !isFinite(Number(n))) return colors?.sub || "#97A3B6";
  if (Number(n) > 0) return colors?.pos || "#3fb950";
  if (Number(n) < 0) return colors?.neg || "#f85149";
  return colors?.sub || "#97A3B6";
}

/**
 * Minimal "sparkline" using bars — no external libs.
 * If data is missing, show a subtle placeholder skeleton.
 */
function Sparkline({
  data,
  width = 96,
  height = 28,
  colors,
}: {
  data: number[] | null;
  width?: number;
  height?: number;
  colors: Record<string, string>;
}) {
  const barGap = 1;
  const maxBars = 24;

  // Placeholder skeleton bars when no data
  if (!data || !data.length) {
    const phBars = 16;
    const bw = Math.max(2, Math.floor((width - (phBars - 1) * barGap) / phBars));
    return (
      <View
        style={{
          width,
          height,
          marginLeft: 8,
          flexDirection: "row",
          alignItems: "flex-end",
        }}
      >
        {Array.from({ length: phBars }).map((_, i) => (
          <View
            key={i}
            style={{
              width: bw,
              height: 6 + ((i % 3) * 4), // little variation
              backgroundColor: "#1c2430",
              marginLeft: i === 0 ? 0 : barGap,
              borderRadius: 2,
            }}
          />
        ))}
      </View>
    );
  }

  // Use the last N points
  const values = data.slice(-maxBars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-9, max - min);

  const bw = Math.max(2, Math.floor((width - (values.length - 1) * barGap) / values.length));

  return (
    <View
      style={{
        width,
        height,
        marginLeft: 8,
        flexDirection: "row",
        alignItems: "flex-end",
      }}
    >
      {values.map((v, i) => {
        const h = 4 + Math.round(((v - min) / range) * (height - 4));
        const col = v >= (min + range / 2) ? colors.pos : colors.neg;
        return (
          <View
            key={i}
            style={{
              width: bw,
              height: Math.max(3, h),
              backgroundColor: col,
              opacity: 0.9,
              marginLeft: i === 0 ? 0 : barGap,
              borderRadius: 2,
            }}
          />
        );
      })}
    </View>
  );
}
