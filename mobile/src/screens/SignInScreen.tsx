// mobile/src/screens/SignInScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { colors, spacing, radii, typography, cardStyle } from '../theme/designSystem';

type Props = {
  onSubmit?: (email: string, password: string) => Promise<void> | void;
};

export default function SignInScreen({ onSubmit }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (e: string, p: string) => {
    setError(null);
    setLoading(true);
    try { await onSubmit?.(e.trim(), p); }
    catch (err: any) { setError(err?.message || 'Sign in failed'); }
    finally { setLoading(false); }
  };

  const handleSignIn = () => handle(email, password);
  const handleDemo = () => handle('demo@autotradepro.local', 'demo');

  return (
    <SafeAreaView style={styles.container}>
      {/* content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>AutoTradePro</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        <View style={styles.card}>
          <View style={{ gap: spacing(1) }}>
            <View>
              <Text style={styles.label}>Email</Text>
              <TextInput
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
            </View>

            <View>
              <Text style={styles.label}>Password</Text>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={styles.input}
              />
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.buttonPrimary, loading && { opacity: 0.7 }]}
              disabled={loading}
              onPress={handleSignIn}
            >
              {loading ? <ActivityIndicator /> : <Text style={styles.buttonPrimaryText}>Sign in</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* footer — DEMO button stays at the very bottom (like your zip) */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.buttonSecondary} disabled={loading} onPress={handleDemo}>
          <Text style={styles.buttonSecondaryText}>Demo sign in</Text>
        </TouchableOpacity>
        <Text style={styles.legal}>By continuing you agree to the Terms and Privacy Policy.</Text>
        <Text style={styles.version}>v1.0 • {new Date().getFullYear()}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing(2) },
  content: { flex: 1, justifyContent: 'center' },
  header: { marginBottom: spacing(3), alignItems: 'center' },
  brand: { color: colors.text, fontSize: typography.h1, fontWeight: '700', letterSpacing: 0.5 },
  subtitle: { color: colors.textMuted, marginTop: spacing(0.5), fontSize: typography.body },

  card: { ...cardStyle, padding: spacing(2), marginHorizontal: spacing(1) },

  label: { color: colors.textMuted, marginBottom: 6, fontSize: typography.small },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1.25),
    fontSize: typography.body,
  },

  buttonPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing(1.25),
    alignItems: 'center',
    marginTop: spacing(1),
  },
  buttonPrimaryText: { color: '#fff', fontWeight: '600', fontSize: typography.body },

  // Bottom footer
  footer: { paddingVertical: spacing(2), alignItems: 'center', gap: spacing(1) },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderRadius: radii.lg,
    paddingVertical: spacing(1.1),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    width: '100%',
  },
  buttonSecondaryText: { color: colors.primary, fontWeight: '600', fontSize: typography.body, textAlign: 'center' },

  legal: { color: colors.textMuted, marginTop: spacing(1), textAlign: 'center', fontSize: typography.small },
  version: { color: colors.textMuted, textAlign: 'center', fontSize: typography.small },
  error: { color: colors.danger, fontSize: typography.small, marginTop: spacing(0.5) },
});
