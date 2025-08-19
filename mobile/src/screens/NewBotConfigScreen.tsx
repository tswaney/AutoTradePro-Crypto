import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE as string) || 'http://localhost:4000';

type Draft = {
  name?: string;
  symbols?: string[];   // we pass an array from NewBotScreen
  strategyId?: string;  // preferred
  strategy?: string;    // backward-compat
};

export default function NewBotConfigScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const draft: Draft = route?.params?.draft || {};

  const log = useCallback((...a: any[]) => console.log('[NewBotConfig]', new Date().toISOString(), ...a), []);
  log('API BASE =>', JSON.stringify(API_BASE));
  log('route draft types', JSON.stringify({
    draftType: typeof draft,
    nameType: typeof draft?.name,
    symbolsType: Array.isArray(draft?.symbols) ? 'array' : typeof draft?.symbols,
  }));

  const strategyId = useMemo(() => draft?.strategyId || draft?.strategy || '', [draft]);
  const nameStr = String(draft?.name || '').trim() || `bot-${Math.random().toString(36).slice(2, 6)}`;
  const symbolsStr = useMemo(() => (Array.isArray(draft?.symbols) ? draft!.symbols!.join(',') : ''), [draft]);

  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);

  const fetchDefaults = useCallback(async () => {
    if (!strategyId) return;
    setLoading(true);
    try {
      const url = `${API_BASE}/api/strategies/${encodeURIComponent(strategyId)}/config`;
      log('GET defaults', JSON.stringify(url));
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      log('defaults HTTP', res.status, 'len', text.length);
      let json: any = null;
      try { json = JSON.parse(text); } catch (e: any) { log('defaults parse error', String(e?.message || e)); }
      const defaults = (json && json.defaults) || {};
      // normalize to string values for TextInputs
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(defaults)) normalized[k] = String(v);
      setCfg(normalized);
      log('defaults ok', JSON.stringify({ strategyId: json?.strategyId, keys: Object.keys(normalized).length }));
    } catch (e: any) {
      log('defaults error', String(e?.message || e));
      setCfg({});
    } finally {
      setLoading(false);
    }
  }, [strategyId, log]);

  useEffect(() => { fetchDefaults(); }, [fetchDefaults]);

  const update = (k: string, v: string) => setCfg(prev => ({ ...prev, [k]: v }));

  const onCreate = useCallback(async () => {
    log('Create Bot pressed');
    const name = String(nameStr).trim();
    const symbols = String(symbolsStr).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

    log('coerced inputs', JSON.stringify({ nameStr: name, symbolsStr }));

    if (!strategyId) {
      log('guard fail', JSON.stringify({ miss: 'strategy' }));
      Alert.alert('Missing data', 'Missing strategy');
      return;
    }

    const payload = {
      name,
      strategyId,             // backend expects strategyId
      symbols,                // array
      config: cfg || {},      // whatever was edited or defaults
    };

    try {
      setSubmitting(true);
      log('built payload', JSON.stringify({
        name: payload.name,
        strategyId: payload.strategyId,
        configKeys: Object.keys(payload.config || {}).length,
      }));
      const url = `${API_BASE}/api/bots`;
      log('fetch start', JSON.stringify(url));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const ok = res.ok;
      log('fetch done', JSON.stringify({ ok, status: res.status, textLen: text.length }));
      if (!ok) {
        let errMsg = text;
        try { const j = JSON.parse(text); errMsg = j?.error || errMsg; } catch {}
        Alert.alert('Create failed', String(errMsg).slice(0, 800));
        return;
      }
      log('Create success ->', text.slice(0, 180));
      Alert.alert('Bot created', 'Your bot was created successfully.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      log('Create failed', JSON.stringify(String(e?.message || e)));
      Alert.alert('Create failed', String(e?.message || e));
    } finally {
      setSubmitting(false);
      log('after finally', JSON.stringify({ submitting: false }));
    }
  }, [cfg, nameStr, symbolsStr, strategyId, nav, log]);

  const cfgKeys = Object.keys(cfg || {});

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0f1a' }} contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <Text style={styles.h1}>Configure Strategy</Text>
      <Text style={styles.note}>
        Draft: <Text style={styles.noteBold}>{nameStr}</Text> — Symbols: <Text style={styles.noteBold}>{symbolsStr || '(none)'}</Text>
      </Text>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading defaults…</Text>
        </View>
      ) : cfgKeys.length === 0 ? (
        <Text style={{ color: '#94a3b8', marginTop: 12 }}>No configurable options for this strategy.</Text>
      ) : (
        <View style={{ marginTop: 8 }}>
          {cfgKeys.map((k) => (
            <View key={k} style={{ marginBottom: 12 }}>
              <Text style={styles.label}>{k}</Text>
              <TextInput
                value={cfg[k]}
                onChangeText={(v) => update(k, v)}
                placeholder=""
                placeholderTextColor="#64748b"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.secondaryBtn}>
          <Text style={{ color: '#e5e7eb', fontWeight: '600' }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCreate} disabled={submitting} style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}>
          <Text style={{ color: 'white', fontWeight: '700' }}>{submitting ? 'Creating…' : 'Create Bot'}</Text>
        </TouchableOpacity>
      </View>

      {/* Debug box (tap title to toggle) */}
      <TouchableOpacity onPress={() => setDebugOpen((x) => !x)} style={{ marginTop: 16 }}>
        <Text style={{ color: '#60a5fa', fontWeight: '600' }}>{debugOpen ? 'Hide' : 'Show'} Debug</Text>
      </TouchableOpacity>
      {debugOpen && (
        <View style={styles.debugBox}>
          <Text style={styles.debugText}>Tap “Configure Strategy” 5× to toggle.</Text>
          <Text style={styles.debugText}>API_BASE = {API_BASE}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: '#e5e7eb', fontSize: 22, fontWeight: '700' },
  note: { color: '#9aa4b2', marginTop: 6 },
  noteBold: { color: '#e5e7eb', fontWeight: '700' },
  label: { color: '#9aa4b2', marginBottom: 6 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243447',
    backgroundColor: '#0d1117',
    color: '#cbd5e1',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  loadingBox: { borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0d1117', alignItems: 'center', marginTop: 12 },
  loadingText: { color: '#9aa4b2', marginTop: 8 },
  secondaryBtn: { flex: 1, marginRight: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937' },
  primaryBtn: { flex: 1, marginLeft: 8, backgroundColor: '#1f6feb', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  debugBox: { borderRadius: 12, borderWidth: 1, borderColor: '#2a2f3a', backgroundColor: '#0b1220', padding: 10, marginTop: 8 },
  debugText: { color: '#94a3b8', fontSize: 12 },
});
