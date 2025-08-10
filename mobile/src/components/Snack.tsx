// mobile/src/components/Snack.tsx
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

type SnackContextValue = { show: (msg: string, ms?: number) => void };
const SnackContext = createContext<SnackContextValue | null>(null);

export const useSnack = () => {
  const ctx = useContext(SnackContext);
  if (!ctx) throw new Error("useSnack must be used within <SnackProvider>");
  return ctx;
};

export const SnackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [msg, setMsg] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.quad) })
      .start(() => setMsg(null));
  }, [opacity]);

  const show = useCallback((m: string, ms = 2000) => {
    setMsg(m);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true, easing: Easing.out(Easing.quad) })
      .start(() => {
        setTimeout(hide, ms);
      });
  }, [hide, opacity]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <SnackContext.Provider value={value}>
      {children}
      {msg && (
        <Animated.View style={[styles.container, { opacity }]}>
          <View style={styles.snack}>
            <Text style={styles.text}>{msg}</Text>
          </View>
        </Animated.View>
      )}
    </SnackContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0, right: 0, bottom: 28,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  snack: {
    backgroundColor: "rgba(20,20,20,0.95)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { color: "#fff", fontWeight: "600" },
});
