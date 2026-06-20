const { PreviewAdapter, RuntimeError } = require('./interfaces');

/**
 * Kubernetes PreviewAdapter stub.
 *
 * Phase 2 / future development: will expose preview through Kubernetes
 * Service/Gateway/Ingress, while the XEnsemble Preview Gateway continues to
 * enforce token, Host, user status and deployment status checks.
 */
class K8sPreviewAdapter extends PreviewAdapter {
    async startPreview(/* project, contract */) {
        throw new RuntimeError('K8s PreviewAdapter is not implemented in this phase.', 501);
    }

    async stopPreview(/* deployment */) {
        throw new RuntimeError('K8s PreviewAdapter is not implemented in this phase.', 501);
    }
}

module.exports = K8sPreviewAdapter;
