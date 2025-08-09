import React, { useState, useEffect, useCallback } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";

const useRunningBots = () => {
  const [bots, setBots] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBots = async () => {
    return [
      {
        id: "bot-1",
        strategyName: "Dynamic Regime Switching (1.0)",
        description: "Auto-switches between DCA, Grid/Mean Reversion, and Accumulate based on market regime.",
        summary: { beginningValue: 1000.0, durationMin: 42, buys: 3, sells: 2, pnl: 26.34, cash: 512.12, cryptoMkt: 514.22, locked: 12.0 },
        settings: { DEMO_MODE: false, TEST_MODE: true, SIMPLE_BUY_THRESHOLD: 2, SIMPLE_SELL_THRESHOLD: 1, defaultSlippage: 2.0 },
      },
      {
        id: "bot-2",
        strategyName: "Ultimate Safety Profit Strategy (2.0)",
        description: "Adaptive regime, volatility scaling, profit lock, risk spread, and emergency brake, auto-tuned.",
        summary: { beginningValue: 1500.0, durationMin: 7, buys: 1, sells: 0, pnl: -4.1, cash: 980.0, cryptoMkt: 512.0, locked: 4.0 },
        settings: { ULTIMATE_STRATEGY_ENABLE: true, ATR_LENGTH: 5, BUY_THRESHOLD_ATR: 1.2, SELL_THRESHOLD_ATR: 1.0, PRIORITY_CRYPTOS: "BTC,ETH,XRP,BONK,POPCAT" },
      },
    ];
  };

  const load = async () => {
    setRefreshing(true);
    try { setBots(await fetchBots()); } finally { setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(), []);

  return { bots, refreshing, onRefresh };
};

export default function BotHub() {
  const navigation = useNavigation();
  const { bots, refreshing, onRefresh } = useRunningBots();

  const renderItem = ({ item }) => {
    const s = item.summary || {};
    const settings = item.settings || {};
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{item.strategyName}</Text>
        <Text style={styles.desc}>{item.description}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TOTAL PORTFOLIO SUMMARY</Text>
          <Text>Beginning Portfolio Value: ${Number(s.beginningValue || 0).toFixed(2)}</Text>
          <Text>Duration: {Number(s.durationMin || 0)} min</Text>
          <Text>Buys: {Number(s.buys || 0)}</Text>
          <Text>Sells: {Number(s.sells || 0)}</Text>
          <Text>Total P/L: ${Number(s.pnl || 0).toFixed(2)}</Text>
          <Text>Cash: ${Number(s.cash || 0).toFixed(2)}</Text>
          <Text>Crypto (mkt): ${Number(s.cryptoMkt || 0).toFixed(2)}</Text>
          <Text>Locked: ${Number(s.locked || 0).toFixed(2)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings (.env)</Text>
          {Object.entries(settings).map(([k, v]) => (
            <Text key={k} style={styles.settingRow}>
              <Text style={styles.settingKey}>{k}:</Text> {String(v)}
            </Text>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={() => navigation.navigate("Logs", { botId: item.id, title: `${item.strategyName} — Logs` })}>
            <Text style={styles.buttonText}>View Log</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={() => navigation.navigate("PortfolioSummary", { botId: item.id, title: `${item.strategyName} — Summary` })}>
            <Text style={styles.buttonText}>View Summary</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={bots}
      keyExtractor={(b) => b.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  desc: { fontSize: 14, color: "#444", marginBottom: 12 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "700", marginBottom: 4, color: "#666" },
  settingRow: { fontSize: 12, marginBottom: 2 },
  settingKey: { fontWeight: "600" },
  actions: { marginTop: 12, flexDirection: "row", gap: 12 },
  button: { backgroundColor: "#111827", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: "white", fontWeight: "600" },
});
