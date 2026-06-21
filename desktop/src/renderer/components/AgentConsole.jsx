import React, { useState, useEffect, useRef } from 'react';
import { Cpu, HardDrive, Loader2, Play, Square, Unplug, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { usePreview, PreviewControlGroup } from './PreviewPanel';
import TerminalThemePicker from './TerminalThemePicker';
import { getWsUrl, getAccessToken, getBackendURL } from '../lib/api';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { XTERM_MINIMUM_CONTRAST_RATIO } from '../lib/terminalThemes.js';
import { useToast } from './Toast';

function parseWsMessage(message) {
    const raw = typeof message === 'string' ? message : message.toString();
    return JSON.parse(raw);
}

function measureTerminalSize(terminal, container) {
    const cellWidth = terminal._core?._renderService?.dimensions?.css?.cell?.width;
    const cellHeight = terminal._core?._renderService?.dimensions?.css?.cell?.height;
    if (!cellWidth || !cellHeight) return null;
    const style = window.getComputedStyle(container);
    const width = Math.max(0, Number.parseInt(style.width, 10));
    const height = Number.parseInt(style.height, 10);
    if (!width || !height) return null;
    return {
        cols: Math.max(2, Math.floor(width / cellWidth)),
        rows: Math.max(1, Math.floor(height / cellHeight)),
    };
}

function isSinglePrintableChar(str) {
    if (typeof str !== 'string' || str.length !== 1) return false;
    const code = str.charCodeAt(0);
    return code >= 32 && code <= 126;
}

function getArrowSequence(key, applicationCursorKeys) {
    const prefix = applicationCursorKeys ? '\x1bO' : '\x1b[';
    switch (key) {
        case 'ArrowUp': return `${prefix}A`;
        case 'ArrowDown': return `${prefix}B`;
        case 'ArrowRight': return `${prefix}C`;
        case 'ArrowLeft': return `${prefix}D`;
        default: return null;
    }
}

function applyXtermSurfaceStyles(container, pane, theme) {
    const background = theme.background;
    const foreground = theme.foreground;
    if (pane) {
        pane.style.backgroundColor = background;
        pane.style.setProperty('--xterm-bg', background);
        pane.style.setProperty('--xterm-fg', foreground);
    }
    if (container) {
        container.style.setProperty('--xterm-bg', background);
        container.style.setProperty('--xterm-fg', foreground);
    }
}

export default function AgentConsole({
    sessionId,
    agentName,
    projectId,
    token,
    onSessionEnd,
    onStart,
    onStop,
    sessionControlPending = false,
    sessionLive = true,
    onDisconnect,
    workspaceOpen,
    onToggleWorkspace,
}) {
    const [metrics, setMetrics] = useState({ cpu: 0, memory: 0 });
    const [ended, setEnded] = useState(!sessionLive);
    const { preset, themeRevision } = useTerminalTheme();
    const preview = usePreview(projectId, token);
    const { showToast } = useToast();
    const containerRef = useRef(null);
    const terminalPaneRef = useRef(null);
    const terminalRef = useRef(null);
    const applySizeRef = useRef(null);
    const presetRef = useRef(preset);
    presetRef.current = preset;
    const onSessionEndRef = useRef(onSessionEnd);
    const sessionLiveRef = useRef(sessionLive);
    onSessionEndRef.current = onSessionEnd;
    sessionLiveRef.current = sessionLive;

    useEffect(() => {
        if (!sessionLive) setEnded(true);
    }, [sessionLive]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        setEnded(!sessionLiveRef.current);
        const disposedRef = { current: false };
        const serverEndedRef = { current: false };
        const openedRef = { current: false };
        const wsRef = { current: null };
        const pendingEchoes = [];

        const terminal = new Terminal({
            cols: 120,
            rows: 32,
            scrollback: 10000,
            convertEol: true,
            scrollOnUserInput: true,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'bar',
            cursorWidth: 2,
            drawBoldTextInBrightColors: true,
            minimumContrastRatio: XTERM_MINIMUM_CONTRAST_RATIO,
            theme: presetRef.current.xterm,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        container.replaceChildren();
        terminal.open(container);
        terminalRef.current = terminal;
        applyXtermSurfaceStyles(container, terminalPaneRef.current, presetRef.current.xterm);

        terminal.attachCustomKeyEventHandler((ev) => {
            if (ev.type !== 'keydown') return true;
            if (serverEndedRef.current) return false;

            const seq = getArrowSequence(ev.key, terminal.modes.applicationCursorKeysMode);
            if (!seq) return true;
            if (ev.metaKey || ev.ctrlKey || ev.altKey) return true;

            const buf = terminal.buffer.active;
            if (buf.viewportY < buf.baseY) {
                terminal.scrollToBottom();
            }

            ev.preventDefault();
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'input', data: seq }));
            }
            return false;
        });

        const applySize = () => {
            fitAddon.fit();
            let dims = measureTerminalSize(terminal, container);
            if (!dims || dims.cols < 2 || dims.rows < 1) {
                dims = { cols: terminal.cols || 120, rows: terminal.rows || 32 };
            }
            if (terminal.cols !== dims.cols || terminal.rows !== dims.rows) {
                terminal.resize(dims.cols, dims.rows);
            }
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && dims.cols > 0 && dims.rows > 0) {
                wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
            return dims;
        };
        applySizeRef.current = applySize;

        const focusTerminal = () => {
            if (!serverEndedRef.current) terminal.focus();
        };

        (async () => {
            let ws;
            try {
                const accessToken = await getAccessToken();
                if (disposedRef.current) return;
                ws = new WebSocket(getWsUrl(sessionId, accessToken));
                wsRef.current = ws;
            } catch (err) {
                if (disposedRef.current) return;
                terminal.write(`\r\n\x1b[31m[System] Failed to connect: ${err?.message || 'Unknown error'}\x1b[0m\r\n`);
                showToast('error', `Terminal connection failed: ${err?.message || 'Unknown error'}`);
                setEnded(true);
                return;
            }

            ws.onopen = () => {
                if (disposedRef.current) return;
                openedRef.current = true;
                if (sessionLiveRef.current) setEnded(false);
                let attempts = 0;
                const tryFit = () => {
                    applySize();
                    focusTerminal();
                    if ((terminal.cols < 2 || terminal.rows < 1) && attempts < 8) {
                        attempts += 1;
                        requestAnimationFrame(tryFit);
                    }
                };
                requestAnimationFrame(tryFit);
            };

            ws.onerror = () => {
                if (serverEndedRef.current || disposedRef.current) return;
            };

            ws.onmessage = (event) => {
                if (disposedRef.current) return;
                const msg = parseWsMessage(event.data);
                if (msg.type === 'output') {
                    // If the server echoes back a character we already printed
                    // locally, suppress it to avoid double-printing.
                    if (msg.data.length === 1 && pendingEchoes.length > 0 && msg.data === pendingEchoes[0]) {
                        pendingEchoes.shift();
                        return;
                    }
                    pendingEchoes.length = 0;
                    terminal.write(msg.data);
                } else if (msg.type === 'metrics') {
                    setMetrics(msg.data);
                } else if (msg.type === 'error') {
                    terminal.write(`\r\n\x1b[31m[System] ${msg.data}\x1b[0m\r\n`);
                    serverEndedRef.current = true;
                    setEnded(true);
                    onSessionEndRef.current?.(sessionId);
                    ws.close();
                } else if (msg.type === 'exit') {
                    if (msg.message) terminal.write(msg.message);
                    serverEndedRef.current = true;
                    setEnded(true);
                    onSessionEndRef.current?.(sessionId);
                    ws.close();
                }
            };

            ws.onclose = (event) => {
                if (ws.readyState !== WebSocket.CLOSED) {
                    ws.close();
                }
                if (disposedRef.current || serverEndedRef.current) return;
                if (!openedRef.current) {
                    terminal.write(`\r\n\x1b[31m[System] Terminal connection failed. Is the backend running at ${getBackendURL()}?\x1b[0m\r\n`);
                } else if (!event.wasClean) {
                    terminal.write('\r\n\x1b[33m[System] Disconnected from terminal.\x1b[0m\r\n');
                }
                setEnded(true);
            };

            terminal.onData((data) => {
                if (serverEndedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                wsRef.current.send(JSON.stringify({ type: 'input', data }));

                // Local echo for printable characters to mask network latency.
                // We also keep a small queue of echoed characters so we can drop
                // the identical character when the server echoes it back, avoiding
                // double-printing in line-oriented shells.
                for (const ch of data) {
                    if (isSinglePrintableChar(ch)) {
                        terminal.write(ch);
                        pendingEchoes.push(ch);
                        if (pendingEchoes.length > 32) pendingEchoes.shift();
                    } else {
                        // Control characters (Enter, arrows, backspace, etc.) change
                        // the remote state in ways we can't predict locally; clear the
                        // echo queue so we don't suppress unrelated output.
                        pendingEchoes.length = 0;
                    }
                }
            });
        })();

        container.addEventListener('mousedown', focusTerminal);
        container.addEventListener('click', focusTerminal);

        let resizeFrame = null;
        const scheduleApplySize = () => {
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                applySize();
            });
        };

        const resizeObserver = new ResizeObserver(() => scheduleApplySize());
        resizeObserver.observe(container);

        const visibilityObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => scheduleApplySize());
                });
            }
        });
        visibilityObserver.observe(container);

        return () => {
            disposedRef.current = true;
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            visibilityObserver.disconnect();
            resizeObserver.disconnect();
            container.removeEventListener('mousedown', focusTerminal);
            container.removeEventListener('click', focusTerminal);
            if (wsRef.current) wsRef.current.close();
            terminal.dispose();
            terminalRef.current = null;
            applySizeRef.current = null;
        };
    }, [sessionId]);

    useEffect(() => {
        const terminal = terminalRef.current;
        const container = containerRef.current;
        if (!terminal) return;

        terminal.options.theme = preset.xterm;
        terminal.options.minimumContrastRatio = XTERM_MINIMUM_CONTRAST_RATIO;
        if (terminal.rows > 0) {
            terminal.refresh(0, terminal.rows - 1);
        }
        applyXtermSurfaceStyles(container, terminalPaneRef.current, preset.xterm);

        const applySize = applySizeRef.current;
        if (applySize) {
            applySize();
        }
    }, [preset, themeRevision]);

    const formatMem = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';
    const terminalBackground = preset.xterm.background;

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            <div className="h-10 bg-[#FAFBFC] border-b border-[#E8EAED] flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${ended ? 'bg-[#9AA0A6]' : 'bg-[#4A7C59] animate-pulse'}`}></div>
                    <span className="text-xs font-mono font-medium text-[#202124]">
                        {agentName}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-[#5F6368] min-w-0">
                    <TerminalThemePicker />
                    <div className="hidden sm:block h-4 w-px bg-[#E8EAED] shrink-0" aria-hidden />
                    <div className="flex items-center gap-1.5 shrink-0" title="CPU Usage">
                        <Cpu className="w-3.5 h-3.5 text-[#9AA0A6]" />
                        <span className={metrics.cpu > 50 ? 'text-[#C06C5D]' : ''}>{metrics.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" title="Memory (RSS)">
                        <HardDrive className="w-3.5 h-3.5 text-[#9AA0A6]" />
                        <span>{formatMem(metrics.memory)}</span>
                    </div>
                    {projectId && token && (
                        <>
                            <div className="hidden sm:block h-4 w-px bg-[#E8EAED] shrink-0" aria-hidden />
                            <PreviewControlGroup {...preview} />
                        </>
                    )}
                    {(onStart || onStop || onDisconnect || onToggleWorkspace) && (
                        <>
                            <div className="hidden sm:block h-4 w-px bg-[#E8EAED] shrink-0" aria-hidden />
                            <div className="flex items-center gap-0.5 shrink-0">
                                {(onStart || onStop) && (
                                    <button
                                        type="button"
                                        disabled={sessionControlPending || (!ended && !onStop) || (ended && !onStart)}
                                        onClick={ended ? onStart : onStop}
                                        title={
                                            sessionControlPending
                                                ? (ended ? 'Starting…' : 'Stopping…')
                                                : (ended ? 'Start session' : 'Stop session')
                                        }
                                        aria-label={
                                            sessionControlPending
                                                ? (ended ? 'Starting session' : 'Stopping session')
                                                : (ended ? 'Start session' : 'Stop session')
                                        }
                                        className="rounded-md p-1.5 text-[#5F6368] hover:bg-[#E8EAED] hover:text-[#202124] disabled:opacity-50"
                                    >
                                        {sessionControlPending ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : ended ? (
                                            <Play className="w-3.5 h-3.5" />
                                        ) : (
                                            <Square className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                )}
                                {onDisconnect && (
                                    <button
                                        type="button"
                                        onClick={onDisconnect}
                                        title="Disconnect view"
                                        className="rounded-md p-1.5 text-[#5F6368] hover:bg-[#E8EAED] hover:text-[#202124]"
                                    >
                                        <Unplug className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                {onToggleWorkspace && (
                                    <button
                                        type="button"
                                        onClick={onToggleWorkspace}
                                        title={workspaceOpen ? 'Hide workspace files' : 'Show workspace files'}
                                        className="rounded-md p-1.5 text-[#5F6368] hover:bg-[#E8EAED] hover:text-[#202124]"
                                    >
                                        {workspaceOpen ? (
                                            <PanelRightClose className="w-3.5 h-3.5" />
                                        ) : (
                                            <PanelRightOpen className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div
                ref={terminalPaneRef}
                className="flex min-h-0 flex-1 flex-col overflow-hidden p-4"
                style={{ backgroundColor: terminalBackground, '--xterm-bg': terminalBackground, '--xterm-fg': preset.xterm.foreground }}
            >
                <div ref={containerRef} className="xterm-host min-h-0 w-full flex-1" />
            </div>
        </div>
    );
}
