// /mobile/src/screens/Auth.tsx
import React, { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import SignInScreen from '../screens/SignInScreen';  // modern sign-in UI
import { apiPost } from '../api';                  // shim next to App.tsx
import { colors, spacing, typography } from '../theme/designSystem';
import { useSnack } from '../components/Snack';

const SIGNED_KEY = 'autotradepro.signedIn';
const allowGuest = __DEV__; // show bypass in dev builds only

export default function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const snack = useSnack();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (email: string, password: string) => {
    setError(null);
    setBusy(true);
    try {
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
      setError(msg);
      snack.show?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDevBypass = async () => {
    try {
      await SecureStore.setItemAsync(SIGNED_KEY, '1');
      snack.show?.('Signed in (dev bypass)');
      onSignedIn?.();
    } catch (e:any) {
      snack.show?.(e?.message || 'Bypass failed');
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
        {!!error && <Text style={styles.error}>{error}</Text>}
        <SignInScreen onSubmit={handleSubmit} />
        {allowGuest && (
          <View style={styles.devBlock}>
            <TouchableOpacity onPress={handleDevBypass} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnText}>Continue without sign-in (dev)</Text>
            </TouchableOpacity>
            <Text style={styles.devNote}>Temporary bypass for testing. Remove before release.</Text>
          </View>
        )}
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
  devBlock: { marginTop: spacing(2), paddingHorizontal: spacing(2) },
  btn: { paddingVertical: spacing(1), alignItems: 'center', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: '#2A3340' },
  btnGhost: { backgroundColor: '#1A1F28' },
  btnText: { fontWeight: '700', color: '#E6EDF3' },
  devNote: { color: '#97A3B6', textAlign: 'center', marginTop: spacing(0.5), fontSize: typography.small },
});
