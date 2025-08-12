import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  LayoutChangeEvent,
} from 'react-native';

// Project helpers expected to exist
import { apiGet, apiPost, openLogsSocket } from './api';
import { useSnack } from './components/Snack';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = {
  id: string;
  name: string;
  status: BotStatus;
  mode?: string;
  strategy?: string;
  strategyFile?: string;
  symbols?: string[];
  pairs?: string[];
};

type Props = {
  botId: string;
  botName: string;
};

const BOTTOM_TOLERANCE = 30; // px
const MAX_LINES = 2000;

export default function BotDetail({ botId, botName }: Props) {
  const snack = useSnack();
  const [bot, setBot] = useState<Bot | null>(null);
  const [inFlight, setInFlight] = useState(false);

  // --- Logs state ---
  const [lines, setLines] = useState<string[]>([]);
  const [transport, setTransport] = useState<'websocket' | 'polling' | 'idle'>('idle');
  const [frozen, setFrozen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);

  // scrollbar metrics
  const [containerH, setContainerH] = useState(320);
  const scrollHRef = useRef(1);
  const layoutHRef = useRef(1);
  const scrollYRef = useRef(0);

  const listRef = useRef<FlatList<string> | null>(null);
  const cursorRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);
  const frozenRef = useRef<boolean>(false);
  const atBottomRef = useRef<boolean>(true);
  const liveRef = useRef<boolean>(true);

  useEffect(() => { frozenRef.current = frozen; }, [frozen]);
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);

  const statusLabel = useMemo(() => {
    if (frozen) return 'Frozen';
    const live = !frozen && atBottom && bot?.status === 'running' && transport !== 'idle';
    liveRef.current = live;
    return live ? 'Live' : 'Paused';
  }, [frozen, atBottom, bot?.status, transport]);

  const fetchOne = useCallback(async () => {
    try {
      const data = await apiGet(`/bots/${botId}`);
      setBot(data);
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to load bot');
    }
  }, [botId, snack]);

  useEffect(() => { fetchOne(); }, [fetchOne]);

  // Append lines & manage scroll
  const appendLines = useCallback((incoming: string[]) => {
    if (!incoming || incoming.length === 0) return;
    setLines(prev => {
      const next = [...prev, ...incoming.map(String)];
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
      return next;
    });
    if (frozenRef.current || !atBottomRef.current || draggingRef.current) {
      setPendingCount(c => c + incoming.length);
    } else {
      // stay live
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, []);

  // Logs worker: only active when bot is running
  useEffect(() => {
    if (bot?.status !== 'running') {
      setTransport('idle');
      return;
    }

    let ws: any | null = null;
    let poll: any | null = null;
    let closedByUs = false;

    const startPolling = () => {
      setTransport('polling');
      const tick = async () => {
        try {
          const res = await apiGet(`/bots/${botId}/logs?cursor=${cursorRef.current}`);
          if (res && Array.isArray(res.lines)) appendLines(res.lines);
          if (res && typeof res.cursor === 'number') cursorRef.current = res.cursor;
        } catch {}
      };
      tick();
      poll = setInterval(tick, 1000);
    };

    if (typeof openLogsSocket === 'function') {
      try {
        ws = openLogsSocket(botId);
        if (ws) {
          setTransport('websocket');
          const onMessage = (evt: any) => {
            const payload = typeof evt?.data === 'string' ? evt.data : (typeof evt === 'string' ? evt : '');
            if (payload) appendLines([payload]);
          };
          ws.addEventListener?.('message', onMessage);
          // RN compat
          if (!ws.onmessage) ws.onmessage = onMessage;
          const onClose = () => { if (!closedByUs) startPolling(); };
          ws.addEventListener?.('close', onClose);
          if (!ws.onclose) ws.onclose = onClose;
        } else {
          startPolling();
        }
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      closedByUs = true;
      try { ws?.close?.(); } catch {}
      if (poll) clearInterval(poll);
    };
  }, [appendLines, bot?.status, botId]);

  // ---- Actions ----
  const waitForStatus = async (desired: BotStatus, timeoutMs = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const data = await apiGet(`/bots/${botId}`);
        setBot(data);
        if (data?.status === desired) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  };

  const start = async () => {
    if (!bot) return;
    if (bot.status === 'running' || bot.status === 'starting') {
      snack.show?.('Already running'); return;
    }
    setInFlight(true);
    try {
      await apiPost(`/bots/${bot.id}/start`);
      snack.show?.('Start requested');
      await waitForStatus('running', 12000);
      setFrozen(false);
      setPendingCount(0);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    } catch (e: any) {
      snack.show?.(e?.message || 'Start failed');
    } finally { setInFlight(false); }
  };

  const stop = async () => {
    if (!bot) return;
    if (bot.status !== 'running') { snack.show?.('Already stopped'); return; }
    setInFlight(true);
    try {
      await apiPost(`/bots/${bot.id}/stop`);
      snack.show?.('Stop requested, waiting…');
      await waitForStatus('stopped', 12000);
    } catch (e: any) {
      snack.show?.(e?.message || 'Stop failed');
    } finally { setInFlight(false); }
  };

  const restart = async () => {
    if (!bot) return;
    setInFlight(true);
    try {
      await apiPost(`/bots/${bot.id}/restart`);
      snack.show?.('Restart requested');
      await waitForStatus('running', 15000);
      setFrozen(false);
      setPendingCount(0);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    } catch (e: any) {
      snack.show?.(e?.message || 'Restart failed');
    } finally { setInFlight(false); }
  };

  const clear = () => {
    setLines([]);
    cursorRef.current = 0;
    setPendingCount(0);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollYRef.current = contentOffset.y;
    scrollHRef.current = contentSize.height;
    layoutHRef.current = layoutMeasurement.height;

    const isAtBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_TOLERANCE
      || contentSize.height <= layoutMeasurement.height + BOTTOM_TOLERANCE;

    // while frozen we always treat as not-at-bottom
    if (frozenRef.current) {
      setAtBottom(false);
      return;
    }
    setAtBottom(isAtBottom && !draggingRef.current);
  };

  const onScrollBeginDrag = () => { draggingRef.current = true; };
  const onScrollEndDrag = () => {
    draggingRef.current = false;
    // recompute at-bottom based on last known metrics
    const isAtBottom = scrollYRef.current + layoutHRef.current >= scrollHRef.current - BOTTOM_TOLERANCE
      || scrollHRef.current <= layoutHRef.current + BOTTOM_TOLERANCE;
    if (!frozenRef.current) setAtBottom(isAtBottom);
  };
  const onMomentumEnd = onScrollEndDrag;

  const onLogsLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setContainerH(h);
  };

  const jumpToLatest = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
      setPendingCount(0);
      setFrozen(false);
      setAtBottom(true);
    });
  };

  const toggleFreeze = () => {
    setFrozen(f => {
      const next = !f;
      if (!next) {
        // unfreezing → snap to bottom
        jumpToLatest();
      } else {
        setAtBottom(false);
      }
      return next;
    });
  };

  // custom scrollbar thumb
  const thumbStyle = useMemo(() => {
    const contentH = scrollHRef.current;
    const viewH = layoutHRef.current;
    if (contentH <= 0 || viewH <= 0) return { height: 0, top: 0, opacity: 0 };
    const ratio = Math.min(1, viewH / contentH);
    const thumbH = Math.max(24, ratio * containerH);
    const maxTop = containerH - thumbH;
    const scrollable = Math.max(1, contentH - viewH);
    const top = Math.min(maxTop, (scrollYRef.current / scrollable) * maxTop);
    return { height: thumbH, top, opacity: 1 };
  }, [lines.length, containerH, frozen, atBottom]);

  const renderItem = ({ item }: ListRenderItemInfo<string>) => (
    <Text style={styles.logLine}>{item}</Text>
  );
  const keyExtractor = (_: string, i: number) => String(i);

  const locked = inFlight;
  const canStart = bot && bot.status !== 'running' && bot.status !== 'starting' && !locked;
  const canStop = bot && bot.status === 'running' && !locked;
  const canRestart = bot && bot.status === 'running' && !locked;

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

        <View style={styles.logsContainer} onLayout={onLogsLayout}>
          <FlatList
            ref={(r) => (listRef.current = r)}
            data={lines}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            onScroll={onScroll}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEndDrag}
            onMomentumScrollEnd={onMomentumEnd}
            contentContainerStyle={{ padding: 10 }}
            showsVerticalScrollIndicator={false} // we draw our own
            removeClippedSubviews
            initialNumToRender={60}
            maxToRenderPerBatch={100}
            windowSize={12}
            ListEmptyComponent={<Text style={styles.logLineFaint}>No logs yet…</Text>}
          />
          {/* custom scrollbar track & thumb */}
          <View pointerEvents="none" style={styles.scrollbarTrack}>
            <View style={[styles.scrollbarThumb, { height: thumbStyle.height, top: thumbStyle.top, opacity: thumbStyle.opacity }]} />
          </View>
        </View>

        {/* Footer status & action */}
        <View style={styles.footerBar}>
          <Text style={[styles.footerStatus, statusLabel === 'Live' ? styles.statusLive : (statusLabel === 'Frozen' ? styles.statusFrozen : styles.statusPaused)]}>
            {statusLabel}
          </Text>
          {(!liveRef.current && pendingCount > 0) ? (
            <TouchableOpacity onPress={jumpToLatest} style={styles.jumpBtn}>
              <Text style={styles.jumpText}>{pendingCount} new line{pendingCount === 1 ? '' : 's'} • Jump to latest</Text>
            </TouchableOpacity>
          ) : null}
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
  title: { fontSize: 16, fontWeight: '600' },
  meta: { marginTop: 2, color: '#666' },
  transport: { color: '#666', fontSize: 12 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 8,
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  btnText: { fontWeight: '600' },
  btnPrimary: { backgroundColor: '#E7F1FF' },
  btnDanger: { backgroundColor: '#FFEAEA' },
  btnWarn: { backgroundColor: '#FFF5E5' },
  btnGhost: { backgroundColor: '#F2F2F2' },
  btnDisabled: { backgroundColor: '#F7F7F7', opacity: 0.6 },
  logsContainer: {
    marginTop: 12,
    height: 320,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
  },
  logLine: {
    color: '#F0F0F0',
    fontFamily: 'Courier',
    fontSize: 13,
    marginBottom: 2,
  },
  logLineFaint: {
    color: '#B5B5B5',
    fontFamily: 'Courier',
    fontSize: 13,
  },
  // custom scrollbar
  scrollbarTrack: {
    position: 'absolute',
    right: 2,
    top: 2,
    bottom: 2,
    width: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scrollbarThumb: {
    position: 'absolute',
    right: 0,
    width: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  footerBar: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  footerStatus: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontWeight: '600',
    overflow: 'hidden',
  },
  statusLive: { backgroundColor: '#E7FEE7', borderColor: '#BAE8BA', color: '#126B12' },
  statusPaused: { backgroundColor: '#F2F2F2', borderColor: '#E0E0E0', color: '#333' },
  statusFrozen: { backgroundColor: '#FFF5E5', borderColor: '#FFE2B8', color: '#7A4A00' },
  jumpBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#333',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#555',
  },
  jumpText: { color: '#fff', fontWeight: '600', fontSize: 12 },
});
