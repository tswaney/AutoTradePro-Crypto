// /mobile/src/components/BotCard.tsx
import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import SummaryBlock, { Summary } from './SummaryBlock';

type Props = {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'idle';
  subtitle?: string;
  summary?: Summary;
  onStart?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
};

export default function BotCard({ id, name, status, subtitle, summary, onStart, onStop, onOpen }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{name}</Text>
      {!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}
      <Text style={styles.meta}>
        Status:{' '}
        <Text style={[styles.meta, status==='running'?styles.good:styles.muted]}>{status}</Text>
      </Text>

      {/* Always show summary shell, even if values not loaded yet */}
      <SummaryBlock s={summary} showPlaceholder />

      <View style={styles.row}>
        <Pill disabled={status==='running'} label="Start" onPress={onStart} kind="primary" />
        <Pill disabled={status!=='running'} label="Stop" onPress={onStop} kind="danger" />
        <TouchableOpacity onPress={onOpen} style={[styles.pill, styles.ghost]}>
          <Text style={[styles.pillText, styles.link]}>Logs</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Pill({ label, onPress, disabled, kind }:{ label:string; onPress?:()=>void; disabled?:boolean; kind?:'primary'|'danger'}) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.pill, disabled?styles.pillDisabled:(kind==='danger'?styles.danger:styles.primary)]}>
      <Text style={styles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 16, padding: 14, backgroundColor: '#11161C' },
  title: { fontSize: 16, fontWeight: '700', color: '#E6EDF3' },
  meta: { marginTop: 2, color: '#97A3B6' },
  good: { color: '#19C37D' },
  muted: { color: '#97A3B6' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8, borderWidth: 1, borderColor: '#2A3340' },
  pillText: { fontWeight: '600', color: '#E6EDF3' },
  link: { color: '#7AA5FF' },
  primary: { backgroundColor: '#0E2B5E' },
  danger: { backgroundColor: '#3A1111' },
  ghost: { backgroundColor: '#1A1F28' },
  pillDisabled: { backgroundColor: '#1D2631', opacity: 0.6 },
});
