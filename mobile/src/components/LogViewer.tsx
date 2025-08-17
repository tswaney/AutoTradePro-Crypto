// src/components/LogViewer.tsx
import React, { useEffect, useMemo, useRef } from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';

type Props = { lines: string[]; follow?: boolean };

export default function LogViewer({ lines, follow = true }: Props) {
  const ref = useRef<FlatList<string>>(null);
  const data = useMemo(() => lines.map((s, i) => `${i}│${s}`), [lines]);

  useEffect(() => {
    if (!follow || !ref.current) return;
    requestAnimationFrame(() => ref.current?.scrollToEnd?.({ animated: true }));
  }, [data.length, follow]);

  const renderItem = ({ item }: { item: string }) => {
    const line = item.slice(item.indexOf('│') + 1);
    return <Text selectable style={styles.line}>{line}</Text>;
  };

  return (
    <View style={styles.box}>
      <FlatList
        ref={ref}
        data={data}
        keyExtractor={(s) => s}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 8 }}
        initialNumToRender={50}
        maxToRenderPerBatch={120}
        windowSize={9}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#2A3340',
    borderRadius: 12,
    backgroundColor: '#0B0F14',
    minHeight: 220,
    maxHeight: 360,
  },
  line: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 16,
    color: '#DAE0E9',
  },
});
