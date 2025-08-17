// /mobile/src/screens/NewBotConfigScreen.tsx
import React from 'react';
import {
  Alert, SafeAreaView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, FlatList, Switch, ActivityIndicator, Platform
} from 'react-native';
import { apiGet, apiPost } from '../api/client';

type FieldType = 'number'|'string'|'boolean';
type Field = { key: string; value: string; type: FieldType };

// ---------- grouping rules ----------
type SectionKey =
  | 'general'
  | 'grid'
  | 'atr'
  | 'profitLock'
  | 'dca'
  | 'regime'
  | 'signals'
  | 'advanced';

const SECTION_META: Record<SectionKey, { title: string; advanced?: boolean; order: number }> = {
  general:    { title: 'General',                order: 10 },
  grid:       { title: 'Grid',                   order: 20 },
  atr:        { title: 'ATR',                    order: 30 },
  profitLock: { title: 'Profit Lock',            order: 40 },
  dca:        { title: 'DCA / Accumulate',       order: 50 },
  regime:     { title: 'Regime / Dynamic',       order: 60 },
  signals:    { title: 'Signals / Indicators',   order: 70 },
  advanced:   { title: 'Advanced', advanced: true, order: 1000 },
};

function groupForKey(k: string): SectionKey {
  const K = k.toUpperCase();

  // core buckets
  if (K.startsWith('GRID_')) return 'grid';
  if (K.startsWith('ATR_')) return 'atr';
  if (K.startsWith('PROFIT_LOCK_')) return 'profitLock';
  if (K.startsWith('DCA_') || K.startsWith('ACCUM_') || K.startsWith('ACCUMULATE_')) return 'dca';
  if (K.startsWith('REGIME_') || K.startsWith('DYNAMIC_')) return 'regime';
  if (K.startsWith('SMA_') || K.startsWith('EMA_') || K.startsWith('VWAP_') || K.startsWith('RSI_')) return 'signals';

  // advanced buckets (collapsed by default)
  if (K.startsWith('AUTO_TUNE_')) return 'advanced';
  if (K.startsWith('ULTIMATE_'))  return 'advanced';
  if (K.startsWith('SUPER_'))     return 'advanced';
  if (K.startsWith('RISK_'))      return 'advanced';
  if (K.startsWith('REINVESTMENT_')) return 'advanced';
  if (K.includes('DRAW') && K.includes('BRAKE')) return 'advanced';
  if (K.startsWith('WEIGHTED_'))  return 'advanced';
  if (/^LEVELS?$/.test(K) || K.startsWith('LEVEL_')) return 'advanced';
  if (K.startsWith('PULLBACK_'))  return 'advanced';
  if (K.startsWith('FLAT_PROFIT_')) return 'advanced';
  if (K.startsWith('DEBUG') || K.startsWith('LOG_') || K.includes('EXPERIMENT')) return 'advanced';

  return 'general';
}

// ---------- type helpers ----------
function inferType(_k: string, v: any): FieldType {
  const s = String(v ?? '').trim();
  if (/^(true|false)$/i.test(s)) return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'number';
  return 'string';
}

type Row =
  | { kind: 'section'; key: string; section: SectionKey; title: string; count: number; advanced?: boolean; collapsed: boolean }
  | { kind: 'field'; key: string; section: SectionKey; field: Field };

