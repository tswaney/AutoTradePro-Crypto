// /mobile/src/components/SummaryBlock.tsx
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type Summary = {
  beginningPortfolioValue?: number;
  duration?: string | number;         // "0h 5m 32s" or seconds
  buys?: number;
  sells?: number;
  totalPL?: number;
  pl24h?: number;                      // 24h Total P/L
  avgDailyPL?: number;                 // Avg P/L (lifetime, per day)
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
};

type Props = { s?: Summary; showPlaceholder?: boolean };

const toMoney = (n?: number) =>
  typeof n === 'number' && isFinite(n) ? `$${n.toFixed(2)}` : undefined;

const toText = (v: any) => (v == null || v === '' ? undefined : String(v));

function parseDurationToSeconds(d: string | number | undefined) {
  if (d == null) return undefined;
  if (typeof d === 'number') return d;
  // Accept "0h 8m 16s", "5m 2s", "123s", "1d 2h 3m 4s", or "300 sec"
  const s = d.toLowerCase();
  let total = 0;
  const m = {
    d: /(\d+)\s*d/.exec(s),
    h: /(\d+)\s*h/.exec(s),
    min: /(\d+)\s*m/.exec(s),
    s: /(\d+)\s*s/.exec(s),
  };
  if (m.d) total += Number(m.d[1]) * 86400;
  if (m.h) total += Number(m.h[1]) * 3600;
  if (m.min) total += Number(m.min[1]) * 60;
  if (m.s) total += Number(m.s[1]);
  if (total === 0 && /^\d+$/.test(s)) return Number(s);
  return total || undefined;
}

export default function SummaryBlock({ s, showPlaceholder }: Props) {
  const placeholder = showPlaceholder ? '—' : '';

  const gain = typeof s?.totalPL === 'number' ? s!.totalPL >= 0 : undefined;

  const currentValue = useMemo(() => {
    const c = typeof s?.cash === 'number' ? s!.cash : undefined;
    const m = typeof s?.cryptoMkt === 'number' ? s!.cryptoMkt : undefined;
    const l = typeof s?.locked === 'number' ? s!.locked : undefined;
    if (c == null && m == null && l == null) return undefined;
    return (c || 0) + (m || 0) + (l || 0);
  }, [s?.cash, s?.cryptoMkt, s?.locked]);

  // If avgDailyPL wasn’t provided by the API, compute from totalPL + duration
  const computedAvgDaily = useMemo(() => {
    if (typeof s?.avgDailyPL === 'number') return s!.avgDailyPL;
    const secs = parseDurationToSeconds(s?.duration);
    if (!secs || !s?.totalPL) return undefined;
    const days = secs / 86400;
    if (days <= 0) return undefined;
    return s.totalPL / days;
  }, [s?.avgDailyPL, s?.duration, s?.totalPL]);

  const rows: Array<[string, string | undefined, any?]> = [
    ['Beginning Portfolio Value', toMoney(s?.beginningPortfolioValue)],
    ['Duration', toText(s?.duration)],
    ['Buys', toText(s?.buys ?? 0)],
    ['Sells', toText(s?.sells ?? 0)],
    ['Total P/L', toMoney(s?.totalPL), gain === undefined ? null : (gain ? styles.good : styles.bad)],
    ['24h Total P/L', toMoney(s?.pl24h)],
    ['Avg P/L (lifetime, per day)', toMoney(computedAvgDaily)],
    ['Cash', toMoney(s?.cash)],
    ['Crypto (mkt)', toMoney(s?.cryptoMkt)],
    ['Locked', toMoney(s?.locked)],
    ['Current Portfolio Value', toMoney(currentValue)],
  ];

  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryTitle}>Total Portfolio Summary</Text>
      {rows.map(([k, v, vStyle]) => (
        <Row key={k} k={k} v={v ?? placeholder} vStyle={vStyle} />
      ))}
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
  summaryBox: {
    marginTop: 10,
    backgroundColor: '#0B1117',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2A3340',
  },
  summaryTitle: { color: '#97A3B6', fontWeight: '700', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  k: { color: '#97A3B6' },
  v: { color: '#E6EDF3', fontWeight: '600' },
  good: { color: '#19C37D' },
  bad: { color: '#F44336' },
});
