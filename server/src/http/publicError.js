/**
 * 将 Drizzle/PostgreSQL 原始错误转为对用户安全的文案，避免泄露 SQL。
 */

function errorDetail(err) {
    if (!err) return '';
    const parts = [err.message, err.cause?.message, err.cause?.code].filter(Boolean);
    return parts.join(' ');
}

function isDatabaseError(err) {
    if (!err) return false;
    const detail = errorDetail(err);
    if (/Failed query:|DrizzleQueryError|PostgresError|permission denied for (table|schema|database)/i.test(detail)) {
        return true;
    }
    if (err.cause?.code && /^[0-9A-Z]{5}$/.test(String(err.cause.code))) {
        return true;
    }
    return false;
}

function isUniqueViolation(err) {
    const detail = errorDetail(err);
    return /23505|duplicate key|UNIQUE constraint|unique constraint/i.test(detail);
}

function mapPostgresError(err) {
    const code = err?.cause?.code;
    const detail = errorDetail(err);

    if (isUniqueViolation(err)) {
        if (/users_username_unique|username/i.test(detail)) {
            return { statusCode: 400, message: 'Username already exists' };
        }
        return { statusCode: 400, message: 'Record already exists' };
    }

    switch (code) {
        case '23503':
            return { statusCode: 400, message: 'Related record not found' };
        case '23502':
            return { statusCode: 400, message: 'Required field is missing' };
        case '42501':
            return { statusCode: 403, message: 'Operation not permitted' };
        case '42P01':
            return { statusCode: 500, message: 'Database schema is not ready' };
        default:
            return null;
    }
}

/**
 * @param {Error & { statusCode?: number, code?: string }} err
 * @param {string} [fallback='Request failed']
 * @returns {{ statusCode: number, message: string, code?: string }}
 */
function sanitizePublicError(err, fallback = 'Request failed') {
    if (!err) {
        return { statusCode: 500, message: fallback };
    }

    if (isDatabaseError(err)) {
        const mapped = mapPostgresError(err);
        if (mapped) {
            return err.code ? { ...mapped, code: err.code } : mapped;
        }
        return err.code
            ? { statusCode: 500, message: fallback, code: err.code }
            : { statusCode: 500, message: fallback };
    }

    if (err.statusCode) {
        const result = {
            statusCode: err.statusCode,
            message: err.message || fallback,
        };
        if (err.code) result.code = err.code;
        return result;
    }

    return err.code
        ? { statusCode: 500, message: fallback, code: err.code }
        : { statusCode: 500, message: fallback };
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {Error & { statusCode?: number, code?: string }} err
 * @param {string} [fallback='Request failed']
 * @param {number} [defaultCode=500]
 */
function sendPublicError(reply, err, fallback = 'Request failed', defaultCode = 500) {
    const sanitized = sanitizePublicError(err, fallback);
    const statusCode = err.statusCode || sanitized.statusCode || defaultCode;
    const body = { error: sanitized.message };
    if (sanitized.code || err.code) body.code = sanitized.code || err.code;
    return reply.code(statusCode).send(body);
}

module.exports = {
    isDatabaseError,
    isUniqueViolation,
    sanitizePublicError,
    sendPublicError,
};
