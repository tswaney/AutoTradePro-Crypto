// mobile/src/components/LogViewer.tsx
import React, { useEffect, useMemo, useRef } from "react";
import { FlatList, Text, View } from "react-native";

type LogViewerProps = {
  lines?: string[];        // may be undefined initially
  follow?: boolean;        // auto-scroll to bottom
  style?: any;
  textStyle?: any;
  emptyText?: string;
};

export default function LogViewer({
  lines = [],              // ✅ default to empty array
  follow = true,
  style,
  textStyle,
  emptyText = "No log output yet…",
}: LogViewerProps) {
  const ref = useRef<FlatList<string>>(null);

  // ✅ Always return an array
  const data = useMemo<string[]>(
    () => (Array.isArray(lines) ? lines : []),
    [lines]
  );

  useEffect(() => {
    if (!follow || !ref.current) return;
    // scroll to end on new lines
    if (data.length > 0) {
      setTimeout(() => {
        ref.current?.scrollToEnd({ animated: true });
      }, 0);
    }
  }, [data, follow]);

  if (!data.length) {
    return (
      <View style={[{ padding: 12 }, style]}>
        <Text style={[{ opacity: 0.6 }, textStyle]}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={ref}
      data={data}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item }) => (
        <Text style={[{ fontFamily: "Menlo", fontSize: 12, lineHeight: 18 }, textStyle]}>
          {item}
        </Text>
      )}
      contentContainerStyle={[{ padding: 12 }, style]}
      // keep performance smooth with long logs
      initialNumToRender={40}
      maxToRenderPerBatch={60}
      windowSize={10}
      removeClippedSubviews
    />
  );
}
