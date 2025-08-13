// mobile/src/screens/BotDetailScreen.tsx
import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radii, typography, cardStyle } from '../theme/designSystem';
import LogViewer from '../components/LogViewer';
import { useAppDispatch, useAppSelector } from '../store';
import { selectBotById, fetchBotStatus, fetchLogsStreamStart, startBot, stopBot, toggleFollow, jumpToLatest } from '../store/botsSlice';
import BotCard from '../components/BotCard';

type Props = { route: any; navigation: any };

export default function BotDetailScreen({ route, navigation }: Props) {
  const { botId } = route.params;
  const dispatch = useAppDispatch();
  const bot = useAppSelector(state => selectBotById(state, botId));

  useEffect(() => {
    dispatch(fetchBotStatus(botId));
    dispatch(fetchLogsStreamStart(botId));
    const interval = setInterval(() => dispatch(fetchBotStatus(botId)), 2000);
    return () => clearInterval(interval);
  }, [botId]);

  const onAtBottomChange = useCallback((atBottom: boolean) => {
    if (atBottom && !bot.follow) {
      dispatch(jumpToLatest(botId));
    }
  }, [bot?.follow, botId]);

  if (!bot) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{bot.name}</Text>
        <View style={styles.chips}>
          <Text style={[styles.chip, bot.status === 'running' ? styles.chipRunning : styles.chipStopped]}>
            Bot: {bot.status.toUpperCase()}
          </Text>
          <Text style={[styles.chip, !bot.follow ? styles.chipPaused : styles.chipLive]}>
            Log: {bot.follow ? 'LIVE' : `PAUSED${bot.unreadCount ? ` (${bot.unreadCount})` : ''}`}
          </Text>
        </View>
      </View>

      <BotCard
        name={bot.name}
        id={bot.id}
        status={bot.status}
        summary={bot.summary}
        onStart={() => dispatch(startBot(botId))}
        onStop={() => dispatch(stopBot(botId))}
        onOpen={() => {}}
      />

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolBtn} onPress={() => dispatch(toggleFollow(botId))}>
          <Text style={styles.toolText}>{bot.follow ? 'Freeze' : 'Unfreeze'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => dispatch(jumpToLatest(botId))}>
          <Text style={styles.toolText}>Jump to latest</Text>
        </TouchableOpacity>
      </View>

      <View style={[cardStyle, {flex: 1, padding: spacing(1)}]}>
        <LogViewer
          lines={bot.lines}
          follow={bot.follow}
          unreadCount={bot.unreadCount}
          onAtBottomChange={onAtBottomChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing(2) },
  header: { marginBottom: spacing(1) },
  title: { color: colors.text, fontSize: typography.h1, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: spacing(1), marginTop: spacing(0.5) },
  chip: { color: '#fff', fontSize: typography.tiny, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipRunning: { backgroundColor: colors.success },
  chipStopped: { backgroundColor: colors.danger },
  chipLive: { backgroundColor: colors.primary },
  chipPaused: { backgroundColor: colors.warning },
  toolbar: { flexDirection: 'row', gap: spacing(1), marginVertical: spacing(1) },
  toolBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing(1.5), paddingVertical: spacing(1) },
  toolText: { color: colors.text, fontWeight: '700' },
});