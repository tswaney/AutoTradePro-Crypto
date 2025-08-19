import React from 'react';
import { Pressable, View, Text, StyleSheet, ViewStyle } from 'react-native';

type AnyRecord = Record<string, any>;

export type BotCardItem = {
  id: string;
  name?: string;
  title?: string;
  version?: string;
  description?: string;
} & AnyRecord;

type Props = {
  item: BotCardItem;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
};

/**
 * BotCard — generic card for strategies and bots.
 * - No truncation; text wraps fully.
 * - Shows a checkmark “chip” when selected.
 */
export default function BotCard({ item, selected = false, onPress, style }: Props) {
  const rawName = (item.name || item.title || item.id || '').toString().trim();
  const version = (item.version || '').toString().trim();
  const hasVerInName =
    version.length > 0 &&
    new RegExp(`\\b(v\\s*${escapeRegExp(version)}|\\(${escapeRegExp(version)}\\))\\b`, 'i').test(rawName);
  const title = version && !hasVerInName ? `${rawName} (v${version})` : rawName;

  const description = (item.description || '').toString();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
        style,
      ]}
    >
      {/* checkmark overlay */}
      {selected && (
        <View style={styles.checkWrap}>
          <Text style={styles.checkText}>✓</Text>
        </View>
      )}

      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {!!description && <Text style={styles.desc}>{description}</Text>}
      </View>
    </Pressable>
  );
}

/* -------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignSelf: 'stretch',
    marginVertical: 6,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    minHeight: 72,
    overflow: 'visible',
  },
  cardSelected: {
    borderColor: 'rgba(99,102,241,0.55)',
    backgroundColor: 'rgba(99,102,241,0.08)',
  },
  cardPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  content: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingRight: 28, // leave room for the check chip
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  desc: {
    color: 'rgba(255,255,255,0.78)',
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  checkWrap: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#22c55e', // green
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    color: '#0b0f17',
    fontWeight: '900',
    fontSize: 14,
    lineHeight: 16,
  },
});

/* -------------------------------- utils --------------------------------- */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
