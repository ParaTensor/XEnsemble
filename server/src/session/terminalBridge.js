const sessionManager = require('./SessionManager');
const transcriptStore = require('../runtime/TranscriptStore');
const { readScrollback } = require('../runtime/LocalScrollbackBuffer');

function normalizeCursor(after) {
    const value = Number(after);
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

async function resolveLiveSession(sessionId, options = {}) {
    const session = sessionManager.getSession(sessionId);
    if (session && sessionManager.isAlive(sessionId)) {
        return { ok: true, session, handle: session.handle };
    }

    const sessionRecord = options.sessionRecord || session || null;
    const canWake = typeof options.wakeSession === 'function';
    const recoverable = sessionRecord?.recoverable === true;
    // Wake when the session is idle OR when it's in memory but not alive
    // (e.g. the handle's WebSocket died but the DB status wasn't updated to 'idle'
    // because the onExit callback's DB update failed).
    const isIdle = sessionRecord?.status === 'idle' || session?.status === 'idle';
    const inMemoryButDead = Boolean(session) && !sessionManager.isAlive(sessionId);

    if (canWake && recoverable && (isIdle || inMemoryButDead)) {
        try {
            await options.wakeSession(sessionRecord);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: errorMsg || 'Failed to wake session' };
        }
        const revived = sessionManager.getSession(sessionId);
        if (revived && sessionManager.isAlive(sessionId)) {
            return { ok: true, session: revived, handle: revived.handle };
        }
        return {
            ok: false,
            error: 'Session wake failed. Please try again or restart the agent.',
        };
    }

    if (!sessionRecord && !session) {
        return {
            ok: false,
            error: 'Session not found. The backend may have restarted — use Restart to reconnect.',
        };
    }

    return {
        ok: false,
        error: 'This session has ended. Launch a new agent instead of reconnecting to an old one.',
    };
}

function applyTerminalMessage(handle, msg) {
    if (msg.type === 'input') {
        handle.write(msg.data);
        return;
    }
    if (msg.type === 'resize') {
        try {
            handle.resize(msg.cols, msg.rows);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            if (!/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(errorMsg)) {
                console.error('PTY Resize Error:', errorMsg);
            }
        }
    }
}

/**
 * Subscribe to PTY output/metrics/exit for a session. Used by WS and HTTP (SSE) transports.
 * @param {string} sessionId
 * @param {(payload: object) => void} send
 * @returns {{ ok: boolean, cleanup: () => void, handle?: object }}
 */
