// mobile/src/components/LogViewer.tsx
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { colors, spacing, radii, typography } from '../theme/designSystem';

type Props = {
  lines: string[];
  follow: boolean; // auto-scroll when new lines arrive
  unreadCount: number;
  onAtBottomChange?: (atBottom: boolean) => void;
};

export default function LogViewer({ lines, follow, unreadCount, onAtBottomChange }: Props) {
  const scrollRef = useRef<ScrollView | null>(null);

  const MAX_LINES = 3000;
  const displayLines = useMemo(() => {
    if (lines.length <= MAX_LINES) return lines;
    return lines.slice(lines.length - MAX_LINES);
  }, [lines]);

  useEffect(() => {
    if (follow) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [displayLines.length, follow]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const atBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 12;
    onAtBottomChange?.(atBottom);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView ref={scrollRef} onScroll={handleScroll} scrollEventThrottle={48} style={styles.container}>
        <Text selectable style={styles.text}>
          {displayLines.join('\n')}{'\n'}
        </Text>
      </ScrollView>
      {!follow && unreadCount > 0 && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>Paused • {unreadCount} new line{unreadCount === 1 ? '' : 's'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, position: 'relative' },
  container: {
    flex: 1, backgroundColor: '#0A0D12', borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing(1),
  },
  text: { color: colors.text, fontFamily: typography.fontMono, fontSize: 12, lineHeight: 18 },
  snackbar: {
    position: 'absolute', bottom: spacing(1), alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 999,
    paddingHorizontal: spacing(1.5), paddingVertical: 6, borderWidth: 1, borderColor: colors.border,
  },
  snackbarText: { color: colors.textMuted, fontSize: typography.small },
});