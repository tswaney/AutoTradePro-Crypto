import React, { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, Platform } from 'react-native';

export default function LogViewer({
  lines,
  follow = true,
  maxHeight = 420,
}: { lines: string[]; follow?: boolean; maxHeight?: number }) {
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (follow && listRef.current) {
      try { listRef.current.scrollToEnd({ animated: false }); } catch {}
    }
  }, [lines, follow]);

  return (
    <View style={[styles.shell, { maxHeight }]}>
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <Text style={styles.line} selectable>{item}</Text>}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        indicatorStyle="white"
        initialNumToRender={50}
        windowSize={15}
        getItemLayout={(_, index) => ({ length: LINE_H, offset: LINE_H * index, index })}
        contentContainerStyle={{ paddingVertical: 6, paddingHorizontal: 10 }}
      />
    </View>
  );
}

const LINE_H = 18;

const styles = StyleSheet.create({
  shell: {
    borderWidth: 1, borderColor: '#2A3340', borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#0A0F14',
  },
  line: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: LINE_H,
    color: '#DAE0E9',
  },
});
