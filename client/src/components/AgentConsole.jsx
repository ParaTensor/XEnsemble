import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

export default function AgentConsole({ sessionId, agentName }) {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const wsRef = useRef(null);
    const [status, setStatus] = useState('connecting'); // connecting, connected, disconnected

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize xterm.js with ParaRouter 'tech-console' aesthetic
        const term = new Terminal({
            cursorBlink: true,
            theme: { 
                background: '#18181b', // bg-zinc-900
                foreground: '#fafafa', // text-zinc-50
                cursor: '#ffffff',
                selectionBackground: 'rgba(255, 255, 255, 0.2)',
                black: '#18181b',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#d946ef',
                cyan: '#06b6d4',
                white: '#fafafa',
            },
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 13,
            lineHeight: 1.4,
            padding: 16
        });
        
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        
        // Timeout to allow DOM to render before fitting
        setTimeout(() => {
            fitAddon.fit();
        }, 10);
        
        xtermRef.current = term;

        // Connect WebSocket
        const wsUrl = `ws://localhost:3000/ws/v1/terminal?sessionId=${sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('connected');
            handleResize();
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    term.write(msg.data); 
                } else if (msg.type === 'error') {
                    term.write(`\r\n\x1b[31m[System Error] ${msg.data}\x1b[0m\r\n`);
                }
            } catch (e) {
                console.error("Failed to parse WS message", e);
            }
        };

        ws.onclose = () => {
            setStatus('disconnected');
            term.write('\r\n\x1b[33m[Connection Terminated]\x1b[0m\r\n');
        };

        ws.onerror = () => {
            setStatus('disconnected');
            term.write('\r\n\x1b[31m[WebSocket Connection Error]\x1b[0m\r\n');
        };

        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        const handleResize = () => {
            if (fitAddon && term) {
                fitAddon.fit();
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'resize',
                        cols: term.cols,
                        rows: term.rows
                    }));
                }
            }
        };
        
        const resizeObserver = new ResizeObserver(() => handleResize());
        if (terminalRef.current) resizeObserver.observe(terminalRef.current);
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            term.dispose();
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };
    }, [sessionId]);

    return (
        <div className="flex flex-col h-full bg-zinc-900 rounded-lg overflow-hidden">
            {/* Terminal Header Row */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
                <div className="flex items-center gap-3">
                    {/* Traffic light indicator */}
                    <div className="flex items-center gap-1.5">
                        <div className={`w-2.5 h-2.5 rounded-full ${status === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : status === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`}></div>
                    </div>
                    <div className="text-xs font-mono text-zinc-400 tracking-wide">
                        {agentName || 'Terminal'} <span className="opacity-50 mx-1">/</span> {sessionId.substring(0, 13)}
                    </div>
                </div>
                <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                    PTY Bridge
                </div>
            </div>
            
            {/* Terminal Viewport */}
            <div className="flex-1 overflow-hidden" ref={terminalRef}></div>
        </div>
    );
}
