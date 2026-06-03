import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App';
import { Activity, Cpu, HardDrive } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

export default function AgentConsole({ sessionId, agentName }) {
    const { token } = useContext(AuthContext);
    const [metrics, setMetrics] = useState({ cpu: 0, memory: 0 });
    
    useEffect(() => {
        const terminal = new Terminal({
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.4,
            cursorBlink: true,
            theme: {
                background: '#09090b',
                foreground: '#f4f4f5',
                cursor: '#ffffff',
            }
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        
        const terminalContainer = document.getElementById('terminal-container');
        terminalContainer.innerHTML = ''; 
        terminal.open(terminalContainer);
        fitAddon.fit();

        const ws = new WebSocket(`ws://localhost:3000/ws/v1/terminal?sessionId=${sessionId}`);

        ws.onopen = () => {
            // First time fit
            fitAddon.fit();
            ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'output') {
                terminal.write(msg.data);
            } else if (msg.type === 'metrics') {
                setMetrics(msg.data);
            } else if (msg.type === 'error') {
                terminal.write(`\r\n\x1b[31m[System] ${msg.data}\x1b[0m\r\n`);
            }
        };

        terminal.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        const handleResize = () => {
            fitAddon.fit();
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            ws.close();
            terminal.dispose();
        };
    }, [sessionId]);

    const formatMem = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

    return (
        <div className="flex flex-col h-full bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 shadow-xl">
            {/* Terminal Header with Monitor */}
            <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-xs font-mono font-medium text-zinc-300">
                        {agentName} <span className="text-zinc-600">[{sessionId}]</span>
                    </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
                    <div className="flex items-center gap-1.5" title="CPU Usage">
                        <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                        <span className={metrics.cpu > 50 ? "text-amber-400" : ""}>{metrics.cpu.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Memory (RSS)">
                        <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{formatMem(metrics.memory)}</span>
                    </div>
                </div>
            </div>
            
            {/* Terminal Body */}
            <div className="flex-1 p-2 min-h-0 overflow-hidden relative group">
                <div id="terminal-container" className="w-full h-full"></div>
            </div>
        </div>
    );
}
