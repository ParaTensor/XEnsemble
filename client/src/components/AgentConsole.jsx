import React, { useState, useEffect, useRef } from 'react';
import { Cpu, HardDrive, Unplug, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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

export default function AgentConsole({
    sessionId,
    agentName,
    onSessionEnd,
    onDisconnect,
    workspaceOpen,
    onToggleWorkspace,
}) {
    const [metrics, setMetrics] = useState({ cpu: 0, memory: 0 });
    const [ended, setEnded] = useState(false);
    const containerRef = useRef(null);
    const onSessionEndRef = useRef(onSessionEnd);
    onSessionEndRef.current = onSessionEnd;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        setEnded(false);
        const disposedRef = { current: false };
        const serverEndedRef = { current: false };
        const openedRef = { current: false };

        const terminal = new Terminal({
            cols: 120,
            rows: 32,
            scrollback: 10000,
            convertEol: true,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.2,
            cursorBlink: true,
            theme: {
                background: '#09090b',
                foreground: '#f4f4f5',
                cursor: '#ffffff',
            },
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        container.replaceChildren();
        terminal.open(container);

        const wsHost = window.location.hostname || 'localhost';
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(
            `${wsProtocol}//${wsHost}:3000/ws/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`
        );

        const applySize = () => {
            fitAddon.fit();
            let dims = measureTerminalSize(terminal, container);
            if (!dims || dims.cols < 2 || dims.rows < 1) {
                dims = { cols: terminal.cols || 120, rows: terminal.rows || 32 };
            }
            if (terminal.cols !== dims.cols || terminal.rows !== dims.rows) {
                terminal.resize(dims.cols, dims.rows);
            }
            if (ws.readyState === WebSocket.OPEN && dims.cols > 0 && dims.rows > 0) {
                ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
            }
            return dims;
        };

        const focusTerminal = () => {
            if (!serverEndedRef.current) terminal.focus();
        };

        ws.onopen = () => {
            openedRef.current = true;
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
            if (!serverEndedRef.current && !disposedRef.current) {
                terminal.write('\r\n\x1b[31m[System] Terminal connection failed. Is the backend running on port 3000?\x1b[0m\r\n');
            }
        };

        ws.onmessage = (event) => {
            const msg = parseWsMessage(event.data);
            if (msg.type === 'output') {
                terminal.write(msg.data);
            } else if (msg.type === 'metrics') {
                setMetrics(msg.data);
            } else if (msg.type === 'error') {
                terminal.write(`\r\n\x1b[31m[System] ${msg.data}\x1b[0m\r\n`);
                serverEndedRef.current = true;
                setEnded(true);
                onSessionEndRef.current?.(sessionId);
            } else if (msg.type === 'exit') {
                if (msg.message) terminal.write(msg.message);
                serverEndedRef.current = true;
                setEnded(true);
                onSessionEndRef.current?.(sessionId);
            }
        };

        ws.onclose = () => {
            if (disposedRef.current || serverEndedRef.current) return;
            if (!openedRef.current) return;
            terminal.write('\r\n\x1b[33m[System] Disconnected from terminal.\x1b[0m\r\n');
        };

        terminal.onData((data) => {
            if (serverEndedRef.current || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: 'input', data }));
        });

        container.addEventListener('mousedown', focusTerminal);

        const resizeObserver = new ResizeObserver(() => applySize());
        resizeObserver.observe(container);

        return () => {
            disposedRef.current = true;
            resizeObserver.disconnect();
            container.removeEventListener('mousedown', focusTerminal);
            ws.close();
            terminal.dispose();
        };
    }, [sessionId]);

    const formatMem = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

    return (
        <div className="flex flex-col h-full bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 shadow-xl">
            <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${ended ? 'bg-zinc-500' : 'bg-green-500 animate-pulse'}`}></div>
                    <span className="text-xs font-mono font-medium text-zinc-300">
                        {agentName} <span className="text-zinc-600">[{sessionId}]</span>
                    </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                    {!ended && (
                        <span className="text-zinc-500 hidden lg:inline">Click terminal to type</span>
                    )}
                    <div className="flex items-center gap-1.5" title="CPU Usage">
                        <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                        <span className={metrics.cpu > 50 ? 'text-amber-400' : ''}>{metrics.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Memory (RSS)">
                        <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{formatMem(metrics.memory)}</span>
                    </div>
                    {(onDisconnect || onToggleWorkspace) && (
                        <>
                            <div className="hidden sm:block h-4 w-px bg-zinc-700" aria-hidden />
                            <div className="flex items-center gap-0.5">
                                {onDisconnect && (
                                    <button
                                        type="button"
                                        onClick={onDisconnect}
                                        title="Disconnect view"
                                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                    >
                                        <Unplug className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                {onToggleWorkspace && (
                                    <button
                                        type="button"
                                        onClick={onToggleWorkspace}
                                        title={workspaceOpen ? 'Hide workspace files' : 'Show workspace files'}
                                        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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

            <div className="flex-1 p-2 min-h-0 overflow-hidden">
                <div ref={containerRef} className="xterm-host w-full h-full" />
            </div>
        </div>
    );
}
