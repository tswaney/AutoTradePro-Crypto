// mobile/src/screens/Auth.tsx
import React, { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import SignInScreen from '../screens/SignInScreen';  // modern sign-in UI
import { apiPost } from '../api';                  // the shim next to App.tsx
import { colors, spacing, typography } from '../theme/designSystem';
import { useSnack } from '../components/Snack';

const SIGNED_KEY = 'autotradepro.signedIn';

export default function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const snack = useSnack();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (email: string, password: string) => {
    setError(null);
    setBusy(true);
    try {
      // Try common auth endpoints; adjust to match your backend if needed.
      const tryReq = async (url: string) => {
        try { await apiPost(url, { email, password }); return true; } catch { return false; }
      };
      const ok =
        await tryReq('/auth/login') ||
        await tryReq('/auth/signin') ||
        await tryReq('/api/auth/login');

      if (!ok) throw new Error('Sign in failed');
      await SecureStore.setItemAsync(SIGNED_KEY, '1');
      onSignedIn?.();
    } catch (e: any) {
      const msg = e?.message || 'Sign in failed';
      setError(msg);                 // show inline
      snack.show?.(msg);             // and toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.wrap}>
        {busy && (
          <View style={styles.overlay}>
            <ActivityIndicator />
          </View>
        )}
        {/* IMPORTANT: any text is wrapped in <Text> */}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <SignInScreen onSubmit={handleSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  overlay: {
    position: 'absolute', right: spacing(2), top: spacing(2), zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: spacing(1), paddingVertical: 4, borderRadius: 8,
  },
  error: { color: '#EF4444', textAlign: 'center', marginTop: spacing(1), marginHorizontal: spacing(2), fontSize: typography.small },
});
