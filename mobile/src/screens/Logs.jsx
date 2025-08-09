import React, { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useRoute } from "@react-navigation/native";

export default function Logs() {
  const { params } = useRoute();
  const botId = params?.botId;
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLogs = async () => {
    return [
      { id: "1", t: Date.now() - 40000, level: "INFO", msg: "Bot started" },
      { id: "2", t: Date.now() - 20000, level: "DECISION", msg: "📈 BUY signal evaluated @ $0.12345678" },
      { id: "3", t: Date.now() - 15000, level: "TRADE", msg: "🟢 BUY executed 0.0123 BTC @ $0.12345678" },
      { id: "4", t: Date.now() - 10000, level: "STATUS", msg: "Buys:1 Sells:0 P/L:$1.24" },
    ];
  };

  const load = async () => {
    setRefreshing(true);
    try { setItems(await fetchLogs()); } finally { setRefreshing(false); }
  };

  useEffect(() => { load(); }, [botId]);
  const onRefresh = useCallback(() => load(), [botId]);

  const renderItem = ({ item }) => (
    <View style={styles.row}>
      <Text style={styles.time}>{new Date(item.t).toLocaleTimeString()}</Text>
      <Text style={styles.level}>[{item.level}]</Text>
      <Text style={styles.msg}>{item.msg}</Text>
    </View>
  );

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb", flexDirection: "row", alignItems: "center", gap: 8 },
  time: { width: 84, color: "#6b7280" },
  level: { width: 96, fontWeight: "700", color: "#111827" },
  msg: { flex: 1, color: "#111827" },
});
