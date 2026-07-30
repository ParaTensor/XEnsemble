/**
 * Patches @guizmo-ai/zai-cli to auto-save the session on SIGTERM.
 *
 * Problem: zai's SIGTERM handler (dist/index.js) restores the terminal and exits
 * immediately without saving the chat history.  When XEnsemble hibernates a
 * session the agent process receives SIGTERM, the conversation is lost, and
 * resolveResumeArgs can find no session files to load.
 *
 * Fix:
 *  1. Expose `chatHistory` and `agent` on `global` from use-input-handler.js
 *     (the hook re-runs on every React render, so the global stays in sync).
 *  2. In the SIGTERM handler, call sessionManager.saveSession() with the
 *     exposed chat history before exiting.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = execSync('npm root -g').toString().trim();
const dir = path.join(root, '@guizmo-ai/zai-cli/dist');

// --- Patch 1: expose chatHistory + agent globally ---------------------------
const handlerPath = path.join(dir, 'hooks', 'use-input-handler.js');
let handler = fs.readFileSync(handlerPath, 'utf8');

if (!handler.includes('__zaiChatHistory')) {
    // Insert AFTER the function signature's opening brace, BEFORE the first useState.
    // The original line looks like:
    //   export function useInputHandler({ agent, chatHistory, ... }) {
    //       const [showCommandSuggestions, ...
    const needle = '}) {\n    const [showCommandSuggestions';
    const replacement = '}) {\n    if (typeof global !== "undefined") { global.__zaiChatHistory = chatHistory; global.__zaiAgent = agent; }\n    const [showCommandSuggestions';
    handler = handler.replace(needle, replacement);
    fs.writeFileSync(handlerPath, handler);
    console.log('[patch-zai] Patched use-input-handler.js: global chatHistory exposure');
} else {
    console.log('[patch-zai] use-input-handler.js already patched');
}

// --- Patch 2: auto-save on SIGTERM ------------------------------------------
const indexPath = path.join(dir, 'index.js');
let index = fs.readFileSync(indexPath, 'utf8');

if (!index.includes('__zaiChatHistory')) {
    // index.js is ESM ("type": "module") - require() is NOT available.
    // getSessionManager is already imported at top level (line 18), so the
    // SIGTERM closure has direct access to it.
    const needle = 'console.log("\\nGracefully shutting down...");';
    const autosaveCode = [
        'console.log("\\nGracefully shutting down...");',
        '    try { if (global.__zaiChatHistory && global.__zaiChatHistory.length > 0) {',
        '        const sm = getSessionManager();',
        '        sm.saveSession("autosave-"+new Date().toISOString(), global.__zaiChatHistory,',
        '            { workingDirectory: global.__zaiAgent?.getCurrentDirectory(), model: global.__zaiAgent?.getCurrentModel() },',
        '            "Auto-saved on exit");',
        '    } } catch(e) {}',
    ].join('\n');
    index = index.replace(needle, autosaveCode);
    fs.writeFileSync(indexPath, index);
    console.log('[patch-zai] Patched index.js: auto-save on SIGTERM');
} else {
    console.log('[patch-zai] index.js already patched');
}
