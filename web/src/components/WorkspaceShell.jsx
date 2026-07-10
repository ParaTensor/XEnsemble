import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { getAccessToken, getWorkspaceShellWsUrl } from '../lib/api';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';

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

export default function WorkspaceShell({ projectId }) {
  const { preset } = useTerminalTheme();
  const xtermTheme = preset?.xterm || FALLBACK_XTERM_THEME;

  const hostRef = useRef(null);
  const wsRef = useRef(null);
  const connectedRef = useRef(false);
  const themeRef = useRef(xtermTheme);

  useEffect(() => {
    themeRef.current = xtermTheme;
  }, [xtermTheme]);

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
      theme: themeRef.current,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    host.replaceChildren();
    terminal.open(host);

    let disposed = false;
    let serverEnded = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    const MAX_RECONNECTS = 5;

    const fitTerminal = () => {
      fitAddon.fit();
      const cols = terminal.cols || 0;
      const rows = terminal.rows || 0;
      if (cols > 0 && rows > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    // The workspace shell process lives inside the same sandbox VM as the agent.
    // Restarting the agent can tear down and rebuild that VM, killing the shell
    // (reported as exit code -1). Since the workspace dir is persistent, transparently
    // reopen a fresh shell instead of leaving a dead terminal.
    const scheduleReconnect = (reason) => {
      if (disposed) return;
      if (reconnectAttempts >= MAX_RECONNECTS) {
        terminal.write(`\r\n\x1b[31m[System] Workspace shell could not be restored${reason ? ` (${reason})` : ''}. Switch tabs to retry.\x1b[0m\r\n`);
        serverEnded = true;
        return;
      }
      reconnectAttempts += 1;
      const delay = Math.min(500 * reconnectAttempts, 3000);
      terminal.write('\r\n\x1b[33m[System] Reconnecting workspace shell…\x1b[0m\r\n');
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
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

    if (!projectId) {
      terminal.write('\r\n\x1b[33m[System] Select a workspace to open a shell.\x1b[0m\r\n');
      serverEnded = true;
    } else {
      var connect = () => {
        try {
          const ws = new WebSocket(getWorkspaceShellWsUrl(projectId, getAccessToken()));
          wsRef.current = ws;

          ws.onopen = () => {
            if (disposed) return;
            connectedRef.current = true;
            reconnectAttempts = 0;
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
              return;
            }
            if (msg.type === 'error') {
              // Backend lost the shell (e.g. VM rebuilt on agent restart) — reopen.
              connectedRef.current = false;
              try { ws.close(); } catch { /* ignore */ }
              scheduleReconnect(msg.data);
              return;
            }
            if (msg.type === 'exit') {
              const code = msg.data;
              connectedRef.current = false;
              try { ws.close(); } catch { /* ignore */ }
              if (code === 0) {
                // User exited the shell normally.
                if (msg.message) terminal.write(msg.message);
                serverEnded = true;
              } else {
                // Abnormal exit (e.g. -1 when the VM was torn down) — reopen.
                scheduleReconnect(`code ${code}`);
              }
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
            if (disposed || serverEnded) return;
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

    requestAnimationFrame(() => {
      if (!disposed) fitTerminal();
    });

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      host.removeEventListener('mousedown', focusTerminal);
      host.removeEventListener('click', focusTerminal);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      connectedRef.current = false;
      terminal.dispose();
    };
  }, [projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div ref={hostRef} className="min-h-0 w-full flex-1" />
      </div>
    </div>
  );
}
