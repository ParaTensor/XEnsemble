const { PreviewAdapter, RuntimeError } = require('./interfaces');

/**
 * BoxLite PreviewAdapter stub.
 *
 * Phase 2 / future development: will start preview processes inside a BoxLite
 * sandbox and register them with the XEnsemble Preview Gateway.
 */
class BoxLitePreviewAdapter extends PreviewAdapter {
    async startPreview(project, contract) {
        // Preview not yet supported for BoxLite (port forward gap); return contract as-is.
        // Callers should handle absence of publicUrl or fall back.
        return { ...contract, publicUrl: null };
    }

    async stopPreview(deployment) {
        // no-op
    }
}

module.exports = BoxLitePreviewAdapter;
