import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SummaryBlock, { Summary } from './SummaryBlock';

export default function BotCard({
  id, name, status, subtitle, summary, hasLogs,
  onStart, onStop, onDelete, onOpen,
}:{
  id: string;
  name: string;
  status: 'running'|'stopped'|'starting'|'stopping'|string;
  subtitle?: string;
  summary?: Summary;
  hasLogs?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
}) {
  const running = status === 'running' || status === 'starting';

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.title}>{name}</Text>
        <View style={[styles.badge, { backgroundColor: running ? '#12381B' : '#3A1414' }]}>
          <Text style={{ color: running ? '#5AD07A' : '#E36262', fontWeight: '700', fontSize: 12 }}>
            {running ? 'RUNNING' : 'STOPPED'}
          </Text>
        </View>
      </View>
      {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}

      <View style={{ marginTop: 10 }}>
        <SummaryBlock s={summary} showPlaceholder bpvReady />
      </View>

      <View style={[styles.row, { marginTop: 12 }]}>
        <Pill label="Start" disabled={running} onPress={onStart} kind="primary" />
        <Pill label="Stop" disabled={!running} onPress={onStop} kind="danger" />
        <Pill label="Logs" disabled={!hasLogs} onPress={onOpen} />
        <Pill label="Delete" disabled={running} onPress={onDelete} />
      </View>
    </View>
  );
}

function Pill({ label, onPress, disabled, kind }:{
  label: string; onPress?: () => void; disabled?: boolean; kind?: 'primary'|'danger';
}) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress}
      style={[styles.pill, disabled?styles.pillDisabled:(kind==='danger'?styles.danger:kind==='primary'?styles.primary:styles.ghost)]}>
      <Text style={styles.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#2A3340', borderRadius: 16, padding: 12, backgroundColor: '#11161C' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700', color: '#E6EDF3' },
  sub: { color: '#97A3B6', marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, marginTop: 6, borderWidth: 1, borderColor: '#2A3340' },
  pillText: { fontWeight: '600', color: '#E6EDF3' },
  pillDisabled: { backgroundColor: '#1D2631', opacity: 0.6 },
  primary: { backgroundColor: '#0E2B5E' },
  danger: { backgroundColor: '#3A1111' },
  ghost: { backgroundColor: '#1A1F28' },
});
