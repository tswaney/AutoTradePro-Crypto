
import React, { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { apiPost } from '../api';
import { useSnack } from '../components/Snack';

const SIGNED_KEY = 'autotradepro.signedIn';

export default function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const snack = useSnack();
  const [busy, setBusy] = useState<'sign'|'sample'|null>(null);

  const signIn = async () => {
    if (busy) return;
    setBusy('sign');
    try {
      // if you have a real auth, call it here; for now we just set a flag
      await SecureStore.setItemAsync(SIGNED_KEY, '1');
      onSignedIn();
    } catch (e: any) {
      snack.show?.(e?.message || 'Sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  const useSample = async () => {
    if (busy) return;
    setBusy('sample');
    try {
      await SecureStore.setItemAsync(SIGNED_KEY, '1');
      // optional: spin up a demo bot, ignore errors
      try { await apiPost('/bots/local-test/start'); } catch {}
      onSignedIn();
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to continue');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={styles.container}>
        <Text style={styles.brand}>AutoTradePro</Text>
        <View style={styles.card}>
          <TouchableOpacity onPress={signIn} disabled={busy!==null} style={[styles.bigBtn, styles.bigBtnPrimary, busy && styles.bigBtnDisabled]}>
            <Text style={styles.bigBtnText}>{busy==='sign' ? 'Signing in…' : 'Sign in'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={useSample} disabled={busy!==null} style={[styles.bigBtn, styles.bigBtnGhost, busy && styles.bigBtnDisabled]}>
            <Text style={styles.bigBtnText}>{busy==='sample' ? 'Continuing…' : 'Use Sample Bot'}</Text>
          </TouchableOpacity>
        </View>
        {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  brand: { fontSize: 28, fontWeight: '800', marginBottom: 16 },
  card: {
    width: '88%',
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  bigBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#D1D5DB',
  },
  bigBtnPrimary: { backgroundColor: '#E7F1FF' },
  bigBtnGhost: { backgroundColor: '#F2F2F2' },
  bigBtnDisabled: { opacity: 0.6 },
  bigBtnText: { fontSize: 16, fontWeight: '600' },
});
