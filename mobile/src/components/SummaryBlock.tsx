import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type Summary = {
  beginningPortfolioValue?: number;
  duration?: any;
  buys?: number;
  sells?: number;
  totalPL?: number;
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
  pl24h?: number;
  plAvgLifetime?: number;
  currentPortfolioValue?: number; // NEW
};

function asCurrency(n: any) {
  const x = Number(n);
  if (!isFinite(x)) return '—';
  return `$${x.toFixed(2)}`;
}
function asText(v: any) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') {
    const h = (v as any).h ?? (v as any).hours;
    const m = (v as any).m ?? (v as any).minutes;
    const s = (v as any).s ?? (v as any).seconds;
    if ([h, m, s].some((k) => typeof k === 'number')) {
      return `${Number(h||0)}h ${Number(m||0)}m ${Number(s||0)}s`;
    }
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function Row({ k, v, vStyle }: { k: string; v: string; vStyle?: any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, vStyle]}>{v}</Text>
    </View>
  );
}

export default function SummaryBlock({ summary }: { summary?: Summary }) {
  const s = summary || {};
  const totalGain = s.totalPL == null ? undefined : s.totalPL >= 0;

  return (
    <View style={styles.box}>
      <Text style={styles.h2}>Total Portfolio Summary</Text>
      <Row k="Beginning Portfolio Value" v={asCurrency(s.beginningPortfolioValue)} />
      <Row k="Duration" v={asText(s.duration)} />
      <Row k="Buys" v={asText(s.buys)} />
      <Row k="Sells" v={asText(s.sells)} />
      <Row k="Total P/L" v={asCurrency(s.totalPL)} vStyle={totalGain === undefined ? null : (totalGain ? styles.good : styles.bad)} />
      <Row k="24h Total P/L" v={asCurrency(s.pl24h)} />
      <Row k="Avg P/L (lifetime, per day)" v={asCurrency(s.plAvgLifetime)} />
      <Row k="Cash" v={asCurrency(s.cash)} />
      <Row k="Crypto (mkt)" v={asCurrency(s.cryptoMkt)} />
      <Row k="Locked" v={asCurrency(s.locked)} />
      <Row k="Current Portfolio Value" v={asCurrency(s.currentPortfolioValue)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 12, padding: 12, backgroundColor: '#0B1117', marginTop: 12 },
  h2: { color: '#E6EDF3', fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: '#97A3B6' },
  v: { color: '#E6EDF3', fontWeight: '600' },
  good: { color: '#27C46A' },
  bad: { color: '#FF5C5C' },
});
