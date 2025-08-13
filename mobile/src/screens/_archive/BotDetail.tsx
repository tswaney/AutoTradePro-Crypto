
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';

import { apiGet, apiPost, openLogsSocket } from './api';
import { useSnack } from './components/Snack';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string; name: string; status: BotStatus;
  mode?: string; strategy?: string; strategyFile?: string;
  symbols?: string[]; pairs?: string[];
};

export default function BotDetail({ botId, botName }: { botId: string; botName: string }) {
  const snack = useSnack();
  const [bot, setBot] = useState<Bot | null>(null);
  const [inFlight, setInFlight] = useState(false);

  const [lines, setLines] = useState<string[]>([]);
  const [transport, setTransport] = useState<'websocket'|'polling'|'idle'>('idle');
  const [frozen, setFrozen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  const cursorRef = useRef(0);
  const listRef = useRef<FlatList<string> | null>(null);
  const frozenRef = useRef(false);
  const atBottomRef = useRef(true);
  const runningRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => { frozenRef.current = frozen; }, [frozen]);
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);

  const fetchOne = useCallback(async () => {
    try {
      const d = await apiGet(`/bots/${botId}`);
      setBot(d);
      runningRef.current = d?.status === 'running';
      return d;
    } catch (e: any) { snack.show?.(e?.message || 'Failed to load bot'); }
  }, [botId, snack]);

  useEffect(() => { fetchOne(); }, [fetchOne]);

  const appendLines = useCallback((incoming: string[]) => {
    if (!incoming || !incoming.length) return;
    setLines(prev => {
      const next = [...prev, ...incoming.map(String)];
      if (next.length > 2000) next.splice(0, next.length - 2000);
      return next;
    });
    if (frozenRef.current || !atBottomRef.current) setPendingCount(c => c + incoming.length);
    else reliableScrollToEnd();
  }, []);

  const reliableScrollToEnd = useCallback(() => {
    const go = (n: number) => requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
      if (n > 0) go(n - 1);
    });
    go(2);
  }, []);

  // worker
  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!bot || bot.status !== 'running') { setTransport('idle'); return; }

    let ws: any | null = null; let poll: any | null = null; let closedByUs = false;
    const stopWorker = () => {
      closedByUs = true;
      try { ws?.close?.(); } catch {}
      if (poll) clearInterval(poll);
      setTransport('idle');
    };
    cleanupRef.current = stopWorker;
    runningRef.current = true;

    const startPolling = () => {
      setTransport('polling');
      const tick = async () => {
        if (!runningRef.current) return;
        try {
          const res = await apiGet(`/bots/${botId}/logs?cursor=${cursorRef.current}`);
          if (res?.lines?.length) appendLines(res.lines);
          if (typeof res?.cursor === 'number') cursorRef.current = res.cursor;
        } catch {}
      };
      tick(); poll = setInterval(tick, 1000);
    };

    if (typeof openLogsSocket === 'function') {
      try {
        ws = openLogsSocket(botId);
        if (ws) {
          setTransport('websocket');
          const onMessage = (evt: any) => {
            if (!runningRef.current) return;
            const payload = typeof evt?.data === 'string' ? evt.data : (typeof evt === 'string' ? evt : '');
            if (payload) appendLines([payload]);
          };
          ws.addEventListener?.('message', onMessage);
          ws.onmessage = ws.onmessage || onMessage;
          const onClose = () => { if (!closedByUs && runningRef.current) startPolling(); };
          ws.addEventListener?.('close', onClose);
          ws.onclose = ws.onclose || onClose;
        } else startPolling();
      } catch { startPolling(); }
    } else startPolling();

    return stopWorker;
  }, [appendLines, bot, botId]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const tol = 30;
    const bottomY = Math.max(0, contentSize.height - layoutMeasurement.height - tol);
    setAtBottom(contentOffset.y >= bottomY || contentSize.height <= layoutMeasurement.height + tol);
  };

  const onContentSizeChange = () => {
    if (!frozenRef.current && atBottomRef.current) reliableScrollToEnd();
  };

  const start = async () => {
    if (!bot) return;
    if (bot.status === 'running' || bot.status === 'starting') { snack.show?.('Already running'); return; }
    setInFlight(true);
    try {
      await apiPost(`/bots/${bot.id}/start`);
      snack.show?.('Start requested');
      const ok = await waitForStatus('running', 12000);
      if (ok) snack.show?.('Bot started');
      await fetchOne();
      DeviceEventEmitter.emit('bots:refresh');
    } catch (e: any) { snack.show?.(e?.message || 'Start failed'); }
    finally { setInFlight(false); }
  };

  const stop = async () => {
    if (!bot) return;
    if (bot.status !== 'running') { snack.show?.('Already stopped'); return; }
    setInFlight(true);
    try {
      // cancel worker immediately
      runningRef.current = false;
      cleanupRef.current?.();
      await apiPost(`/bots/${bot.id}/stop`);
      snack.show?.('Stop requested; waiting…');
      const ok = await waitForStatus('stopped', 12000);
      if (ok) snack.show?.('Bot stopped');
      await fetchOne();
      DeviceEventEmitter.emit('bots:refresh');
    } catch (e: any) { snack.show?.(e?.message || 'Stop failed'); }
    finally { setInFlight(false); }
  };

  const restart = async () => {
    if (!bot) return;
    setInFlight(true);
    try {
      runningRef.current = false;
      cleanupRef.current?.();
      await apiPost(`/bots/${bot.id}/restart`);
      snack.show?.('Restart requested');
      const ok = await waitForStatus('running', 15000);
      if (ok) snack.show?.('Bot restarted');
      await fetchOne();
      DeviceEventEmitter.emit('bots:refresh');
    } catch (e: any) { snack.show?.(e?.message || 'Restart failed'); }
    finally { setInFlight(false); }
  };

  const clear = () => { setLines([]); cursorRef.current = 0; setPendingCount(0); };

  const toggleFreeze = () => { setFrozen(f => !f); };

  const jumpToLatest = () => {
    setFrozen(false); setPendingCount(0); reliableScrollToEnd();
  };

  const waitForStatus = async (target: BotStatus, timeoutMs: number) => {
    const startAt = Date.now();
    while (Date.now() - startAt < timeoutMs) {
      try { const d = await apiGet(`/bots/${botId}`); if (d?.status === target) return true; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  };

  const statusText = useMemo(() => {
    if (frozen) return 'Frozen';
    if (bot?.status !== 'running' || transport === 'idle') return 'Paused';
    return atBottom ? 'Live' : 'Paused';
  }, [frozen, atBottom, bot?.status, transport]);

  const [scrollThumbTop, setScrollThumbTop] = useState(0);
  const [scrollThumbHeight, setScrollThumbHeight] = useState(0);
  const onScrollForThumb = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const viewH = layoutMeasurement.height;
    const contentH = Math.max(1, contentSize.height);
    const ratio = viewH / contentH;
    const thumbH = Math.max(30, viewH * ratio);
    const maxOffset = Math.max(1, contentH - viewH);
    const progress = Math.min(1, Math.max(0, contentOffset.y / maxOffset));
    const trackH = viewH - thumbH;
    setScrollThumbHeight(thumbH);
    setScrollThumbTop(progress * (trackH < 0 ? 0 : trackH));
  };

  const locked = inFlight;
  const canStart = bot && bot.status !== 'running' && bot.status !== 'starting' && !locked;
  const canStop = bot && bot.status === 'running' && !locked;
  const canRestart = bot && bot.status === 'running' && !locked;

  const renderItem = ({ item }: ListRenderItemInfo<string>) => (<Text style={styles.logLine}>{item}</Text>);
  const keyExtractor = (_: string, index: number) => String(index);

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.card, { margin: 12 }]}>
        <View style={styles.rowSpace}>
          <View>
            <Text style={styles.title}>{botName}</Text>
            <Text style={styles.meta}>Status: {bot?.status ?? '...'}</Text>
          </View>
          <Text style={styles.transport}>
            {transport === 'websocket' ? 'Live logs (websocket)' :
             transport === 'polling' ? 'Live logs (polling)' : 'Logs'}
          </Text>
        </View>

        <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
          <TouchableOpacity disabled={!canStart} onPress={start} style={[styles.btn, canStart ? styles.btnPrimary : styles.btnDisabled]}>
            <Text style={styles.btnText}>Start</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!canStop} onPress={stop} style={[styles.btn, canStop ? styles.btnDanger : styles.btnDisabled]}>
            <Text style={styles.btnText}>Stop</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!canRestart} onPress={restart} style={[styles.btn, canRestart ? styles.btnWarn : styles.btnDisabled]}>
            <Text style={styles.btnText}>Restart</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clear} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleFreeze} style={[styles.btn, frozen ? styles.btnWarn : styles.btnGhost]}>
            <Text style={styles.btnText}>{frozen ? 'Unfreeze' : 'Freeze'}</Text>
          </TouchableOpacity>
          {inFlight && <ActivityIndicator style={{ marginLeft: 8 }} />}
        </View>

        <View style={styles.logsContainer}>
          <FlatList
            ref={(r) => (listRef.current = r)}
            data={lines}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            onScroll={(e) => { onScroll(e); onScrollForThumb(e); }}
            onContentSizeChange={onContentSizeChange}
            contentContainerStyle={{ padding: 10 }}
            showsVerticalScrollIndicator
            persistentScrollbar
            removeClippedSubviews
            initialNumToRender={60}
            maxToRenderPerBatch={120}
            windowSize={12}
            ListEmptyComponent={<Text style={styles.logLineFaint}>No logs yet…</Text>}
          />
          <View pointerEvents="none" style={styles.scrollbarTrack}>
            <View style={[styles.scrollbarThumb, { height: scrollThumbHeight || 30, top: scrollThumbTop }]} />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerStatus}>Status: {statusText}{pendingCount>0?` • ${pendingCount} new ${pendingCount===1?'line':'lines'}`:''}</Text>
          <TouchableOpacity onPress={jumpToLatest} style={[styles.btn, styles.btnGhost]}>
            <Text style={styles.btnText}>Jump to latest</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowSpace: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 2, color: '#666' },
  transport: { color: '#666', fontSize: 12 },
  btn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8, marginTop: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  btnText: { fontWeight: '600' },
  btnPrimary: { backgroundColor: '#E7F1FF' },
  btnDanger: { backgroundColor: '#FFEAEA' },
  btnWarn: { backgroundColor: '#FFF5E5' },
  btnGhost: { backgroundColor: '#F2F2F2' },
  btnDisabled: { backgroundColor: '#F7F7F7', opacity: 0.6 },

  logsContainer: {
    marginTop: 12, height: 320, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', borderRadius: 10,
    backgroundColor: '#1a1a1a', overflow: 'hidden',
  },
  logLine: { color: '#F0F0F0', fontFamily: 'Courier', fontSize: 13, marginBottom: 2 },
  logLineFaint: { color: '#B5B5B5', fontFamily: 'Courier', fontSize: 13 },

  footer: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerStatus: { color: '#555' },

  scrollbarTrack: { position: 'absolute', right: 2, top: 2, bottom: 2, width: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 3 },
  scrollbarThumb: { position: 'absolute', right: 0, width: 6, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3 },
});
