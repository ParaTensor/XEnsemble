const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-emdash-key-for-mvp';
const TOKEN_PREFIX = 'xel_';
const TOKEN_TYPE = 'llm_session';
const TOKEN_TTL = '24h';

function issueSessionToken({ sessionId, userId, projectId, agentId, model, role }) {
    const payload = {
        typ: TOKEN_TYPE,
        sid: sessionId,
        uid: userId,
        pid: projectId,
        aid: agentId,
    };
    const trimmedModel = model != null ? String(model).trim() : '';
    if (trimmedModel) payload.model = trimmedModel;
    if (role?.trim()) payload.role = role.trim();

    const signed = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
    return `${TOKEN_PREFIX}${signed}`;
}

function stripTokenPrefix(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith(TOKEN_PREFIX)) return trimmed.slice(TOKEN_PREFIX.length);
    return trimmed;
}

function verifySessionToken(raw) {
    const token = stripTokenPrefix(raw);
    if (!token) return null;
    try {
        const claims = jwt.verify(token, JWT_SECRET);
        if (claims.typ !== TOKEN_TYPE) return null;
        if (!claims.sid || !claims.uid) return null;
        return claims;
    } catch {
        return null;
    }
}

module.exports = {
    TOKEN_PREFIX,
    issueSessionToken,
    verifySessionToken,
};
