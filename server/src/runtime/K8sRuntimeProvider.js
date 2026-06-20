const { RuntimeProvider, RuntimeError } = require('./interfaces');

/**
 * Kubernetes Production Runtime Provider stub.
 *
 * Phase 2 / future development: will map XEnsemble runtime/session/deployment
 * lifecycle to Kubernetes resources (Pod, Job, Service, PVC, etc.).
 */
class K8sRuntimeProvider extends RuntimeProvider {
    async ensureReady(/* project, opts = {} */) {
        throw new RuntimeError(
            'K8s Runtime Provider is not implemented in this phase. Set RUNTIME_PROVIDER=local to use the Local Process Runtime.',
            501,
        );
    }

    async attach(/* runtimeRef */) {
        throw new RuntimeError('K8s Runtime Provider is not implemented in this phase.', 501);
    }

    async attachSession(/* sessionId, streamRef */) {
        throw new RuntimeError('K8s Runtime Provider is not implemented in this phase.', 501);
    }

    async destroy(/* runtimeRef */) {
        throw new RuntimeError('K8s Runtime Provider is not implemented in this phase.', 501);
    }

    async metrics(/* runtimeRef */) {
        throw new RuntimeError('K8s Runtime Provider is not implemented in this phase.', 501);
    }
}

module.exports = K8sRuntimeProvider;
