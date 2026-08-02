const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    WS_CLOSE_CODES,
    closeUnauthorizedWebSocket,
    closeForbiddenWebSocket,
    sendWebSocketReady,
} = require('./websocket');

function createSocketRecorder() {
    return {
        closes: [],
        close(code, reason) {
            this.closes.push({ code, reason });
        },
    };
}

describe('terminal WebSocket authentication protocol', () => {
    it('uses an explicit unauthorized close code for invalid access tokens', () => {
        const ws = createSocketRecorder();
        const messages = [];

        closeUnauthorizedWebSocket(ws, (message) => messages.push(message));

        assert.deepEqual(messages, [{ type: 'error', data: 'Invalid access token' }]);
        assert.deepEqual(ws.closes, [{
            code: WS_CLOSE_CODES.UNAUTHORIZED,
            reason: 'Invalid access token',
        }]);
    });

    it('distinguishes forbidden users from refreshable token failures', () => {
        const ws = createSocketRecorder();
        const messages = [];

        closeForbiddenWebSocket(ws, (message) => messages.push(message), 'User suspended');

        assert.deepEqual(messages, [{ type: 'error', data: 'User suspended' }]);
        assert.equal(ws.closes[0].code, WS_CLOSE_CODES.FORBIDDEN);
    });

    it('emits ready only after application setup succeeds', () => {
        const messages = [];
        sendWebSocketReady((message) => messages.push(message));
        assert.deepEqual(messages, [{ type: 'ready' }]);
    });
});
