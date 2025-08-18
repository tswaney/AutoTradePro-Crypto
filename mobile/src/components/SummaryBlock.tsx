import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

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

const fmt = (n?: number) =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';

export default function SummaryBlock({ s, showPlaceholder, bpvReady }:{
  s?: Summary; showPlaceholder?: boolean; bpvReady?: boolean;
}) {
  const cash = num(s?.cash) ?? 0;
  const crypto = num(s?.cryptoMkt) ?? 0;
  const locked = num(s?.locked) ?? 0;
  const currentValue = cash + crypto + locked;

  const rows: Array<[string, string]> = [
    ['Beginning Portfolio Value', fmt(bpvReady ? num(s?.beginningPortfolioValue) : 0)],
    ['Duration', s?.duration || (showPlaceholder ? '—' : '')],
    ['Buys', s?.buys != null ? String(s.buys) : (showPlaceholder ? '—' : '')],
    ['Sells', s?.sells != null ? String(s.sells) : (showPlaceholder ? '—' : '')],
    ['Total P/L', money(num(s?.totalPL))],
  ];

  if (s?.pl24h != null) rows.push(['24h Total P/L', money(num(s.pl24h))]);
  if (s?.avgDailyPL != null) rows.push(['Avg P/L (lifetime, per day)', money(num(s.avgDailyPL))]);

  rows.push(['Cash', fmt(num(s?.cash))]);
  rows.push(['Crypto (mkt)', fmt(num(s?.cryptoMkt))]);
  rows.push(['Locked', fmt(num(s?.locked))]);
  rows.push(['Current Portfolio Value', fmt(currentValue)]);

  return (
    <View style={styles.card}>
      <Text style={styles.h}>Total Portfolio Summary</Text>
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
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return Number.isFinite(v) ? v : undefined;
}
function money(n?: number) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 12, padding: 12, backgroundColor: '#0E131A' },
  h: { color: '#E6EDF3', fontWeight: '700', marginBottom: 8 },
  r: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: '#97A3B6' },
  v: { color: '#E6EDF3', fontWeight: '600' },
});
