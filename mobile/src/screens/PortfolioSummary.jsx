import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useRoute } from "@react-navigation/native";

export default function PortfolioSummary() {
  const { params } = useRoute();
  const botId = params?.botId;
  const [s, setS] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async () => {
    return { beginningValue: 1000.0, durationMin: 42, buys: 3, sells: 2, pnl: 26.34, cash: 512.12, cryptoMkt: 514.22, locked: 12.0 };
  };

  const load = async () => {
    setRefreshing(true);
    try { setS(await fetchSummary()); } finally { setRefreshing(false); }
  };

  useEffect(() => { load(); }, [botId]);
  const onRefresh = useCallback(() => load(), [botId]);

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>TOTAL PORTFOLIO SUMMARY</Text>
      <View style={styles.block}>
        <Row label="Beginning Portfolio Value" value={`$${Number(s?.beginningValue || 0).toFixed(2)}`} />
        <Row label="Duration" value={`${Number(s?.durationMin || 0)} min`} />
        <Row label="Buys" value={String(Number(s?.buys || 0))} />
        <Row label="Sells" value={String(Number(s?.sells || 0))} />
        <Row label="Total P/L" value={`$${Number(s?.pnl || 0).toFixed(2)}`} />
        <Row label="Cash" value={`$${Number(s?.cash || 0).toFixed(2)}`} />
        <Row label="Crypto (mkt)" value={`$${Number(s?.cryptoMkt || 0).toFixed(2)}`} />
        <Row label="Locked" value={`$${Number(s?.locked || 0).toFixed(2)}`} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  block: { backgroundColor: "#fff", borderRadius: 16, padding: 16, shadowColor: "#000",
    shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb", flexDirection: "row", justifyContent: "space-between" },
  label: { color: "#374151", fontWeight: "600" },
  value: { color: "#111827", fontVariant: ["tabular-nums"] },
});
