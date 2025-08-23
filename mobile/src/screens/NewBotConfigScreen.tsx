import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, StackActions } from '@react-navigation/native';

type RootStackParamList = {
  NewBotConfig: {
    draft?: {
      name?: string;
      symbols?: string[] | string;
      strategyId?: string;
      strategy?: string;
    };
    name?: string;
    symbols?: string;
    strategyId?: string;
  };
  BotDetail: { id: string };
};

type Strategy = { id: string; title?: string; name?: string; description?: string };
type Field = {
  key: string;
  label: string;
  type: 'number' | 'string' | 'enum';
  options?: string[];
  min?: number;
  step?: number;
  default?: any;
};
type StrategyConfig = { id: string; defaults: Record<string, any>; fields: Field[] };

const API_BASE =
  (process as any)?.env?.EXPO_PUBLIC_API_BASE ||
  (global as any)?.EXPO_PUBLIC_API_BASE ||
  'http://localhost:4000';

// Our stack is: Home (bots) -> NewBot -> NewBotConfig, so pop(2) returns to Home reliably
const POP_DEPTH_TO_BOTS = 2;

export default function NewBotConfigScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'NewBotConfig'>>();

  const draft = route.params?.draft ?? {};
  const initialStrategyId = (draft.strategyId || draft.strategy || route.params?.strategyId || '').toString();
  const initialName = (draft.name || route.params?.name || '').toString();
  const initialSymbols = (() => {
    const v = draft.symbols ?? route.params?.symbols;
    if (Array.isArray(v)) return v.join(', ');
    return (v || '').toString();
  })();

  // ---------- Top editable fields ----------
  const [strategyId, setStrategyId] = useState<string>(initialStrategyId);
  const [name, setName] = useState<string>(initialName);
  const [symbols, setSymbols] = useState<string>(initialSymbols);

  // ---------- Strategy picker data ----------
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState<boolean>(true);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);

  // ---------- Strategy config ----------
  const [loadingCfg, setLoadingCfg] = useState<boolean>(true);
  const [cfg, setCfg] = useState<StrategyConfig | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  // ---------- Helpers ----------
  const computeNextBotName = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/bots`);
      const data: Array<{ name?: string; id: string }> = await r.json();
      const nums: number[] = [];
      for (const b of (Array.isArray(data) ? data : [])) {
        const base = String(b.name || b.id);
        const m = base.match(/^bot-(\d+)$/i);
        if (m) nums.push(parseInt(m[1], 10));
      }
      const next = (nums.length ? Math.max(...nums) + 1 : 1);
      setName(`bot-${next}`);
    } catch {
      setName(`bot-${Math.random().toString(36).slice(2, 6)}`);
    }
  }, []);

  const loadStrategies = useCallback(async () => {
    setLoadingStrategies(true);
    try {
      const r = await fetch(`${API_BASE}/api/strategies`);
      const list: Strategy[] = await r.json();
      const items = Array.isArray(list) ? list : [];
      setStrategies(items);
      if (!strategyId && items.length) setStrategyId(items[0].id);
    } catch (e: any) {
      Alert.alert('Load failed', `Could not load strategies: ${String(e?.message || e)}`);
      setStrategies([]);
    } finally {
      setLoadingStrategies(false);
    }
  }, [strategyId]);

  const loadConfig = useCallback(async (id: string) => {
    if (!id) {
      setCfg(null);
      setLoadingCfg(false);
      return;
    }
    setLoadingCfg(true);
    try {
      const r = await fetch(`${API_BASE}/api/strategies/${encodeURIComponent(id)}/config`);
      const data: StrategyConfig = await r.json();
      setCfg(data);
      const initial: Record<string, any> = {};
      for (const f of data.fields || []) initial[f.key] = f.default ?? '';
      setForm(initial);
    } catch (e: any) {
      setCfg(null);
      Alert.alert('Load failed', `Could not load config: ${String(e?.message || e)}`);
    } finally {
      setLoadingCfg(false);
    }
  }, []);

  // ---------- Initial defaults ----------
  useEffect(() => {
    if (!name) computeNextBotName();
    if (!symbols) setSymbols('BTCUSD, SOLUSD');
  }, [name, symbols, computeNextBotName]);

  // ---------- Load strategies on mount ----------
  useEffect(() => { loadStrategies(); }, [loadStrategies]);

  // ---------- Reload config whenever strategyId changes ----------
  useEffect(() => { loadConfig(strategyId); }, [strategyId, loadConfig]);

  // ---------- Derived ----------
  const canCreate = useMemo(
    () => !!strategyId?.trim() && !!name?.trim() && !!symbols?.trim() && !!cfg,
    [strategyId, name, symbols, cfg]
  );

  const onChangeField = (key: string, v: string) => setForm(prev => ({ ...prev, [key]: v }));

  const onCreateBot = useCallback(async () => {
    if (!canCreate) return;
    try {
      const res = await fetch(`${API_BASE}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          symbols: symbols.trim(),
          strategyId: strategyId.trim(),
          config: form,
        }),
      });
      if (res.status !== 201 && res.status !== 200) {
        const text = await res.text();
        throw new Error(text || `Create failed (${res.status})`);
      }
      // Robust: go back to bots list regardless of route names
      navigation.dispatch(StackActions.pop(POP_DEPTH_TO_BOTS));
    } catch (e: any) {
      Alert.alert('Create failed', String(e?.message || e));
    }
  }, [canCreate, name, symbols, strategyId, form, navigation]);

  const currentStrategyTitle =
    strategies.find(s => s.id === strategyId)?.title ||
    strategies.find(s => s.id === strategyId)?.name ||
    strategyId;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.h1}>Configure Bot</Text>

            {/* Strategy picker */}
            <Text style={styles.label}>Strategy</Text>
            <Pressable onPress={() => setPickerOpen(true)} style={[styles.input, styles.pickField]}>
              <Text style={currentStrategyTitle ? styles.pickText : styles.pickPlaceholder}>
                {currentStrategyTitle || 'Tap to choose a strategy'}
              </Text>
            </Pressable>

            {/* Name */}
            <Text style={styles.label}>Name</Text>
            <TextInput
              placeholder="bot-1"
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
              style={styles.input}
            />

            {/* Symbols */}
            <Text style={styles.label}>Symbols</Text>
            <TextInput
              placeholder="BTCUSD, SOLUSD"
              value={symbols}
              onChangeText={setSymbols}
              autoCapitalize="characters"
              style={styles.input}
            />

            <View style={styles.divider} />

            {/* Strategy params */}
            {loadingCfg ? (
              <View style={styles.loading}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>Loading config…</Text>
              </View>
            ) : !cfg ? (
              <Text style={styles.error}>No config available for this strategy.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {cfg.fields.map((f) => (
                  <View key={f.key} style={{ gap: 6 }}>
                    <Text style={styles.label}>{f.label}</Text>
                    <TextInput
                      placeholder={f.label}
                      value={String(form[f.key] ?? '')}
                      onChangeText={(t) => onChangeField(f.key, t)}
                      inputMode={f.type === 'number' ? 'decimal' : 'text'}
                      keyboardType={f.type === 'number' ? 'decimal-pad' : 'default'}
                      autoCapitalize="none"
                      style={styles.input}
                    />
                  </View>
                ))}
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable style={[styles.btn, styles.secondary]} onPress={() => navigation.goBack()}>
              <Text style={styles.btnText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary, !canCreate && styles.btnDisabled]}
              disabled={!canCreate}
              onPress={onCreateBot}
            >
              <Text style={styles.btnText}>Create Bot</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Strategy Picker Modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose Strategy</Text>
            {loadingStrategies ? (
              <View style={styles.loading}><ActivityIndicator /><Text style={styles.loadingText}>Loading…</Text></View>
            ) : (
              <FlatList
                data={strategies}
                keyExtractor={(s) => s.id}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => { setStrategyId(item.id); setPickerOpen(false); }}
                    style={styles.modalRow}
                  >
                    <Text style={styles.modalRowTitle}>{item.title || item.name || item.id}</Text>
                    {!!item.description && <Text style={styles.modalRowDesc}>{item.description}</Text>}
                  </Pressable>
                )}
                style={{ maxHeight: 420 }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 24 },
  h1: { color: '#e2e8f0', fontWeight: '800', fontSize: 20, marginBottom: 10 },
  label: { color: '#cbd5e1', fontWeight: '600', marginBottom: 6 },
  input: {
    color: '#e2e8f0',
    backgroundColor: '#0f172a',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  pickField: { justifyContent: 'center' },
  pickText: { color: '#e2e8f0' },
  pickPlaceholder: { color: '#64748b' },
  divider: { height: 1, backgroundColor: '#1f2937', marginVertical: 12 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  loadingText: { color: '#a0aec0' },
  error: { color: '#f87171' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b1220',
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primary: { backgroundColor: '#2563eb' },
  secondary: { backgroundColor: '#374151' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderColor: '#1f2937',
    borderWidth: 1,
    padding: 14,
  },
  modalTitle: { color: '#e2e8f0', fontWeight: '800', fontSize: 16, marginBottom: 10 },
  modalRow: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#0b1220',
    borderColor: '#1f2937',
    borderWidth: 1,
  },
  modalRowTitle: { color: '#e2e8f0', fontWeight: '700' },
  modalRowDesc: { color: '#cbd5e1', marginTop: 4, lineHeight: 18 },
});
