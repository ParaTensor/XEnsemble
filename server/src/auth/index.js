const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-emdash-key-for-mvp';

function resolveEncryptionKey() {
    const raw = process.env.ENCRYPTION_KEY?.trim();
    if (!raw) return crypto.scryptSync('emdash-vault-password', 'salt', 32);
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    return crypto.scryptSync(raw, 'xensemble-vault', 32);
}

const ENCRYPTION_KEY = resolveEncryptionKey();

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

function generateToken(user) {
    return jwt.sign({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status || 'active',
    }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
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
    generateToken,
    verifyToken,
    encryptSecrets,
    decryptSecrets
};
