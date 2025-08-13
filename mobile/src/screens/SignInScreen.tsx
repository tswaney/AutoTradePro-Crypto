// mobile/src/screens/SignInScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography, cardStyle } from '../theme/designSystem';

type Props = { onSubmit?: (email: string, password: string) => void };

export default function SignInScreen({ onSubmit }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null); setLoading(true);
    try { await onSubmit?.(email.trim(), password); }
    catch (e: any) { setError(e?.message || 'Sign in failed. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>AutoTradePro</Text>
        <Text style={styles.subtitle}>Secure sign in</Text>
      </View>
      <View style={styles.card}>
        <View style={{gap: spacing(1)}}>
          <View>
            <Text style={styles.label}>Email</Text>
            <TextInput placeholder="you@example.com" placeholderTextColor={colors.textMuted}
              value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input}/>
          </View>
          <View>
            <Text style={styles.label}>Password</Text>
            <TextInput placeholder="••••••••" placeholderTextColor={colors.textMuted}
              value={password} onChangeText={setPassword} secureTextEntry style={styles.input}/>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={[styles.button, loading && {opacity: 0.7}]} disabled={loading} onPress={handleSignIn}>
            {loading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign in</Text>}
          </TouchableOpacity>
          <Text style={styles.help}>By continuing you agree to the Terms and Privacy Policy.</Text>
        </View>
      </View>
      <Text style={styles.footer}>v1.0 • {new Date().getFullYear()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing(2), justifyContent: 'center' },
  header: { marginBottom: spacing(3), alignItems: 'center' },
  brand: { color: colors.text, fontSize: typography.h1, fontWeight: '700', letterSpacing: 0.5 },
  subtitle: { color: colors.textMuted, marginTop: spacing(0.5), fontSize: typography.body },
  card: { ...cardStyle, padding: spacing(2), marginHorizontal: spacing(1) },
  label: { color: colors.textMuted, marginBottom: 6, fontSize: typography.small },
  input: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25), fontSize: typography.body,
  },
  button: { backgroundColor: colors.primary, borderRadius: radii.xl, paddingVertical: spacing(1.25), alignItems: 'center', marginTop: spacing(1) },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: typography.body },
  help: { color: colors.textMuted, marginTop: spacing(1), textAlign: 'center', fontSize: typography.small },
  error: { color: colors.danger, fontSize: typography.small, marginTop: spacing(0.5) },
  footer: { color: colors.textMuted, textAlign: 'center', marginTop: spacing(2), fontSize: typography.small },
});