const { PreviewAdapter, RuntimeError } = require('./interfaces');

/**
 * BoxLite PreviewAdapter stub.
 *
 * Phase 2 / future development: will start preview processes inside a BoxLite
 * sandbox and register them with the XEnsemble Preview Gateway.
 */
class BoxLitePreviewAdapter extends PreviewAdapter {
    async startPreview(/* project, contract */) {
        throw new RuntimeError('BoxLite PreviewAdapter is not implemented in this phase.', 501);
    }

    async stopPreview(/* deployment */) {
        throw new RuntimeError('BoxLite PreviewAdapter is not implemented in this phase.', 501);
    }
}

module.exports = BoxLitePreviewAdapter;
