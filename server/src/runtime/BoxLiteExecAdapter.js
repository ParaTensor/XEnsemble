const { ExecAdapter, RuntimeError } = require('./interfaces');

/**
 * BoxLite ExecAdapter stub.
 *
 * Phase 2 / future development: will execute Agent commands inside a BoxLite
 * sandbox, supporting interactive PTY or equivalent stdin/stdout/resize/stream.
 */
class BoxLiteExecAdapter extends ExecAdapter {
    spawn(/* cmd, args, env, options */) {
        throw new RuntimeError('BoxLite ExecAdapter is not implemented in this phase.', 501);
    }

    async exec(/* cmd, args, env, options */) {
        throw new RuntimeError('BoxLite ExecAdapter is not implemented in this phase.', 501);
    }
}

module.exports = BoxLiteExecAdapter;
