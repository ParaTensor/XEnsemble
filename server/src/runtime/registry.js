/**
 * Runtime Provider 工厂 — 根据 RUNTIME_PROVIDER 环境变量选择实现。
 * 对齐 Architecture.md 3 节。
 */
const LocalRuntimeProvider = require('./LocalRuntimeProvider');
const LocalExecAdapter = require('./LocalExecAdapter');
const LocalFsAdapter = require('./LocalFsAdapter');
const LocalPreviewAdapter = require('./LocalPreviewAdapter');

const PROVIDER = process.env.RUNTIME_PROVIDER || 'local';

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
        default:
            throw new Error(`Unknown RUNTIME_PROVIDER: "${PROVIDER}". Supported: local`);
    }

    return _runtime;
}

module.exports = { getRuntime };
