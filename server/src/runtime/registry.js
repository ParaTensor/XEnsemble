/**
 * Runtime Provider 工厂 — 根据 RUNTIME_PROVIDER 环境变量选择实现。
 * 对齐 Architecture.md 3 节。
 */
const LocalRuntimeProvider = require('./LocalRuntimeProvider');
const LocalExecAdapter = require('./LocalExecAdapter');
const LocalFsAdapter = require('./LocalFsAdapter');
const LocalPreviewAdapter = require('./LocalPreviewAdapter');
const BoxLiteRuntimeProvider = require('./BoxLiteRuntimeProvider');
const BoxLiteExecAdapter = require('./BoxLiteExecAdapter');
const BoxLiteFsAdapter = require('./BoxLiteFsAdapter');
const BoxLitePreviewAdapter = require('./BoxLitePreviewAdapter');
const BlaxelRuntimeProvider = require('./BlaxelRuntimeProvider');
const BlaxelExecAdapter = require('./BlaxelExecAdapter');
const BlaxelFsAdapter = require('./BlaxelFsAdapter');
const BlaxelPreviewAdapter = require('./BlaxelPreviewAdapter');
const K8sRuntimeProvider = require('./K8sRuntimeProvider');
const K8sExecAdapter = require('./K8sExecAdapter');
const K8sFsAdapter = require('./K8sFsAdapter');
const K8sPreviewAdapter = require('./K8sPreviewAdapter');
const { resolveRuntimeProvider } = require('../config/runtimeProvider');

const PROVIDER = resolveRuntimeProvider();

let _runtime = null;

/**
 * @returns {{ provider: RuntimeProvider, exec: ExecAdapter, fs: FsAdapter, preview: PreviewAdapter }}
 */
function getRuntime() {
    if (_runtime) return _runtime;

    switch (PROVIDER) {
        case 'local':
            _runtime = {
                provider: new LocalRuntimeProvider(),
                exec: new LocalExecAdapter(),
                fs: new LocalFsAdapter(),
                preview: new LocalPreviewAdapter(),
            };
            break;
        case 'boxlite':
            _runtime = {
                provider: new BoxLiteRuntimeProvider(),
                exec: new BoxLiteExecAdapter(),
                fs: new BoxLiteFsAdapter(),
                preview: new BoxLitePreviewAdapter(),
            };
            break;
        case 'blaxel':
            _runtime = {
                provider: new BlaxelRuntimeProvider(),
                exec: new BlaxelExecAdapter(),
                fs: new BlaxelFsAdapter(),
                preview: new BlaxelPreviewAdapter(),
            };
            break;
        case 'k8s':
            _runtime = {
                provider: new K8sRuntimeProvider(),
                exec: new K8sExecAdapter(),
                fs: new K8sFsAdapter(),
                preview: new K8sPreviewAdapter(),
            };
            break;
        default:
            throw new Error(`Unknown RUNTIME_PROVIDER: "${PROVIDER}". Supported: local, boxlite, blaxel, k8s`);
    }

    return _runtime;
}

module.exports = { getRuntime };
