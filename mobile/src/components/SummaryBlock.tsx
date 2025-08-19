import React from "react";
import { StyleSheet, Text, View } from "react-native";

export type Summary = {
  beginningPortfolioValue?: number;
  duration?: string;
  buys?: number;
  sells?: number;
  totalPL?: number;
  pl24h?: number;
  avgDailyPL?: number;
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
};

export default function SummaryBlock({ title = "Total Portfolio Summary", summary }: { title?: string; summary?: Summary }) {
  const s = summary || {};
  const rows: Array<[string, string]> = [];

  rows.push(["Beginning Portfolio Value", money(num(s.beginningPortfolioValue))]);
  rows.push(["Duration", s.duration || "—"]);
  rows.push(["Buys", String(s.buys ?? 0)]);
  rows.push(["Sells", String(s.sells ?? 0)]);
  rows.push(["Total P/L", money(num(s.totalPL))]);

  const _pl24h = num(s.pl24h);
  if (typeof _pl24h === "number") rows.push(["24h Total P/L", money(_pl24h)]);

  const _avg = num(s.avgDailyPL);
  if (typeof _avg === "number") rows.push(["Avg P/L (lifetime, per day)", money(_avg)]);

  rows.push(["Cash", money(num(s.cash))]);
  rows.push(["Crypto (mkt)", money(num(s.cryptoMkt))]);
  rows.push(["Locked", money(num(s.locked))]);

  const current = sumDefined([s.cash, s.cryptoMkt, s.locked]);
  rows.push(["Current Portfolio Value", money(current)]);

  return (
    <View style={styles.card}>
      <Text style={styles.h}>{title}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.r}>
          <Text style={styles.k}>{k}</Text>
          <Text style={styles.v}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function num(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return Number.isFinite(v) ? v : undefined;
}
function money(n?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return `$${v.toFixed(2)}`;
}
function sumDefined(arr: Array<any>) {
  return arr.reduce((acc, x) => (Number.isFinite(x) ? acc + Number(x) : acc), 0);
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#2A3340", borderRadius: 12, padding: 12, backgroundColor: "#0E131A" },
  h: { color: "#E6EDF3", fontWeight: "700", marginBottom: 8 },
  r: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  k: { color: "#97A3B6" },
  v: { color: "#E6EDF3", fontWeight: "600" },
});
