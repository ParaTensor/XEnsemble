const { ExecAdapter, RuntimeError } = require('./interfaces');

/**
 * Kubernetes ExecAdapter stub.
 *
 * Phase 2 / future development: will provide interactive Agent sessions through
 * Kubernetes exec/attach/stream or a sidecar proxy.
 */
class K8sExecAdapter extends ExecAdapter {
    spawn(/* cmd, args, env, options */) {
        throw new RuntimeError('K8s ExecAdapter is not implemented in this phase.', 501);
    }

    async exec(/* cmd, args, env, options */) {
        throw new RuntimeError('K8s ExecAdapter is not implemented in this phase.', 501);
    }
}

module.exports = K8sExecAdapter;
