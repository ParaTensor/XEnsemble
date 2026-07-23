const path = require('path');

/**
 * Pre-approve a custom API key in claude-code's .claude.json so that
 * claude does not show the "Detected a custom API key" confirmation
 * prompt on startup.  Without this, --continue is blocked because
 * claude waits for user input on the confirmation screen.
 */
async function ensureClaudeApiKeyApproved({ runtime, runtimeRef, stateDirPath, apiKey }) {
    if (!stateDirPath || !apiKey) return;
    const configPath = path.join(stateDirPath, '.claude.json');

    // Read current .claude.json via VM exec
    const readScript = `cat '${configPath}' 2>/dev/null || echo '{}'`;
    const readResult = await runtime.exec.exec(
        'sh', ['-c', readScript], {}, { runtimeRef, cwd: '/' },
    );
    let config;
    try {
        config = JSON.parse(readResult.stdout || '{}');
    } catch {
        config = {};
    }

    // Check if already approved
    const approved = config.customApiKeyResponses?.approved || [];
    if (approved.includes(apiKey)) return;

    // Add to approved list
    if (!config.customApiKeyResponses) {
        config.customApiKeyResponses = { approved: [], rejected: [] };
    }
    if (!Array.isArray(config.customApiKeyResponses.approved)) {
        config.customApiKeyResponses.approved = [];
    }
    if (!config.customApiKeyResponses.approved.includes(apiKey)) {
        config.customApiKeyResponses.approved.push(apiKey);
    }

    // Write back
    const jsonStr = JSON.stringify(config).replace(/'/g, "'\\''");
    const writeScript = `cat > '${configPath}' << 'CLAUDE_JSON_EOF'
${JSON.stringify(config, null, 2)}
CLAUDE_JSON_EOF`;
    await runtime.exec.exec(
        'sh', ['-c', writeScript], {}, { runtimeRef, cwd: '/' },
    );
}

module.exports = { ensureClaudeApiKeyApproved };
