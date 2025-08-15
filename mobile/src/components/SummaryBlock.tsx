// /mobile/src/components/SummaryBlock.tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type Summary = {
  beginningPortfolioValue?: number;
  duration?: string;
  buys?: number;
  sells?: number;
  totalPL?: number;
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
  pl24h?: number;
};

export default function SummaryBlock({ summary }: { summary?: Summary }) {
  const s = summary;
  const fmt = (n?: number) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
  const gain = s?.totalPL == null ? undefined : s.totalPL >= 0;
  return (
    <View style={styles.box}>
      <Text style={styles.h2}>Total Portfolio Summary</Text>
      <Row k="Beginning Portfolio Value" v={fmt(s?.beginningPortfolioValue)} />
      <Row k="Duration" v={s?.duration || '—'} />
      <Row k="Buys" v={s?.buys?.toString() ?? '—'} />
      <Row k="Sells" v={s?.sells?.toString() ?? '—'} />
      <Row k="Total P/L" v={fmt(s?.totalPL)} vStyle={gain===undefined?null:(gain?styles.good:styles.bad)} />
      <Row k="24h Total P/L" v={fmt(s?.pl24h)} />
      <Row k="Cash" v={fmt(s?.cash)} />
      <Row k="Crypto (mkt)" v={fmt(s?.cryptoMkt)} />
      <Row k="Locked" v={fmt(s?.locked)} />
    </View>
  );
}

function Row({ k, v, vStyle }: { k: string; v: string; vStyle?: any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, vStyle]}>{v}</Text>
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
