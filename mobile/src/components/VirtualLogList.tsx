// mobile/src/components/VirtualLogList.tsx
import React, { useMemo } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../theme/designSystem';

type Props = { lines: string[] };

export default function VirtualLogList({ lines }: Props) {
  const data = useMemo(() => lines.map((t, i) => ({ id: String(i), t })), [lines]);
  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        renderItem={({ item }) => <Text selectable style={styles.line}>{item.t}</Text>}
        keyExtractor={(i) => i.id}
        initialNumToRender={80}
        maxToRenderPerBatch={160}
        removeClippedSubviews
        windowSize={9}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0A0D12', borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing(1),
  },
  line: { color: colors.text, fontFamily: typography.fontMono, fontSize: 12, lineHeight: 18 },
});