const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Remove embedded credentials from a Git remote URL so the remote is always
 * stored without a token / password.
 *
 * @param {string} url
 * @returns {string}
 */
function stripCredentialFromUrl(url) {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        if (parsed.username || parsed.password) {
            parsed.username = '';
            parsed.password = '';
            // URL#toString keeps the trailing .git path intact.
            return parsed.toString();
        }
    } catch {
        // Not a URL we can parse; return it untouched and let git report errors.
    }
    return url;
}

/**
 * Create a temporary GIT_ASKPASS helper script that prints the supplied token.
 * The actual token is passed through the environment variable
 * GIT_ASKPASS_TOKEN so it is never interpolated into the script body.
 *
 * @param {string} token
 * @returns {string} absolute path to the helper script
 */
function createAskpassScript(token, workspacePath) {
    const dir = workspacePath || os.tmpdir();
    const scriptPath = path.join(
        dir,
        `.git-askpass-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
    );
    const content = `#!/bin/sh\nprintf '%s\\n' "$GIT_ASKPASS_TOKEN"\n`;
    fs.writeFileSync(scriptPath, content, { mode: 0o700 });
    return scriptPath;
}

/**
 * Delete a temporary GIT_ASKPASS helper script. Failures are swallowed because
 * the script lives in a temp directory.
 *
 * @param {string} scriptPath
 */
function removeAskpassScript(scriptPath) {
    try {
        fs.unlinkSync(scriptPath);
    } catch {
        // Best-effort cleanup.
    }
}

/**
 * Build an environment object that makes git use a temporary GIT_ASKPASS
 * helper. Returns the env object and a cleanup function that removes the
 * helper script.
 *
 * @param {string} token
 * @returns {{ env: { GIT_ASKPASS: string, GIT_ASKPASS_TOKEN: string }, cleanup: () => void }}
 */
function buildCredentialEnv(token, workspacePath) {
    const scriptPath = createAskpassScript(token, workspacePath);
    return {
        env: {
            GIT_ASKPASS: scriptPath,
            GIT_ASKPASS_TOKEN: token,
        },
        cleanup: () => removeAskpassScript(scriptPath),
    };
}

module.exports = {
    stripCredentialFromUrl,
    createAskpassScript,
    removeAskpassScript,
    buildCredentialEnv,
};
