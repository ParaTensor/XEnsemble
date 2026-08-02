const DEFAULT_MAX_DIFF_BYTES = Number(process.env.GIT_DIFF_MAX_BYTES) || 1_500_000;
const DEFAULT_MAX_FILE_BYTES = Number(process.env.GIT_DIFF_MAX_FILE_BYTES) || 512_000;

const BINARY_HINT = /[\x00-\x08\x0e-\x1f]/;

function looksBinary(text) {
    if (typeof text !== 'string' || !text) return false;
    if (text.includes('\u0000')) return true;
    // Sample the first 8 KiB for control characters atypical of text.
    const sample = text.slice(0, 8192);
    return BINARY_HINT.test(sample);
}

function truncateText(text, maxBytes) {
    const source = typeof text === 'string' ? text : '';
    if (Buffer.byteLength(source, 'utf8') <= maxBytes) {
        return { text: source, truncated: false, omittedBytes: 0 };
    }
    let end = Math.min(source.length, maxBytes);
    while (end > 0 && Buffer.byteLength(source.slice(0, end), 'utf8') > maxBytes) {
        end = Math.floor(end * 0.9);
    }
    const textOut = source.slice(0, end);
    return {
        text: textOut,
        truncated: true,
        omittedBytes: Buffer.byteLength(source, 'utf8') - Buffer.byteLength(textOut, 'utf8'),
    };
}

function limitDiffText(diff, {
    maxBytes = DEFAULT_MAX_DIFF_BYTES,
} = {}) {
    const binary = looksBinary(diff);
    if (binary) {
        return {
            diff: '',
            truncated: true,
            binary: true,
            omittedBytes: Buffer.byteLength(diff || '', 'utf8'),
            maxBytes,
        };
    }
    const { text, truncated, omittedBytes } = truncateText(diff, maxBytes);
    return {
        diff: truncated
            ? `${text}\n\n[diff truncated: omitted ${omittedBytes} bytes]\n`
            : text,
        truncated,
        binary: false,
        omittedBytes,
        maxBytes,
    };
}

function limitFileSide(content, {
    maxBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
    const binary = looksBinary(content);
    if (binary) {
        return {
            content: '',
            truncated: true,
            binary: true,
            omittedBytes: Buffer.byteLength(content || '', 'utf8'),
            maxBytes,
        };
    }
    const { text, truncated, omittedBytes } = truncateText(content, maxBytes);
    return {
        content: text,
        truncated,
        binary: false,
        omittedBytes,
        maxBytes,
    };
}

module.exports = {
    DEFAULT_MAX_DIFF_BYTES,
    DEFAULT_MAX_FILE_BYTES,
    looksBinary,
    truncateText,
    limitDiffText,
    limitFileSide,
};
