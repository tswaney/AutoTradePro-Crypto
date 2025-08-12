import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSnack } from '../components/Snack';

export default function Auth({ navigation, onSignedIn }: any) {
  const snack = useSnack();

  const signIn = async () => {
    // If you have a real sign-in, call it here then:
    onSignedIn?.();
    snack.show?.('Signed in');
  };

  const useSample = async () => {
    onSignedIn?.();
    snack.show?.('Using sample bot');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.box}>
        <Text style={styles.title}>AutoTradePro Crypto</Text>
        <Text style={styles.subtitle}>Sign in to continue or try the sample bot.</Text>

        <View style={{ height: 16 }} />

        <TouchableOpacity onPress={signIn} style={styles.btn}>
          <Text style={styles.btnText}>Sign in</Text>
        </TouchableOpacity>

        <View style={{ height: 10 }} />

        <TouchableOpacity onPress={useSample} style={[styles.btn, styles.btnGhost]}>
          <Text style={[styles.btnText, { color: '#0A63FF' }]}>Use Sample Bot</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  box: {
    width: '86%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fafafa',
  },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { marginTop: 6, color: '#666' },
  btn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#0A63FF',
  },
  btnGhost: {
    backgroundColor: '#E7F1FF',
  },
  btnText: { color: 'white', fontWeight: '700' },
});
