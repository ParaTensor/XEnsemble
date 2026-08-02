const WS_CLOSE_CODES = Object.freeze({
    UNAUTHORIZED: 4401,
    FORBIDDEN: 4403,
});

function closeWebSocketWithError(ws, sendJson, message, code) {
    sendJson({ type: 'error', data: message });
    const reason = Buffer.byteLength(message, 'utf8') <= 123 ? message : 'WebSocket request rejected';
    ws.close(code, reason);
}

function closeUnauthorizedWebSocket(ws, sendJson, message = 'Invalid access token') {
    closeWebSocketWithError(ws, sendJson, message, WS_CLOSE_CODES.UNAUTHORIZED);
}

function closeForbiddenWebSocket(ws, sendJson, message = 'Unauthorized') {
    closeWebSocketWithError(ws, sendJson, message, WS_CLOSE_CODES.FORBIDDEN);
}

function sendWebSocketReady(sendJson) {
    sendJson({ type: 'ready' });
}

module.exports = {
    WS_CLOSE_CODES,
    closeUnauthorizedWebSocket,
    closeForbiddenWebSocket,
    sendWebSocketReady,
};
