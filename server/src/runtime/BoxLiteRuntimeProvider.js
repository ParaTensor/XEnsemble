const { RuntimeProvider, RuntimeError } = require('./interfaces');

/**
 * BoxLite Managed Sandbox Runtime Provider stub.
 *
 * Phase 2 / future development: will orchestrate sandbox lifecycle through the
 * BoxLite API and maintain mappings between XEnsemble project/session/deployment
 * ids and BoxLite sandbox ids.
 */
class BoxLiteRuntimeProvider extends RuntimeProvider {
    async ensureReady(/* project, opts = {} */) {
        throw new RuntimeError(
            'BoxLite Runtime Provider is not implemented in this phase. Set RUNTIME_PROVIDER=local to use the Local Process Runtime.',
            501,
        );
    }

    async attach(/* runtimeRef */) {
        throw new RuntimeError('BoxLite Runtime Provider is not implemented in this phase.', 501);
    }

    async attachSession(/* sessionId, streamRef */) {
        throw new RuntimeError('BoxLite Runtime Provider is not implemented in this phase.', 501);
    }

    async destroy(/* runtimeRef */) {
        throw new RuntimeError('BoxLite Runtime Provider is not implemented in this phase.', 501);
    }

    async metrics(/* runtimeRef */) {
        throw new RuntimeError('BoxLite Runtime Provider is not implemented in this phase.', 501);
    }
}

module.exports = BoxLiteRuntimeProvider;
