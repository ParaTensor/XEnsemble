const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const NODE_ENV = process.env.NODE_ENV || 'development';

// ─── Production secret guard ───
const JWT_SECRET = process.env.JWT_SECRET;
if (NODE_ENV === 'production' && (!JWT_SECRET || JWT_SECRET.length < 32)) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-jwt-secret-do-not-use-in-production';

function resolveEncryptionKey() {
    const raw = process.env.ENCRYPTION_KEY?.trim();
    if (NODE_ENV === 'production' && !raw) {
        throw new Error('ENCRYPTION_KEY must be set in production');
    }
    if (!raw) return crypto.scryptSync('emdash-vault-password', 'salt', 32);
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    return crypto.scryptSync(raw, 'xensemble-vault', 32);
}

const ENCRYPTION_KEY = resolveEncryptionKey();

// ─── Password hashing (upgrade path) ───
const PBKDF2_ITERATIONS = 210_000;

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
    return `pbkdf2_sha512$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash) return false;
    // Legacy format: salt:hash (1000 iterations)
    if (!storedHash.includes('$')) {
        const [salt, hash] = storedHash.split(':');
        if (!salt || !hash) return false;
        const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return hash === verifyHash;
    }
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha512') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const hash = parts[3];
    const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

function needsRehash(storedHash) {
    return !storedHash || !storedHash.startsWith(`pbkdf2_sha512$${PBKDF2_ITERATIONS}$`);
}

// ─── Access tokens ───
function generateAccessToken(user) {
    return jwt.sign({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status || 'active',
    }, EFFECTIVE_JWT_SECRET, { expiresIn: '15m' });
}

function verifyAccessToken(token) {
    try {
        return jwt.verify(token, EFFECTIVE_JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// ─── Refresh tokens ───
function generateRefreshTokenValue() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Simple AES-256-GCM encryption for Secrets
function encryptSecrets(secretsObj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(JSON.stringify(secretsObj), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptSecrets(encryptedStr) {
    if (!encryptedStr) return {};
    const [ivHex, authTagHex, encryptedData] = encryptedStr.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

module.exports = {
    hashPassword,
    verifyPassword,
    needsRehash,
    generateAccessToken,
    verifyAccessToken,
    generateRefreshTokenValue,
    hashToken,
    encryptSecrets,
    decryptSecrets,
};
