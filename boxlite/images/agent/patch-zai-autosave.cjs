/**
 * Patches @guizmo-ai/zai-cli to:
 * 1. Auto-save the session on SIGTERM (so resolveResumeArgs can find it).
 * 2. Restore agent.messages from sessionData when load-session is used
 *    (so the LLM has conversation context, not just the UI display).
 *
 * Problem: zai's SIGTERM handler exits without saving. load-session restores
 * the UI chatHistory but creates a fresh ZaiAgent with empty this.messages,
 * so the LLM has no context of previous conversation.
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
    const needle = '}) {\n    const [showCommandSuggestions';
    const replacement = '}) {\n    if (typeof global !== "undefined") { global.__zaiChatHistory = chatHistory; global.__zaiAgent = agent; }\n    const [showCommandSuggestions';
    handler = handler.replace(needle, replacement);
    fs.writeFileSync(handlerPath, handler);
    console.log('[patch-zai] Patched use-input-handler.js: global chatHistory exposure');
} else {
    console.log('[patch-zai] use-input-handler.js already patched');
}

// --- Patch 2: auto-save on SIGTERM + restore messages on load-session -------
const indexPath = path.join(dir, 'index.js');
let index = fs.readFileSync(indexPath, 'utf8');

if (!index.includes('__zaiChatHistory')) {
    // Patch 2a: auto-save on SIGTERM
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
    console.log('[patch-zai] Patched index.js: auto-save on SIGTERM');

    // Patch 2b: restore agent.messages from sessionData in load-session
    // The original code creates a fresh ZaiAgent and passes initialSession to
    // ChatInterface, but agent.messages stays empty (only has constructor defaults).
    // We inject code to convert chatHistory entries to OpenAI message format and
    // push them into agent.messages before rendering.
    const loadNeedle = '// Start interactive mode with loaded session\n    const agent = new ZaiAgent(apiKey, baseURL, sessionData.context.model);\n    render(React.createElement(ChatInterface, {';
    const loadReplacement = [
        '// Start interactive mode with loaded session',
        '    const agent = new ZaiAgent(apiKey, baseURL, sessionData.context.model);',
        '    // Restore agent.messages from saved chatHistory so the LLM has context',
        '    if (sessionData.chatHistory && sessionData.chatHistory.length > 0) {',
        '        for (const entry of sessionData.chatHistory) {',
        '            if (entry.type === "user" && entry.content) {',
        '                agent.messages.push({ role: "user", content: entry.content });',
        '            } else if (entry.type === "assistant" && entry.content) {',
        '                agent.messages.push({ role: "assistant", content: entry.content });',
        '            }',
        '        }',
        '        agent.chatHistory = [...sessionData.chatHistory];',
        '    }',
        '    render(React.createElement(ChatInterface, {',
    ].join('\n');
    index = index.replace(loadNeedle, loadReplacement);
    console.log('[patch-zai] Patched index.js: restore agent.messages on load-session');

    fs.writeFileSync(indexPath, index);
} else {
    console.log('[patch-zai] index.js already patched');
}
