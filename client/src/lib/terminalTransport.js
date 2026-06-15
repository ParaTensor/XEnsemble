import { getApiBase, getWsBase } from './api';

const WS_OPEN_TIMEOUT_MS = 4000;

function getTransportMode() {
    const mode = import.meta.env.VITE_TERMINAL_TRANSPORT?.trim()?.toLowerCase();
    if (mode === 'ws' || mode === 'http' || mode === 'auto') return mode;
    return 'auto';
}

function createWsTransport({ sessionId, onOpen, onMessage, onClose }) {
    const ws = new WebSocket(
        `${getWsBase()}/ws/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`,
    );

    let opened = false;
    let onFailedCallback = null;

    ws.onopen = () => {
        opened = true;
        onOpen?.('ws');
    };

    ws.onmessage = (event) => {
        try {
            onMessage(JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()));
        } catch (_) { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
        if (!opened) onFailedCallback?.();
    };

    ws.onclose = (event) => {
        if (!opened) {
            onFailedCallback?.(event);
            return;
        }
        onClose?.(event);
    };

    return {
        kind: 'ws',
        isOpen: () => ws.readyState === WebSocket.OPEN,
        send(msg) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg));
            }
        },
        close() {
            ws.close();
        },
        onFailed(callback) {
            onFailedCallback = callback;
        },
        waitForOpen(timeoutMs) {
            return new Promise((resolve) => {
                if (opened) {
                    resolve(true);
                    return;
                }
                const timer = setTimeout(() => resolve(false), timeoutMs);
                ws.addEventListener('open', () => {
                    clearTimeout(timer);
                    resolve(true);
                }, { once: true });
            });
        },
    };
}

function createHttpTransport({ sessionId, token, onOpen, onMessage, onClose }) {
    const apiBase = getApiBase();
    const streamUrl = `${apiBase}/api/v1/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&access_token=${encodeURIComponent(token)}`;
    const es = new EventSource(streamUrl);
    let opened = false;

    es.onopen = () => {
        opened = true;
        onOpen?.('http');
    };

    es.onmessage = (event) => {
        try {
            onMessage(JSON.parse(event.data));
        } catch (_) { /* ignore malformed frames */ }
    };

    es.onerror = () => {
        if (!opened) {
            onMessage({
                type: 'error',
                data: 'Terminal HTTP stream connection failed.',
            });
            return;
        }
        onClose?.();
    };

    return {
        kind: 'http',
        isOpen: () => opened && es.readyState !== EventSource.CLOSED,
        send(msg) {
            if (!token) return;
            fetch(`${apiBase}/api/v1/terminal/input`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    type: msg.type,
                    data: msg.data,
                    cols: msg.cols,
                    rows: msg.rows,
                }),
            }).catch(() => { /* input drops are non-fatal */ });
        },
        close() {
            es.close();
        },
    };
}

/**
 * Connect to agent terminal. WebSocket is preferred; falls back to SSE+POST when WS is blocked.
 * Set VITE_TERMINAL_TRANSPORT=ws|http|auto (default auto).
 */
export function connectTerminalTransport({ sessionId, token, onOpen, onMessage, onClose }) {
    const mode = getTransportMode();
    let active = null;
    let disposed = false;
    let fellBack = false;

    const attach = (transport) => {
        if (disposed) {
            transport.close();
            return;
        }
        if (active && active !== transport) active.close();
        active = transport;
    };

    const fallbackToHttp = () => {
        if (disposed || fellBack || active?.kind !== 'ws') return;
        fellBack = true;
        active?.close();
        attach(createHttpTransport({ sessionId, token, onOpen, onMessage, onClose }));
    };

    if (mode === 'http') {
        attach(createHttpTransport({ sessionId, token, onOpen, onMessage, onClose }));
    } else {
        const wsTransport = createWsTransport({ sessionId, onOpen, onMessage, onClose });
        active = wsTransport;

        if (mode === 'auto') {
            wsTransport.onFailed(fallbackToHttp);
            wsTransport.waitForOpen(WS_OPEN_TIMEOUT_MS).then((ok) => {
                if (!ok) fallbackToHttp();
            });
        }
    }

    return {
        send(msg) {
            active?.send(msg);
        },
        isOpen() {
            return active?.isOpen() ?? false;
        },
        close() {
            disposed = true;
            active?.close();
            active = null;
        },
        get kind() {
            return active?.kind ?? null;
        },
    };
}
