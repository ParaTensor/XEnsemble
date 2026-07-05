const { FsAdapter, RuntimeError } = require('./interfaces');

/**
 * Kubernetes FsAdapter stub.
 *
 * Phase 2 / future development: will access workspace files through PVC,
 * object storage, or a sidecar file service.
 */
class K8sFsAdapter extends FsAdapter {
    async fsList(/* rootDir, relativePath */) {
        throw new RuntimeError('K8s FsAdapter is not implemented in this phase.', 501);
    }

    async fsRead(/* rootDir, relativePath */) {
        throw new RuntimeError('K8s FsAdapter is not implemented in this phase.', 501);
    }

    resolveStateDir(/* workspaceRoot, sessionId */) {
        throw new RuntimeError('K8s FsAdapter is not implemented in this phase.', 501);
    }

    async exists(/* rootDir, relativePath */) {
        throw new RuntimeError('K8s FsAdapter is not implemented in this phase.', 501);
    }

    async mkdirp(/* rootDir, relativePath */) {
        throw new RuntimeError('K8s FsAdapter is not implemented in this phase.', 501);
    }
}

module.exports = K8sFsAdapter;