export default function NewBotConfigScreen({ route, navigation }: any) {
  const draft = route.params?.draft || {};
  const strategy = route.params?.strategy || null;

  const [fields, setFields] = React.useState<Field[]>([]);
  const [collapsed, setCollapsed] = React.useState<Record<SectionKey, boolean>>({
    general: false,
    grid: false,
    atr: false,
    profitLock: false,
    dca: false,
    regime: false,
    signals: false,
    advanced: true, // Advanced hidden by default
  });
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const loadDefaults = React.useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await apiGet(`/strategies/${encodeURIComponent(draft.strategyId)}/config`);
      const entries = Object.entries(cfg?.defaults || {});
      const list: Field[] = entries.map(([key, val]: any) => ({
        key,
        value: String(val ?? ''),
        type: inferType(key, val),
      })).sort((a,b) => a.key.localeCompare(b.key));
      setFields(list);
    } catch {
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [draft.strategyId]);

  React.useEffect(() => { loadDefaults(); }, [loadDefaults]);

  const updateField = (k: string, v: string) =>
    setFields(fs => fs.map(f => f.key === k ? { ...f, value: v } : f));

  const toggleBool = (k: string) =>
    setFields(fs => fs.map(f => f.key === k ? { ...f, value: (String(f.value).toLowerCase() === 'true' ? 'false' : 'true') } : f));

  const toggleSection = (s: SectionKey) =>
    setCollapsed(c => ({ ...c, [s]: !c[s] }));

  // Build rows (section headers + visible fields)
  const rows: Row[] = React.useMemo(() => {
    // bucket fields
    const buckets: Record<SectionKey, Field[]> = {
      general: [], grid: [], atr: [], profitLock: [], dca: [], regime: [], signals: [], advanced: [],
    };
    for (const f of fields) buckets[groupForKey(f.key)].push(f);

    // order sections and build rows
    const sections = (Object.keys(buckets) as SectionKey[])
      .filter((s) => buckets[s].length > 0)
      .sort((a, b) => SECTION_META[a].order - SECTION_META[b].order);

    const out: Row[] = [];
    for (const s of sections) {
      const meta = SECTION_META[s];
      out.push({
        kind: 'section',
        key: `__header__${s}`,
        section: s,
        title: meta.title,
        count: buckets[s].length,
        advanced: !!meta.advanced,
        collapsed: !!collapsed[s],
      });
      if (!collapsed[s]) {
        for (const f of buckets[s]) {
          out.push({ kind: 'field', key: f.key, section: s, field: f });
        }
      }
    }
    return out;
  }, [fields, collapsed]);

  const resetLocalChanges = () => loadDefaults();

  const create = async () => {
    setSubmitting(true);
    try {
      const config = Object.fromEntries(fields.map(f => [f.key, String(f.value ?? '')]));
      const res = await apiPost('/bots', { ...draft, config });
      if (res?.id) return navigation.replace('BotDetail', { botId: res.id, botName: draft.name });
      Alert.alert('Error', 'Unexpected response creating bot');
    } catch (e:any) {
      Alert.alert('Error', e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (item: Field) => {
    const isBool = item.type === 'boolean';
    const isNum = item.type === 'number';
    return (
      <View style={styles.row}>
        <Text style={styles.k}>{item.key}</Text>
        {isBool ? (
          <View style={styles.switchWrap}>
            <Text style={styles.boolLabel}>{String(item.value).toLowerCase()==='true' ? 'On' : 'Off'}</Text>
            <Switch
              value={String(item.value).toLowerCase() === 'true'}
              onValueChange={() => toggleBool(item.key)}
            />
          </View>
        ) : (
          <TextInput
            value={item.value}
            onChangeText={(t)=>updateField(item.key,t)}
            style={styles.input}
            placeholderTextColor="#7A8797"
            keyboardType={isNum ? (Platform.OS === 'ios' ? 'decimal-pad' : 'numeric') : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      </View>
    );
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'section') {
      const chevron = item.collapsed ? '▸' : '▾';
      return (
        <TouchableOpacity style={[styles.sectionHdr, item.advanced && styles.sectionHdrAdv]} onPress={() => toggleSection(item.section)}>
          <Text style={styles.sectionTitle}>{chevron} {item.title}</Text>
          <Text style={styles.sectionCount}>{item.count}</Text>
        </TouchableOpacity>
      );
    }
    return renderField(item.field);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1117' }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Text style={styles.h1}>Bot Settings</Text>
        <Text style={styles.sub}>
          Strategy: <Text style={styles.bold}>
            {strategy?.name || draft.strategyId}{strategy?.version ? ` (${strategy.version})` : ''}
          </Text>
        </Text>
        <Text style={styles.sub}>
          Bot name: <Text style={styles.bold}>{draft?.name}</Text>
        </Text>
        <Text style={styles.sub}>
          Symbols: <Text style={styles.bold}>{Array.isArray(draft?.symbols) ? draft.symbols.join(', ') : String(draft?.symbols || '')}</Text>
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No configurable options detected for this strategy.</Text>
              <Text style={styles.emptyTextDim}>
                You can still create the bot with the current environment defaults.
              </Text>
            </View>
          }
          showsVerticalScrollIndicator
          indicatorStyle="white"
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity onPress={resetLocalChanges} style={[styles.btn, styles.ghost]} disabled={loading || submitting}>
          <Text style={styles.btnGhostText}>Reload defaults</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={create} style={styles.btn} disabled={loading || submitting}>
          <Text style={styles.btnText}>{submitting ? 'Creating…' : 'Create & Open'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1:{ color:'#E6EDF3', fontWeight:'700', fontSize:20, marginBottom:6 },
  sub:{ color:'#97A3B6', marginTop:2 },
  bold:{ color:'#E6EDF3', fontWeight:'700' },

  sectionHdr:{
    marginTop: 12, paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1A2430',
    backgroundColor: '#0E1520', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  sectionHdrAdv:{
    backgroundColor: '#0B1117',
  },
  sectionTitle:{ color:'#E6EDF3', fontWeight:'700' },
  sectionCount:{ color:'#97A3B6', fontWeight:'700' },

  row:{ paddingHorizontal: 16, paddingVertical:10 },
  k:{ color:'#97A3B6', marginBottom:6, fontSize:12 },
  input:{ color:'#E6EDF3', borderWidth:1, borderColor:'#2A3340', borderRadius:12, paddingHorizontal:12, paddingVertical:10, backgroundColor:'#0B1117' },

  switchWrap:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth:1, borderColor:'#2A3340', borderRadius:12, paddingHorizontal:12, paddingVertical:10, backgroundColor:'#0B1117' },
  boolLabel:{ color:'#E6EDF3', marginRight: 8 },

  emptyBox:{ borderWidth:1, borderColor:'#2A3340', borderRadius:12, padding:16, alignItems:'center', marginHorizontal:16, marginTop:12 },
  emptyText:{ color:'#E6EDF3', fontWeight:'600' },
  emptyTextDim:{ color:'#97A3B6', marginTop:4 },

  footer:{ padding:16, flexDirection:'row', gap:10, borderTopWidth:1, borderTopColor:'#1A2430', backgroundColor:'#0B1117' },
  btn:{ flex:1, backgroundColor:'#0E2B5E', borderRadius:12, paddingVertical:12, alignItems:'center' },
  btnText:{ color:'white', fontWeight:'700' },
  ghost:{ backgroundColor:'#0F1520', borderWidth:1, borderColor:'#2A3340' },
  btnGhostText:{ color:'#C9D4E3', fontWeight:'700' },
});
