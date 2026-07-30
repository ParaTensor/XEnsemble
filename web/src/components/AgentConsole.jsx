import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { getAccessToken, getWsUrl, apiFetch } from '../lib/api';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { usePreview, PreviewControlGroup } from './PreviewPanel';
import { Loader2 } from 'lucide-react';

const FALLBACK_XTERM_THEME = {
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

function getCachedSeq(sessionId) {
  try {
    const v = sessionStorage.getItem(`xe_term_seq_${sessionId}`);
    return v ? Number(v) || 0 : 0;
  } catch { return 0; }
}

function setCachedSeq(sessionId, seq) {
  try {
    if (seq != null && seq > 0) sessionStorage.setItem(`xe_term_seq_${sessionId}`, String(seq));
  } catch { /* ignore */ }
}

function AgentConsole({
  sessionId,
  reconnectVersion = 0,
  projectId,
  /* agentName kept for API compat */
  onSessionEnd,
  onSessionConnected,
  sessionLive = true,
  sessionWakeable = false,
}) {
  const { preset } = useTerminalTheme();
  const xtermTheme = preset?.xterm || FALLBACK_XTERM_THEME;

  const preview = usePreview(projectId, true);

  const hostRef = useRef(null);
  const overlayRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const onSessionEndRef = useRef(onSessionEnd);
  const onSessionConnectedRef = useRef(onSessionConnected);
  const connectedRef = useRef(false);
  const firstConnectRef = useRef(true);
  const shouldConnect = sessionLive;
  const shouldReplayIdle = sessionWakeable && !sessionLive;
  // eslint-disable-next-line no-unused-vars
  const [connected, setConnected] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [ended, setEnded] = useState(!shouldConnect && !shouldReplayIdle);

  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);

  useEffect(() => {
    onSessionConnectedRef.current = onSessionConnected;
  }, [onSessionConnected]);

  useEffect(() => {
    setEnded(!shouldConnect && !shouldReplayIdle);
  }, [shouldConnect, shouldReplayIdle]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      allowProposedApi: true,
      cols: 120,
      rows: 32,
      scrollback: 10000,
      convertEol: true,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      drawBoldTextInBrightColors: true,
      theme: xtermTheme,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    host.replaceChildren();
    terminal.open(host);
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); });
      terminal.loadAddon(webglAddon);
    } catch (_) {
      // WebGL not available, fall back to default DOM renderer
    }
    terminalRef.current = terminal;

    let overlayTimer = null;
    const showOverlay = () => {
      if (hostRef.current) hostRef.current.style.opacity = '0';
      if (overlayRef.current) overlayRef.current.style.display = 'flex';
      overlayTimer = setTimeout(() => { hideOverlay(); }, 5000);
    };
    const hideOverlay = () => {
      if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
      requestAnimationFrame(() => {
        if (disposed) return;
        if (hostRef.current) hostRef.current.style.opacity = '1';
        if (overlayRef.current) overlayRef.current.style.display = 'none';
        terminal.scrollToBottom();
      });
    };

    let disposed = false;
    let serverEnded = false;
    let reconnectTimer = null;
    let lastSentCols = 0;
    let lastSentRows = 0;
    let writeRafId = null;
    const resizeTimers = [];

    const sendResize = (cols, rows) => {
      if (cols > 0 && rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    const fitTerminal = (force = false) => {
      fitAddon.fit();
      const cols = terminal.cols || 0;
      const rows = terminal.rows || 0;
      if (cols <= 0 || rows <= 0) return;
      const changed = cols !== lastSentCols || rows !== lastSentRows;
      if (!changed && !force) return;
      lastSentCols = cols;
      lastSentRows = rows;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      sendResize(cols, rows);
    };

    // After the terminal (re)connects, opencode's TUI boots inside the sandbox
    // slightly later than the WS open event; resend the size a few times so it
    // initializes at the correct dimensions instead of the backend default.
    const scheduleResizeResends = () => {
      [150, 500, 1200].forEach((delay) => {
        const t = setTimeout(() => {
          if (!disposed) fitTerminal(true);
        }, delay);
        resizeTimers.push(t);
      });
    };

    const copyToClipboard = (text) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(textarea);
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      const isCopyShortcut = (event.ctrlKey && event.shiftKey && (event.key === 'C' || event.key === 'c'))
        || (event.metaKey && !event.ctrlKey && (event.key === 'c' || event.key === 'C'));
      if (isCopyShortcut) {
        const selection = terminal.getSelection();
        if (selection) {
          event.preventDefault();
          copyToClipboard(selection);
          terminal.clearSelection();
          return false;
        }
      }

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

    const handleContextMenu = (e) => {
      e.preventDefault();
      const selection = terminal.getSelection();
      if (selection) {
        copyToClipboard(selection);
        terminal.clearSelection();
      }
    };

    const focusTerminal = () => {
      if (!serverEnded) terminal.focus();
    };
    host.addEventListener('mousedown', focusTerminal);
    host.addEventListener('click', focusTerminal);
    host.addEventListener('contextmenu', handleContextMenu);

    let lastHostWidth = 0;
    let lastHostHeight = 0;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        const rect = host.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (Math.abs(w - lastHostWidth) <= 1 && Math.abs(h - lastHostHeight) <= 1) return;
        lastHostWidth = w;
        lastHostHeight = h;
        fitTerminal();
      });
    });
    resizeObserver.observe(host);

    if (!sessionId || (!shouldConnect && !shouldReplayIdle)) {
      terminal.write('\r\n\x1b[33m[System] Session is not running.\x1b[0m\r\n');
      setEnded(true);
    } else if (shouldReplayIdle) {
      (async () => {
        showOverlay();
        try {
          const response = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/transcript`);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Failed to load session history');
          if (data.output) terminal.write(data.output);
          if (data.head != null && data.head > 0) setCachedSeq(sessionId, data.head);
          terminal.write('\r\n\x1b[33m[System] Session paused. Click Start to resume.\x1b[0m\r\n');
          hideOverlay();
          setEnded(true);
        } catch (error) {
          if (!disposed) {
            terminal.write(`\r\n\x1b[31m[System] ${error?.message || 'Failed to load session history'}\x1b[0m\r\n`);
            hideOverlay();
            setEnded(true);
          }
        }
      })();
    } else {
      let reconnectAttempts = 0;
      const MAX_RECONNECTS = 5;

      const scheduleReconnect = (reason) => {
        if (disposed || serverEnded) return;
        if (reconnectAttempts >= MAX_RECONNECTS) {
          terminal.write(`\r\n\x1b[31m[System] Terminal could not be restored${reason ? ` (${reason})` : ''}. Click Restart to retry.\x1b[0m\r\n`);
          setEnded(true);
          return;
        }
        reconnectAttempts += 1;
        const delay = Math.min(500 * reconnectAttempts, 3000);
        terminal.write(`\r\n\x1b[33m[System] Reconnecting terminal… (${reconnectAttempts}/${MAX_RECONNECTS})\x1b[0m\r\n`);
        setConnected(false);
        reconnectTimer = setTimeout(() => {
          if (!disposed) connect();
        }, delay);
      };

      var connect = () => {
        try {
          if (reconnectAttempts === 0) showOverlay();
          // On first connect (session switch/initial load), use after=0 to get
          // the tail replay. On reconnect (WS drop), use cached seq for delta.
          const isFirstConnect = firstConnectRef.current;
          firstConnectRef.current = false;
          const cachedSeq = isFirstConnect ? 0 : getCachedSeq(sessionId);
          const ws = new WebSocket(getWsUrl(sessionId, getAccessToken(), cachedSeq));
          wsRef.current = ws;
          let replayDone = false;
          let writeBuffer = '';
          let pendingSeq = null;

          // Fallback: hide overlay after 5s even if no output was received
          // (e.g. empty replay with after=cachedSeq and no new frames)
          const overlayFallbackTimer = setTimeout(() => {
            if (!replayDone && !disposed) {
              replayDone = true;
              hideOverlay();
            }
          }, 5000);

          const flushWriteBuffer = () => {
            writeRafId = null;
            if (disposed) return;
            if (pendingSeq != null) {
              setCachedSeq(sessionId, pendingSeq);
              pendingSeq = null;
            }
            if (!writeBuffer) return;
            const data = writeBuffer;
            writeBuffer = '';
            const viewport = hostRef.current?.querySelector('.xterm-viewport');
            const atBottom = !viewport || viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 5;
            terminal.write(data, () => {
              if (!replayDone && !disposed) { replayDone = true; hideOverlay(); }
              if (atBottom && !disposed) terminal.scrollToBottom();
            });
          };

          ws.onopen = () => {
            if (disposed) return;
            connectedRef.current = true;
            reconnectAttempts = 0;
            setConnected(true);
            setEnded(false);
            onSessionConnectedRef.current?.(sessionId);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!disposed) fitTerminal(true);
              });
            });
            scheduleResizeResends();
          };

          ws.onmessage = (event) => {
            if (disposed) return;
            const msg = parseMessage(event.data);
            if (msg.type === 'output') {
              if (msg.seq != null) pendingSeq = msg.seq;
              writeBuffer += msg.data;
              if (writeRafId === null) {
                writeRafId = requestAnimationFrame(flushWriteBuffer);
              }
              return;
            }
            if (msg.type === 'error') {
              if (writeRafId !== null) { cancelAnimationFrame(writeRafId); flushWriteBuffer(); }
              hideOverlay();
              connectedRef.current = false;
              try { ws.close(); } catch { /* ignore */ }
              scheduleReconnect(msg.data || 'error');
              return;
            }
            if (msg.type === 'exit') {
              if (writeRafId !== null) { cancelAnimationFrame(writeRafId); flushWriteBuffer(); }
              hideOverlay();
              if (msg.message) terminal.write(msg.message);
              serverEnded = true;
              setEnded(true);
              onSessionEndRef.current?.(sessionId);
              ws.close();
            }
          };

          ws.onerror = () => {
            if (disposed || serverEnded) return;
            connectedRef.current = false;
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close();
            }
          };

          ws.onclose = (event) => {
            clearTimeout(overlayFallbackTimer);
            if (disposed || serverEnded) return;
            hideOverlay();
            const wasConnected = connectedRef.current;
            connectedRef.current = false;
            if (event.wasClean) return;
            scheduleReconnect(wasConnected ? 'disconnected' : 'connection failed');
          };
        } catch (error) {
          if (!disposed) {
            scheduleReconnect(error?.message || 'connect error');
          }
        }
      };
      connect();
    }

    const applySize = () => {
      if (disposed) return;
      fitTerminal();
    };
    requestAnimationFrame(applySize);

    return () => {
      disposed = true;
      if (writeRafId !== null) cancelAnimationFrame(writeRafId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeTimers.forEach((t) => clearTimeout(t));
      resizeObserver.disconnect();
      host.removeEventListener('mousedown', focusTerminal);
      host.removeEventListener('click', focusTerminal);
      host.removeEventListener('contextmenu', handleContextMenu);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      connectedRef.current = false;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reconnectVersion]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      {projectId && <PreviewControlGroup {...preview} />}
      <div
        ref={overlayRef}
        className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/90 backdrop-blur-sm"
        style={{ display: 'none' }}
      >
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading history…
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div ref={hostRef} className="min-h-0 w-full flex-1" />
      </div>
    </div>
  );
}

export default React.memo(AgentConsole);
