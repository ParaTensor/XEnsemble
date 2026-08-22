const { PreviewAdapter, RuntimeError } = require('./interfaces');
const { SandboxInstance, createSandboxPreview } = require('@blaxel/core');

class BlaxelPreviewAdapter extends PreviewAdapter {
    constructor() {
        super();
    }

    async startPreview(project, contract) {
        const sandboxName = `xe-${project.userId}-${project.id}`.slice(0, 64);
        const port = contract?.port || 3000;

        try {
            const sandbox = await SandboxInstance.get(sandboxName);
            if (!sandbox) throw new RuntimeError('Sandbox not found', 404);

            // Create a preview URL for the sandbox
            const preview = await createSandboxPreview({
                sandbox: sandboxName,
                body: {
                    port,
                    protocol: 'http',
                },
            });

            return {
                url: preview?.url || preview?.previewUrl,
                port,
                sandboxName,
            };
        } catch (e) {
            throw new RuntimeError(`Failed to start preview: ${e.message}`, 502);
        }
    }

    async stopPreview(deployment) {
        // Blaxel previews are managed by the sandbox lifecycle
        // No explicit stop needed
    }
}

module.exports = BlaxelPreviewAdapter;
