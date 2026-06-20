const { FsAdapter, RuntimeError } = require('./interfaces');

/**
 * BoxLite FsAdapter stub.
 *
 * Phase 2 / future development: will access workspace files through the BoxLite
 * sandbox file API without exposing sandbox internal paths or sandbox ids.
 */
class BoxLiteFsAdapter extends FsAdapter {
    async fsList(/* rootDir, relativePath */) {
        throw new RuntimeError('BoxLite FsAdapter is not implemented in this phase.', 501);
    }

    async fsRead(/* rootDir, relativePath */) {
        throw new RuntimeError('BoxLite FsAdapter is not implemented in this phase.', 501);
    }
}

module.exports = BoxLiteFsAdapter;
