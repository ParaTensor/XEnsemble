import React, { useState, useEffect, useRef } from 'react';
import { Cpu, HardDrive, Loader2, Play, Square, Unplug, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { usePreview, PreviewControlGroup } from './PreviewPanel';
import TerminalThemePicker from './TerminalThemePicker';
import BranchSelector from './github/BranchSelector';
import { getWsUrl, getAccessToken, getBackendURL, refreshAccessToken } from '../lib/api';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { XTERM_MINIMUM_CONTRAST_RATIO } from '../lib/terminalThemes.js';
import { useToast } from './Toast';
import { useGitStatus } from '../hooks/useGitStatus.js';
import {
    createTerminalReconnectState,
    isTerminalAuthFailure,
    refreshTokenForTerminalFailure,
} from '../../../../shared/terminalReconnect.mjs';

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

const GIT_PROVIDERS = new Set(['github', 'gitlab', 'gitea', 'local_git']);

function AgentConsole({
    sessionId,
    agentName,
    projectId,
    project,
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
    const isGitProject = GIT_PROVIDERS.has(project?.repoProvider);
    const [metrics, setMetrics] = useState({ cpu: 0, memory: 0 });
    const [ended, setEnded] = useState(!sessionLive);
    const { preset, themeRevision } = useTerminalTheme();
    const preview = usePreview(projectId, token);
    const { showToast } = useToast();
    const gitStatus = useGitStatus(isGitProject ? projectId : null);
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
        const authenticatedRef = { current: false };
        const wsRef = { current: null };

        const terminal = new Terminal({
            allowProposedApi: true,
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
        terminal.loadAddon(new Unicode11Addon());
        terminal.unicode.activeVersion = '11';
        container.replaceChildren();
        terminal.open(container);
        // Fit terminal to container BEFORE creating WebSocket so transcript
        // replay doesn't wrap at the wrong width.
        try { fitAddon.fit(); } catch (_) {}
        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => { webglAddon.dispose(); });
            terminal.loadAddon(webglAddon);
        } catch (_) {
            // WebGL not available, fall back to default DOM renderer
        }
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

        const reconnectState = createTerminalReconnectState();
        const reconnectTimerRef = { current: null };
        const MAX_RECONNECTS = 5;

        const scheduleReconnect = (reason) => {
            if (disposedRef.current || serverEndedRef.current) return;
            const next = reconnectState.nextReconnect();
            if (next.exhausted) {
                terminal.write(`\r\n\x1b[31m[System] Terminal could not be restored${reason ? ` (${reason})` : ''}. Click Restart to retry.\x1b[0m\r\n`);
                setEnded(true);
                return;
            }
            terminal.write(`\r\n\x1b[33m[System] Reconnecting terminal… (${next.attempt}/${MAX_RECONNECTS})\x1b[0m\r\n`);
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                if (!disposedRef.current) connect();
            }, next.delayMs);
        };

        let writeRafId = null;

        const connect = async () => {
            let ws;
            try {
                const accessToken = await getAccessToken();
                if (disposedRef.current) return;
                ws = new WebSocket(getWsUrl(sessionId, accessToken));
                wsRef.current = ws;
            } catch (err) {
                if (disposedRef.current) return;
                scheduleReconnect(err?.message || 'connect error');
                return;
            }

            let failureHandled = false;
            let authenticated = false;
            let writeBuffer = '';
            let vsScreen = [];
            let vsCursorY = 0;
            const VS_ROWS = 32;
            for (let y = 0; y < VS_ROWS; y++) vsScreen[y] = '';
            // Buffer for incomplete sync-term (DECSET 2026) blocks so vsProcess
            // sees the full cursor-up pattern.  See web AgentConsole for details.
            let syncTermPending = '';
            function vsStripAnsi(text) {
                return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
            }
            function vsProcess(data) {
                const hasClear = /\x1b\[2J/.test(data);
                if (hasClear) for (let y = 0; y < VS_ROWS; y++) vsScreen[y] = '';
                let dataOffset = 0;
                while (dataOffset < data.length) {
                    if (data[dataOffset] === '\x1b' && data[dataOffset + 1] === '[' && data[dataOffset + 2] === '?') {
                        let j = dataOffset + 3;
                        while (j < data.length && !/[A-Za-z]/.test(data[j])) j++;
                        dataOffset = j + 1;
                    } else if (data[dataOffset] === '\x1b' && data[dataOffset + 1] === ']') {
                        const e = data.indexOf('\x07', dataOffset + 2);
                        dataOffset = e >= 0 ? e + 1 : data.length;
                    } else { break; }
                }
                const cursorUpMatch = data.slice(dataOffset).match(/^\x1b\[(\d+)A/);
                if (!cursorUpMatch) {
                    let i = 0, cx = 0, cy = vsCursorY;
                    while (i < data.length) {
                        if (data[i] === '\x1b') {
                            if (data[i + 1] === '[') {
                                let j = i + 2;
                                while (j < data.length && !/[A-Za-z]/.test(data[j])) j++;
                                const p = data.slice(i + 2, j), f = data[j], n = parseInt(p) || 1;
                                if (f === 'A') cy = Math.max(0, cy - n);
                                else if (f === 'B') cy = Math.min(VS_ROWS - 1, cy + n);
                                else if (f === 'G') cx = Math.max(0, n - 1);
                                else if (f === 'H') { const s = p.split(';'); cy = Math.max(0, (parseInt(s[0]) || 1) - 1); cx = Math.max(0, (parseInt(s[1]) || 1) - 1); }
                                else if (f === 'J' && n === 2) for (let y = 0; y < VS_ROWS; y++) vsScreen[y] = '';
                                else if (f === 'K' && (n === 2 || !p)) vsScreen[cy] = '';
                                i = j + 1;
                            } else if (data[i + 1] === 'h' || data[i + 1] === 'l') { i += 2; }
                            else if (data[i + 1] === ']') { const e = data.indexOf('\x07', i + 2); i = e >= 0 ? e + 1 : data.length; }
                            else i++;
                        } else if (data[i] === '\r' && data[i + 1] === '\n') { cy++; cx = 0; i += 2; }
                        else if (data[i] === '\r') { cx = 0; i++; }
                        else if (data[i] === '\n') { cy++; i++; }
                        else if (data[i] >= ' ') {
                            if (cy >= 0 && cy < VS_ROWS && cx < 120) {
                                const r = vsScreen[cy];
                                vsScreen[cy] = r.substring(0, cx) + data[i] + r.substring(cx + 1);
                            }
                            cx++; i++;
                        } else i++;
                    }
                    vsCursorY = cy;
                    return data;
                }
                const upCount = parseInt(cursorUpMatch[1]);
                let startRow = Math.max(0, vsCursorY - upCount);
                const prefix = data.slice(0, dataOffset + cursorUpMatch[0].length);
                const rest = data.slice(dataOffset + cursorUpMatch[0].length);
                const segments = rest.match(/\x1b\[2K[^\r\n]*/g);
                if (!segments || segments.length === 0) { vsCursorY = startRow; return data; }
                let output = prefix;
                let currentRow = startRow;
                let anyChanged = false;
                for (const seg of segments) {
                    if (currentRow >= VS_ROWS) break;
                    const raw = seg.slice(4);
                    const plain = vsStripAnsi(raw);
                    if (vsScreen[currentRow] !== plain) {
                        output += `\x1b[${currentRow + 1};1H\x1b[2K${raw}\r\n`;
                        vsScreen[currentRow] = plain;
                        anyChanged = true;
                    }
                    currentRow++;
                }
                vsCursorY = currentRow - 1;
                return anyChanged ? output : prefix + '\x1b[H';
            }
            const flushWriteBuffer = () => {
                writeRafId = null;
                if (disposedRef.current) return;
                if (!writeBuffer && !syncTermPending) return;

                let data = syncTermPending + (writeBuffer || '');
                syncTermPending = '';
                writeBuffer = '';

                // Buffer incomplete sync-term blocks.  When complete, strip
                // wrappers and write directly, bypassing vsProcess.  See web
                // AgentConsole for full rationale.
                const syncStart = data.indexOf('\x1b[?2026h');
                if (syncStart !== -1) {
                    const syncEnd = data.indexOf('\x1b[?2026l', syncStart);
                    if (syncEnd === -1) {
                        if (syncStart > 0) {
                            writeTerminalData(data.slice(0, syncStart));
                        }
                        syncTermPending = data.slice(syncStart);
                        return;
                    }
                    if (syncStart > 0) {
                        writeTerminalData(data.slice(0, syncStart));
                    }
                    const blockEnd = syncEnd + '\x1b[?2026l'.length;
                    const stripped = data.slice(syncStart + '\x1b[?2026h'.length, syncEnd);
                    if (stripped) {
                        writeTerminalData(stripped);
                    }
                    if (blockEnd < data.length) {
                        writeTerminalData(data.slice(blockEnd));
                    }
                    return;
                }

                writeTerminalData(vsProcess(data));
            };

            function writeTerminalData(processed) {
                const viewport = containerRef.current?.querySelector('.xterm-viewport');
                const atBottom = !viewport || viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 5;
                terminal.write(processed, () => {
                    if (atBottom && !disposedRef.current) terminal.scrollToBottom();
                });
            }

            const markAuthenticated = () => {
                if (authenticated || disposedRef.current || wsRef.current !== ws) return;
                authenticated = true;
                authenticatedRef.current = true;
                reconnectState.authenticationSucceeded();
                if (sessionLiveRef.current) setEnded(false);
            };

            const handleConnectionFailure = async (reason, failure = {}) => {
                if (failureHandled || disposedRef.current || serverEndedRef.current || wsRef.current !== ws) return;
                failureHandled = true;
                authenticatedRef.current = false;
                await refreshTokenForTerminalFailure(failure, refreshAccessToken);
                if (!disposedRef.current && !serverEndedRef.current && wsRef.current === ws) {
                    scheduleReconnect(reason);
                }
            };

            ws.onopen = () => {
                if (disposedRef.current) return;
                reconnectState.socketOpened();
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
                if (msg.type === 'ready') {
                    markAuthenticated();
                } else if (msg.type === 'output') {
                    writeBuffer += msg.data;
                    if (writeRafId === null) {
                        writeRafId = requestAnimationFrame(flushWriteBuffer);
                    }
                } else if (msg.type === 'metrics') {
                    setMetrics(msg.data);
                } else if (msg.type === 'error') {
                    if (writeRafId !== null) { cancelAnimationFrame(writeRafId); clearTimeout(writeRafId); writeRafId = null; flushWriteBuffer(); }
                    authenticatedRef.current = false;
                    const failure = { message: msg.data };
                    void handleConnectionFailure(msg.data || 'error', failure);
                    try { ws.close(); } catch { /* ignore */ }
                } else if (msg.type === 'exit') {
                    if (writeRafId !== null) { cancelAnimationFrame(writeRafId); clearTimeout(writeRafId); writeRafId = null; flushWriteBuffer(); }
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
                const wasConnected = authenticatedRef.current;
                authenticatedRef.current = false;
                const failure = { code: event.code, reason: event.reason };
                if (isTerminalAuthFailure(failure)) {
                    void handleConnectionFailure(event.reason || 'Invalid access token', failure);
                    return;
                }
                if (event.wasClean) return;
                void handleConnectionFailure(wasConnected ? 'disconnected' : 'connection failed', failure);
            };

            terminal.onData((data) => {
                if (serverEndedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                wsRef.current.send(JSON.stringify({ type: 'input', data }));
            });
        };
        connect();

        container.addEventListener('mousedown', focusTerminal);
        container.addEventListener('click', focusTerminal);

        let resizeFrame = null;
        let resizeDebounce = null;
        const scheduleApplySize = () => {
            if (resizeDebounce) clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => {
                resizeDebounce = null;
                applySize();
            }, 100);
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
            if (writeRafId !== null) { cancelAnimationFrame(writeRafId); clearTimeout(writeRafId); }
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (resizeDebounce) clearTimeout(resizeDebounce);
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
        <div
            className="flex h-full min-h-0 flex-col"
            style={{ backgroundColor: terminalBackground }}
        >
            <div className="h-10 bg-[#FAFBFC] border-b border-[#E8EAED] flex items-center justify-between px-4 shrink-0">
                <div className="flex min-w-0 items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${ended ? 'bg-[#9AA0A6]' : 'bg-[#4A7C59] animate-pulse'}`}></div>
                    <span className="text-xs font-mono font-medium text-[#202124]">
                        {agentName}
                    </span>
                    {projectId && isGitProject && (
                        <>
                            <div className="hidden sm:block h-4 w-px bg-[#E8EAED] shrink-0" aria-hidden />
                            <BranchSelector
                                projectId={projectId}
                                currentBranch={gitStatus.status?.branch}
                                onBranchChanged={() => gitStatus.fetchStatus({ silent: true })}
                            />
                        </>
                    )}
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

export default React.memo(AgentConsole);
