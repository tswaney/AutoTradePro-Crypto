import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { apiGet, apiPost, openLogsSocket } from './api';
import { useSnack } from './components/Snack';

type BotStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
type Bot = { id: string; name?: string; status: BotStatus };

type Props = { botId: string; botName: string };

export default function BotDetail({ botId, botName }: Props) {
  const snack = useSnack();
  const [bot, setBot] = useState<Bot | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const fetchOne = async () => {
    try {
      const data = await apiGet(`/bots/${botId}` as any, undefined);
      setBot(data);
    } catch (e: any) {
      snack.show?.(e?.message || 'Failed to load bot');
    }
  };

  useEffect(() => {
    fetchOne();
  }, [botId]);

  // --- Logs: prefer WebSocket, else poll ---
  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    try {
      // @ts-ignore allow different signatures
      ws = openLogsSocket?.(botId);
      if (ws) {
        ws.onmessage = (evt: any) => {
          const text = typeof evt?.data === 'string' ? evt.data : JSON.stringify(evt?.data);
          if (stopped) return;
          setLines((prev) => {
            const next = [...prev, text];
            if (next.length > 500) next.splice(0, next.length - 500);
            return next;
          });
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
        };
        ws.onerror = () => {};
      }
    } catch {}

    if (!ws) {
      // Poll every 1s: expect { lines: string[], cursor: string }
      const timer = setInterval(async () => {
        try {
          const res: any = await apiGet(`/bots/${botId}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` as any, undefined);
          if (stopped) return;
          if (res?.lines?.length) {
            setLines((prev) => {
              const next = [...prev, ...res.lines];
              if (next.length > 500) next.splice(0, next.length - 500);
              return next;
            });
            setCursor(res?.cursor || null);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 0);
          }
        } catch {}
      }, 1000);
      return () => { stopped = true; clearInterval(timer); };
    }

    return () => { stopped = true; try { ws?.close?.(); } catch {} };
  }, [botId, cursor]);

  const start = async () => {
    if (!bot) return;
    if (bot.status === 'running' || bot.status === 'starting') {
      snack.show?.('Already running'); return;
    }
    setInFlight(true);
    try { await apiPost(`/bots/${bot.id}/start` as any, undefined); snack.show?.('Bot started'); await fetchOne(); }
    catch (e: any) { snack.show?.(e?.message || 'Start failed'); }
    finally { setInFlight(false); }
  };

  const stop = async () => {
    if (!bot) return;
    if (bot.status !== 'running') { snack.show?.('Already stopped'); return; }
    setInFlight(true);
    try { await apiPost(`/bots/${bot.id}/stop` as any, undefined); snack.show?.('Bot stopped'); await fetchOne(); }
    catch (e: any) { snack.show?.(e?.message || 'Stop failed'); }
    finally { setInFlight(false); }
  };

  const restart = async () => {
    if (!bot) return;
    setInFlight(true);
    try { await apiPost(`/bots/${bot.id}/restart` as any, undefined); snack.show?.('Bot restarted'); await fetchOne(); }
    catch (e: any) { snack.show?.(e?.message || 'Restart failed'); }
    finally { setInFlight(false); }
  };

  const clear = () => setLines([]);

  const canStart = bot && bot.status !== 'running' && bot.status !== 'starting' && !inFlight;
  const canStop = bot && bot.status === 'running' && !inFlight;
  const canRestart = bot && bot.status === 'running' && !inFlight;

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.card, { margin: 12 }]}>
        <Text style={styles.title}>{botName}</Text>
        <Text style={styles.meta}>Status: {bot?.status ?? '...'}</Text>

        <View style={[styles.row, { marginTop: 8 }]}>
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
          {inFlight ? <ActivityIndicator style={{ marginLeft: 8 }} /> : null}
        </View>

        {/* Logs */}
        <View style={styles.logsContainer}>
          <ScrollView ref={(r) => (scrollRef.current = r)} style={styles.scroll} contentContainerStyle={{ padding: 10 }}>
            {lines.length === 0 ? (
              <Text style={{ color: '#777' }}>No logs yet…</Text>
            ) : (
              lines.map((ln, i) => (
                <Text key={i} style={styles.logLine}>{ln}</Text>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  card: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
    borderRadius: 12, padding: 12, backgroundColor: '#fafafa',
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { marginTop: 2, color: '#666' },
  btn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, marginRight: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  btnText: { fontWeight: '600' },
  btnPrimary: { backgroundColor: '#E7F1FF' },
  btnDanger: { backgroundColor: '#FFEAEA' },
  btnWarn: { backgroundColor: '#FFF5E5' },
  btnGhost: { backgroundColor: '#F2F2F2' },
  btnDisabled: { backgroundColor: '#F7F7F7', opacity: 0.6 },
  logsContainer: {
    marginTop: 12, height: 260, borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd', borderRadius: 10, backgroundColor: '#111',
  },
  scroll: { flex: 1 },
  logLine: { color: '#EAEAEA', fontFamily: 'Courier', fontSize: 12, marginBottom: 2 },
});
