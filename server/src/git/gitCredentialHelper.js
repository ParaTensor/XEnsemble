const fs = require('fs');
const os = require('os');
const path = require('path');

// Per-process cache of askpass scripts keyed by host directory.
// The script body is token-independent (token is passed via GIT_ASKPASS_TOKEN env),
// so a single script per directory can be reused across all git calls in this process.
const askpassCache = new Map();

// Clean up cached scripts on process exit.
process.on('exit', () => {
    for (const scriptPath of askpassCache.values()) {
        try { fs.unlinkSync(scriptPath); } catch { /* best-effort */ }
    }
});

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
 * Get or create a cached GIT_ASKPASS helper script for the given directory.
 * The script body is identical regardless of token (token passed via env),
 * so the script is created once per directory and reused.
 *
 * @param {string} [dir] - directory to write the script into (defaults to os.tmpdir())
 * @returns {string} absolute path to the helper script
 */
function getOrCreateAskpassScript(dir) {
    const targetDir = dir || os.tmpdir();
    const cached = askpassCache.get(targetDir);
    if (cached && fs.existsSync(cached)) {
        return cached;
    }
    const scriptPath = path.join(targetDir, `git-askpass-${process.pid}.sh`);
    const content = `#!/bin/sh\nprintf '%s\\n' "$GIT_ASKPASS_TOKEN"\n`;
    fs.writeFileSync(scriptPath, content, { mode: 0o700 });
    askpassCache.set(targetDir, scriptPath);
    return scriptPath;
}

/**
 * Create a temporary GIT_ASKPASS helper script that prints the supplied token.
 * The actual token is passed through the environment variable
 * GIT_ASKPASS_TOKEN so it is never interpolated into the script body.
 *
 * Note: This low-level function always creates a fresh script. For cached
 * (reusable) scripts, use getOrCreateAskpassScript / buildCredentialEnv.
 *
 * @param {string} token
 * @returns {string} absolute path to the helper script
 */
function createAskpassScript(token) {
    const scriptPath = path.join(
        os.tmpdir(),
        `git-askpass-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
    );
    const content = `#!/bin/sh\nprintf '%s\\n' "$GIT_ASKPASS_TOKEN"\n`;
    fs.writeFileSync(scriptPath, content, { mode: 0o700 });
    return scriptPath;
}

/**
 * Delete a temporary GIT_ASKPASS helper script. Failures are swallowed because
 * the script lives in a temp directory.
 *
 * Note: This only removes scripts NOT in the cache (i.e. scripts created via
 * createAskpassScript). Cached scripts are cleaned up on process exit.
 *
 * @param {string} scriptPath
 */
function removeAskpassScript(scriptPath) {
    // Don't remove cached scripts; they are reused across calls.
    for (const cachedPath of askpassCache.values()) {
        if (cachedPath === scriptPath) return;
    }
    try {
        fs.unlinkSync(scriptPath);
    } catch {
        // Best-effort cleanup.
    }
}

/**
 * Build an environment object that makes git use a cached GIT_ASKPASS
 * helper. Returns the env object and a no-op cleanup function (the
 * cached script is reused across calls and cleaned up on process exit).
 *
 * @param {string} token
 * @returns {{ env: { GIT_ASKPASS: string, GIT_ASKPASS_TOKEN: string }, cleanup: () => void }}
 */
function buildCredentialEnv(token) {
    const scriptPath = getOrCreateAskpassScript();
    return {
        env: {
            GIT_ASKPASS: scriptPath,
            GIT_ASKPASS_TOKEN: token,
        },
        cleanup: () => { /* cached script, reused across calls */ },
    };
}

module.exports = {
    stripCredentialFromUrl,
    createAskpassScript,
    removeAskpassScript,
    buildCredentialEnv,
    getOrCreateAskpassScript,
};
