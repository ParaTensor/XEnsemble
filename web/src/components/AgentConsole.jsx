import { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, HardDrive, Loader2 } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { getAccessToken, getWsUrl } from '../lib/api';
import { cn } from '../lib/utils';

const TERMINAL_THEME = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46',
  selectionForeground: '#fafafa',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#f4f4f5',
};

function parseMessage(raw) {
  if (typeof raw === 'string') return JSON.parse(raw);
  return JSON.parse(raw.toString());
}

function getArrowSequence(key, applicationCursorKeys) {
  const prefix = applicationCursorKeys ? '\x1bO' : '\x1b[';
  switch (key) {
    case 'ArrowUp':
      return `${prefix}A`;
    case 'ArrowDown':
      return `${prefix}B`;
    case 'ArrowRight':
      return `${prefix}C`;
    case 'ArrowLeft':
      return `${prefix}D`;
    default:
      return null;
  }
}

function formatMemory(bytes) {
  if (!Number.isFinite(bytes)) return '0.0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AgentConsole({
  sessionId,
  agentName,
  onSessionEnd,
  sessionLive = true,
}) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const onSessionEndRef = useRef(onSessionEnd);
  const connectedRef = useRef(false);
  const [metrics, setMetrics] = useState(null);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState(!sessionLive);

  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);

  useEffect(() => {
    setEnded(!sessionLive);
  }, [sessionLive]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: 10000,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      drawBoldTextInBrightColors: true,
      theme: TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    host.replaceChildren();
    terminal.open(host);
    terminalRef.current = terminal;

    let disposed = false;
    let serverEnded = false;

    const fitTerminal = () => {
      fitAddon.fit();
      const cols = terminal.cols || 0;
      const rows = terminal.rows || 0;
      if (cols > 0 && rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const sequence = getArrowSequence(event.key, terminal.modes.applicationCursorKeysMode);
      if (!sequence) return true;
      if (event.metaKey || event.ctrlKey || event.altKey) return true;
      if (serverEnded) return false;
      event.preventDefault();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data: sequence }));
      }
      return false;
    });

    terminal.onData((data) => {
      if (disposed || serverEnded) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    });

    const focusTerminal = () => {
      if (!serverEnded) terminal.focus();
    };
    host.addEventListener('mousedown', focusTerminal);
    host.addEventListener('click', focusTerminal);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!disposed) fitTerminal();
      });
    });
    resizeObserver.observe(host);

    if (!sessionId || !sessionLive) {
      terminal.write('\r\n\x1b[33m[System] Session is not running.\x1b[0m\r\n');
      setEnded(true);
    } else {
      (async () => {
        try {
          const ws = new WebSocket(getWsUrl(sessionId, getAccessToken()));
          wsRef.current = ws;

          ws.onopen = () => {
            if (disposed) return;
            connectedRef.current = true;
            setConnected(true);
            setEnded(false);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!disposed) fitTerminal();
              });
            });
          };

          ws.onmessage = (event) => {
            if (disposed) return;
            const msg = parseMessage(event.data);
            if (msg.type === 'output') {
              terminal.write(msg.data);
              return;
            }
            if (msg.type === 'metrics') {
              setMetrics(msg.data);
              return;
            }
            if (msg.type === 'error') {
              terminal.write(`\r\n\x1b[31m[System] ${msg.data}\x1b[0m\r\n`);
              serverEnded = true;
              setEnded(true);
              onSessionEndRef.current?.(sessionId);
              ws.close();
              return;
            }
            if (msg.type === 'exit') {
              if (msg.message) terminal.write(msg.message);
              serverEnded = true;
              setEnded(true);
              onSessionEndRef.current?.(sessionId);
              ws.close();
            }
          };

          ws.onerror = () => {
            if (disposed || serverEnded) return;
            terminal.write('\r\n\x1b[31m[System] Terminal connection failed.\x1b[0m\r\n');
          };

          ws.onclose = (event) => {
            if (disposed || serverEnded) return;
            const wasConnected = connectedRef.current;
            connectedRef.current = false;
            if (!wasConnected) {
              terminal.write('\r\n\x1b[31m[System] Terminal connection failed.\x1b[0m\r\n');
            } else if (!event.wasClean) {
              terminal.write('\r\n\x1b[33m[System] Disconnected from terminal.\x1b[0m\r\n');
            }
            setEnded(true);
          };
        } catch (error) {
          if (!disposed) {
            terminal.write(`\r\n\x1b[31m[System] ${error?.message || 'Failed to connect'}\x1b[0m\r\n`);
          }
        }
      })();
    }

    const applySize = () => {
      if (disposed) return;
      fitTerminal();
    };
    requestAnimationFrame(applySize);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      host.removeEventListener('mousedown', focusTerminal);
      host.removeEventListener('click', focusTerminal);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      connectedRef.current = false;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, sessionLive]);

  const statusLabel = useMemo(() => {
    if (!sessionLive) return 'Ended';
    if (ended) return connected ? 'Disconnected' : 'Ended';
    return connected ? 'Live' : 'Connecting';
  }, [connected, ended, sessionLive]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-[#09090b] shadow-sm">
      <div className="flex h-10 items-center justify-between border-b border-white/10 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              sessionLive && connected && !ended
                ? 'bg-emerald-500 animate-pulse'
                : sessionLive && !connected && !ended
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-zinc-500',
            )}
            aria-hidden
          />
          <span className="truncate text-xs font-medium text-zinc-100">{agentName}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">{statusLabel}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          {metrics ? (
            <>
              <span className="flex items-center gap-1.5" title="CPU usage">
                <Cpu className="h-3.5 w-3.5" />
                <span>{Number.isFinite(metrics.cpu) ? `${metrics.cpu.toFixed(1)}%` : '0.0%'}</span>
              </span>
              <span className="flex items-center gap-1.5" title="Memory RSS">
                <HardDrive className="h-3.5 w-3.5" />
                <span>{formatMemory(metrics.memory)}</span>
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting
            </span>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div ref={hostRef} className="min-h-0 w-full flex-1" />
      </div>
    </div>
  );
}
