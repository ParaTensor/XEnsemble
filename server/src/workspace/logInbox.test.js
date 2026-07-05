const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendInboxLog, serverLogPath } = require('./logInbox');

describe('logInbox', () => {
    let tmpDir;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-inbox-'));
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('appends tagged lines to server.log', () => {
        appendInboxLog(tmpDir, 'preview', 'stdout: hello');
        appendInboxLog(tmpDir, 'browser', 'log: clicked');
        const content = fs.readFileSync(serverLogPath(tmpDir), 'utf8');
        assert.match(content, /\[preview\] stdout: hello/);
        assert.match(content, /\[browser\] log: clicked/);
    });
});
