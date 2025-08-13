// mobile/src/components/BotCard.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radii, typography, cardStyle } from '../theme/designSystem';
import { BotSummary, BotStatus } from '../types';

type Props = {
  name: string;
  id: string;
  status: BotStatus;
  summary?: BotSummary;
  onStart: () => void;
  onStop: () => void;
  onOpen: () => void;
};

export default function BotCard({ name, id, status, summary, onStart, onStop, onOpen }: Props) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{name}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, styles[status]]}>{status.toUpperCase()}</Text>
        </View>
      </View>

      {summary && (
        <View style={styles.summary}>
          <Text style={styles.summaryHeader}>=== TOTAL PORTFOLIO SUMMARY ===</Text>
          <View style={{height: spacing(0.5)}} />
          <Text style={styles.row}>Beginning Portfolio Value: <Text style={styles.value}>${"" + summary.beginningValue.toFixed(2)}</Text></Text>
          <Text style={styles.row}>Duration: <Text style={styles.value}>{summary.duration}</Text></Text>
          <Text style={styles.row}>Buys: <Text style={styles.value}>{summary.buys}</Text></Text>
          <Text style={styles.row}>Sells: <Text style={styles.value}>{summary.sells}</Text></Text>
          <Text style={styles.row}>Total P/L: <Text style={[styles.value, {color: summary.totalPL >= 0 ? colors.success : colors.danger}]}>${"" + summary.totalPL.toFixed(2)}</Text></Text>
          <Text style={styles.row}>Cash: <Text style={styles.value}>${"" + summary.cash.toFixed(2)}</Text></Text>
          <Text style={styles.row}>Crypto (mkt): <Text style={styles.value}>${"" + summary.cryptoMkt.toFixed(2)}</Text></Text>
          <Text style={styles.row}>Locked: <Text style={styles.value}>${"" + summary.locked.toFixed(2)}</Text></Text>
          <Text style={styles.summaryFooter}>=============================</Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity onPress={onStart} disabled={status === 'running'} style={[styles.btn, status === 'running' && styles.btnDisabled]}>
          <Text style={styles.btnText}>{status === 'running' ? 'Running' : 'Start'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onStop} disabled={status !== 'running'} style={[styles.btn, styles.stopBtn, status !== 'running' && styles.btnDisabled]}>
          <Text style={styles.btnText}>Stop</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, padding: spacing(2), marginBottom: spacing(2) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: typography.h2, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: spacing(1) },
  badge: {
    fontSize: typography.tiny, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    overflow: 'hidden', color: '#fff', fontWeight: '700',
  },
  running: { backgroundColor: colors.success },
  stopped: { backgroundColor: colors.danger },
  idle: { backgroundColor: colors.warning },
  summary: { marginTop: spacing(1.5), padding: spacing(1.5), backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  summaryHeader: { color: colors.textMuted, fontFamily: typography.fontMono },
  summaryFooter: { color: colors.textMuted, fontFamily: typography.fontMono, marginTop: spacing(0.5) },
  row: { color: colors.text, fontFamily: typography.fontMono, fontSize: 13 },
  value: { color: colors.text, fontFamily: typography.fontMono },
  actions: { flexDirection: 'row', gap: spacing(1), marginTop: spacing(1.5) },
  btn: { backgroundColor: colors.primary, paddingVertical: spacing(1), paddingHorizontal: spacing(2), borderRadius: radii.lg },
  stopBtn: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700' },
});