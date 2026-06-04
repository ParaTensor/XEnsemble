// 仅 Local 有效：Preview 功能占位（MVP 暂未实现）。
const { PreviewAdapter } = require('./interfaces');

class LocalPreviewAdapter extends PreviewAdapter {
    async startPreview(project, contract) {
        throw new Error('Preview is not yet supported in Local provider');
    }

    async stopPreview(deployment) {
        throw new Error('Preview is not yet supported in Local provider');
    }
}

module.exports = LocalPreviewAdapter;