async function subscribeTerminal(sessionId, send, options = {}) {
    const resolved = await resolveLiveSession(sessionId, options);
    if (!resolved.ok) {
        send({ type: 'error', data: resolved.error });
        return { ok: false, cleanup: () => {} };
    }

    const { session, handle } = resolved;
    const transcriptRef = session.transcriptRef || session.streamRef;
    const after = normalizeCursor(options.after);
    let lastSentSeq = after;
    let replaying = true;
    let cleaned = false;
    let pendingExit = null;
    let replayComplete = false;
    const pendingLiveFrames = [];
    let subscribed = false;

    const maybeSend = (payload) => {
        if (cleaned) return;
        send(payload);
    };

    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (subscribed) {
            sessionManager.removeTerminalSubscriber(sessionId);
            subscribed = false;
        }
        offExit();
        offOutput();
    };

    const REPLAY_CHUNK_SIZE = 512 * 1024;

    const flushFrames = (frames) => {
        let batchedData = '';
        let lastBatchSeq = null;

        for (const frame of frames) {
            if (cleaned) break;
            if (frame.seq != null && frame.seq <= lastSentSeq) {
                continue;
            }
            if (frame.kind === 'exit') {
                if (batchedData) {
                    maybeSend({ type: 'output', data: batchedData, seq: lastBatchSeq ?? undefined });
                    batchedData = '';
                }
                pendingExit = frame;
                if (frame.seq != null) {
                    lastSentSeq = frame.seq;
                }
                continue;
            }
            if (frame.kind !== 'out') {
                if (frame.seq != null) {
                    lastSentSeq = frame.seq;
                }
                continue;
            }
            batchedData += frame.data;
            if (frame.seq != null) {
                lastSentSeq = frame.seq;
                lastBatchSeq = frame.seq;
            }
            if (batchedData.length >= REPLAY_CHUNK_SIZE) {
                maybeSend({ type: 'output', data: batchedData, seq: lastBatchSeq ?? undefined });
                batchedData = '';
            }
        }
        if (batchedData) {
            maybeSend({ type: 'output', data: batchedData, seq: lastBatchSeq ?? undefined });
        }
    };

    const drainPendingLive = () => {
        if (cleaned || pendingLiveFrames.length === 0) return;
        const frames = pendingLiveFrames.splice(0, pendingLiveFrames.length);
        flushFrames(frames);
    };

    const maybeFinalizeExit = () => {
        if (cleaned || !pendingExit) return;
        const exitSeq = pendingExit.seq ?? 0;
        if (transcriptRef && pendingExit.seq != null && lastSentSeq < exitSeq) {
            const tail = transcriptStore.readFrom(transcriptRef, lastSentSeq);
            if (tail.length > 0) {
                flushFrames(tail);
            }
        }
        if (pendingExit.seq != null && lastSentSeq < exitSeq) {
            return;
        }
        maybeSend({
            type: 'exit',
            data: pendingExit.data?.code ?? null,
            seq: pendingExit.seq ?? undefined,
            message: `\r\n\x1b[33m[Session ended with code ${pendingExit.data?.code ?? 'unknown'}]\x1b[0m\r\n`,
        });
        cleanup();
    };

    const replayTranscript = async () => {
        const transcriptFrames = transcriptRef ? transcriptStore.readFrom(transcriptRef, after) : [];
        if (transcriptFrames.length > 0) {
            flushFrames(transcriptFrames);
        } else if (transcriptRef && !transcriptStore.hasTranscript(transcriptRef)) {
            const scrollback = readScrollback(transcriptRef);
            if (scrollback) {
                maybeSend({ type: 'output', data: scrollback });
            }
        } else if (session.history) {
            // Legacy in-memory history fallback for live sessions before the transcript store was populated.
            maybeSend({ type: 'output', data: session.history });
        }
        replaying = false;
        replayComplete = true;
        drainPendingLive();
        maybeFinalizeExit();
    };

    sessionManager.addTerminalSubscriber(sessionId);
    subscribed = true;

    let liveBatch = [];
    let liveBatchScheduled = false;

    const flushLiveBatch = () => {
        if (liveBatch.length === 0) return;
        const frames = liveBatch;
        liveBatch = [];
        liveBatchScheduled = false;
        let batchedData = '';
        let lastBatchSeq = null;
        for (const frame of frames) {
            if (cleaned) break;
            if (frame.seq != null && frame.seq <= lastSentSeq) continue;
            batchedData += frame.data;
            if (frame.seq != null) {
                lastSentSeq = frame.seq;
                lastBatchSeq = frame.seq;
            }
        }
        if (batchedData) {
            maybeSend({ type: 'output', data: batchedData, seq: lastBatchSeq ?? undefined });
        }
        maybeFinalizeExit();
    };

    const offOutput = sessionManager.subscribeOutput(sessionId, (frame) => {
        if (cleaned) return;
        if (replaying) {
            pendingLiveFrames.push(frame);
            return;
        }
        if (frame.seq != null && frame.seq <= lastSentSeq) {
            return;
        }
        liveBatch.push(frame);
        if (!liveBatchScheduled) {
            liveBatchScheduled = true;
            queueMicrotask(flushLiveBatch);
        }
    });

    const offExit = sessionManager.onExit(sessionId, (exitCode, exitSeq) => {
        pendingExit = {
            data: { code: exitCode },
            seq: exitSeq ?? null,
        };
        if (replayComplete) {
            maybeFinalizeExit();
        }
    });

    replayTranscript().catch((err) => {
        maybeSend({ type: 'error', data: err?.message || 'Failed to replay terminal transcript' });
        cleanup();
    });

    return { ok: true, cleanup, handle };
}

module.exports = {
    resolveLiveSession,
    applyTerminalMessage,
    subscribeTerminal,
};
