import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { getAccessToken, getWsUrl, apiFetch } from '../lib/api';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
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

export default function AgentConsole({
  sessionId,
  /* agentName kept for API compat */
  onSessionEnd,
  onSessionConnected,
  sessionLive = true,
  sessionWakeable = false,
}) {
  const { preset } = useTerminalTheme();
  const xtermTheme = preset?.xterm || FALLBACK_XTERM_THEME;

  const hostRef = useRef(null);
  const overlayRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const onSessionEndRef = useRef(onSessionEnd);
  const onSessionConnectedRef = useRef(onSessionConnected);
  const connectedRef = useRef(false);
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
      cols: 120,
      rows: 32,
      scrollback: 5000,
      convertEol: true,
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
    host.replaceChildren();
    terminal.open(host);
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); });
      terminal.loadAddon(webglAddon);
    } catch (_) {
      console.warn('WebGL renderer unavailable, falling back to canvas');
    }
    terminalRef.current = terminal;

    const showOverlay = () => {
      if (hostRef.current) hostRef.current.style.setProperty('opacity', '0', 'important');
      if (overlayRef.current) overlayRef.current.style.display = 'flex';
    };
    const hideOverlay = () => {
      requestAnimationFrame(() => {
        if (disposed) return;
        if (hostRef.current) hostRef.current.style.opacity = '1';
        if (overlayRef.current) overlayRef.current.style.display = 'none';
        terminal.scrollToBottom();
      });
    };

    let disposed = false;
    let serverEnded = false;
    let lastSentCols = 0;
    let lastSentRows = 0;
    let lastHostWidth = 0;
    let lastHostHeight = 0;
    const resizeTimers = [];

    const copyToClipboard = (text) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    };

    const fallbackCopy = (text) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(textarea);
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      const selection = terminal.getSelection();
      if (selection) {
        copyToClipboard(selection);
        terminal.clearSelection();
      }
    };

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
      if (force && !changed) {
        // Full-screen TUIs (opencode) only repaint on a size change. When the
        // fitted size matches the backend PTY default, nudge the dimensions so
        // the TUI clears stale rendering artifacts and redraws at full size.
        sendResize(cols > 1 ? cols - 1 : cols + 1, rows);
        setTimeout(() => { if (!disposed) sendResize(cols, rows); }, 50);
      } else {
        sendResize(cols, rows);
      }
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

    const focusTerminal = () => {
      if (!serverEnded) terminal.focus();
    };
    host.addEventListener('mousedown', focusTerminal);
    host.addEventListener('click', focusTerminal);
    host.addEventListener('contextmenu', handleContextMenu);

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        const rect = host.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (w === lastHostWidth && h === lastHostHeight) return;
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
          if (data.output) {
            terminal.write(data.output, () => {
              if (!disposed) hideOverlay();
            });
          } else {
            hideOverlay();
          }
          terminal.write('\r\n\x1b[33m[System] Session paused. Click Start to resume.\x1b[0m\r\n');
          setEnded(true);
        } catch (error) {
          if (!disposed) {
            terminal.write(`\r\n\x1b[31m[System] ${error?.message || 'Failed to load session history'}\x1b[0m\r\n`);
            setEnded(true);
          }
        }
      })();
    } else {
      (async () => {
        try {
          showOverlay();
          const ws = new WebSocket(getWsUrl(sessionId, getAccessToken()));
          wsRef.current = ws;

          ws.onopen = () => {
            if (disposed) return;
            connectedRef.current = true;
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

          let replayPending = 0;
          ws.onmessage = (event) => {
            if (disposed) return;
            const msg = parseMessage(event.data);
            if (msg.type === 'output') {
              replayPending++;
              terminal.write(msg.data, () => {
                replayPending--;
                if (replayPending <= 0 && !disposed) {
                  hideOverlay();
                }
              });
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
  }, [sessionId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div
        ref={overlayRef}
        className="absolute inset-0 z-10 items-center justify-center bg-zinc-950 backdrop-blur-sm"
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
