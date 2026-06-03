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

        // 1. 初始化 xterm.js
        const term = new Terminal({
            cursorBlink: true,
            theme: { 
                background: '#121317',
                foreground: '#f0f0f2',
                cursor: '#5e6ad2',
                selectionBackground: 'rgba(94, 106, 210, 0.3)',
                black: '#121317',
                red: '#ff3b30',
                green: '#4cd964',
                yellow: '#ffcc00',
                blue: '#5e6ad2',
                magenta: '#ff2d55',
                cyan: '#5ac8fa',
                white: '#f0f0f2',
            },
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontSize: 14,
            padding: 15
        });
        
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        
        // Timeout to allow DOM to render before fitting
        setTimeout(() => {
            fitAddon.fit();
        }, 10);
        
        xtermRef.current = term;

        // 2. 建立 WebSocket 连接
        const wsUrl = `ws://localhost:3000/ws/v1/terminal?sessionId=${sessionId}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('connected');
            handleResize(); // 同步视口大小
        };

        // 3. 处理后端传入的 PTY 流并渲染
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

        // 4. 将用户在 Web 端的键盘输入发送给后端 PTY
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // 5. 监听窗口大小变化并同步给后台 PTY
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
        
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        
        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current);
        }

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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="terminal-header">
                <div className="terminal-title">
                    <span className={`status-dot ${status}`}></span>
                    {agentName || 'Terminal'} - {sessionId.substring(0, 13)}...
                </div>
            </div>
            <div className="terminal-container" ref={terminalRef}></div>
        </div>
    );
}
