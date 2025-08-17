// /mobile/src/components/BotCard.tsx – adds `subtitle` under Status
import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import SummaryBlock, { Summary } from './SummaryBlock';

type Props = {
  id: string; name: string; status: 'running' | 'stopped' | 'idle' | string;
  subtitle?: string; summary?: Summary;
  onStart?: () => void; onStop?: () => void; onOpen?: () => void;
};
export default function BotCard({ id, name, status, subtitle, summary, onStart, onStop, onOpen }: Props) {
  const isRunning = status === 'running';
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{name}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.pill, isRunning ? styles.good : styles.bad]}>
              <Text style={styles.pillText}>{status.toUpperCase()}</Text>
            </View>
            {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </View>
        <View style={styles.actions}>
          {isRunning ? (
            <TouchableOpacity onPress={onStop} style={[styles.btn, styles.stop]}><Text style={styles.btnText}>Stop</Text></TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onStart} style={[styles.btn, styles.start]}><Text style={styles.btnText}>Start</Text></TouchableOpacity>
          )}
          <TouchableOpacity onPress={onOpen} style={[styles.btn, styles.open]}><Text style={styles.btnText}>Logs</Text></TouchableOpacity>
        </View>
      </View>
      <SummaryBlock summary={summary} />
    </View>
  );
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#0B1117', borderWidth: 1, borderColor: '#2A3340', borderRadius: 14, padding: 12, marginVertical: 8 },
  header: { flexDirection: 'row' },
  title: { color: '#E6EDF3', fontSize: 16, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  good: { backgroundColor: '#0F8C3E' }, bad: { backgroundColor: '#7A0000' },
  pillText: { color: 'white', fontWeight: '700', fontSize: 12 },
  subtitle: { color: '#97A3B6', marginLeft: 6, fontSize: 12, flexShrink: 1 },
  actions: { justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8 },
  btn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  start: { backgroundColor: '#0F4C81' }, stop: { backgroundColor: '#8A2E2E' }, open: { backgroundColor: '#3C3C3C' },
  btnText: { color: 'white', fontWeight: '700' }
});
