// /mobile/src/components/SummaryBlock.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type Summary = {
  beginningPortfolioValue?: number;
  duration?: string | number;
  buys?: number;
  sells?: number;
  totalPL?: number;
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
};

type Props = { s?: Summary; showPlaceholder?: boolean };

export default function SummaryBlock({ s, showPlaceholder }: Props) {
  const fmt = (n?: number) => (typeof n === 'number' ? `$${n.toFixed(2)}` : (showPlaceholder ? '—' : ''));
  const val = (v: any) => (v != null && v !== '' ? String(v) : (showPlaceholder ? '—' : ''));
  const gain = typeof s?.totalPL === 'number' ? (s!.totalPL >= 0) : undefined;

  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryTitle}>TOTAL PORTFOLIO SUMMARY</Text>
      <Row k="Beginning Portfolio Value" v={fmt(s?.beginningPortfolioValue)} />
      <Row k="Duration" v={val(s?.duration)} />
      <Row k="Buys" v={val(s?.buys ?? 0)} />
      <Row k="Sells" v={val(s?.sells ?? 0)} />
      <Row k="Total P/L" v={fmt(s?.totalPL)} vStyle={gain===undefined?null:(gain?styles.good:styles.bad)} />
      <Row k="Cash" v={fmt(s?.cash)} />
      <Row k="Crypto (mkt)" v={fmt(s?.cryptoMkt)} />
      <Row k="Locked" v={fmt(s?.locked)} />
    </View>
  );
}

function Row({ k, v, vStyle }:{ k:string; v:string; vStyle?:any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}:</Text>
      <Text style={[styles.v, vStyle]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryBox: { marginTop: 10, backgroundColor: '#0B1117', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#2A3340' },
  summaryTitle: { color: '#97A3B6', fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  k: { color: '#97A3B6' },
  v: { color: '#E6EDF3', fontWeight: '600' },
  good: { color: '#19C37D' },
  bad: { color: '#F44336' },
});
