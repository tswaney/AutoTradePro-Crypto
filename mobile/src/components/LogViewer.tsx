// /mobile/src/components/LogViewer.tsx
import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, Platform } from 'react-native';

type Props = { lines: string[]; follow: boolean };

export default function LogViewer({ lines, follow }: Props) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => {
    if (follow && ref.current) setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 0);
  }, [lines.length, follow]);

  return (
    <View style={styles.box}>
      <ScrollView ref={ref}>
        {(lines.length ? lines : ['— no logs yet —']).map((ln, i) => (
          <Text key={i} style={styles.line}>{ln}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 260, borderRadius: 12, borderWidth: 1, borderColor: '#2A3340', backgroundColor: '#0B1117', padding: 8 },
  line: { color: '#D1D7E0', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string, fontSize: 12, lineHeight: 16 },
});
