function maskApiKey(key) {
    const s = String(key || '').trim();
    if (!s) return '';
    if (s.length <= 8) {
        if (s.length <= 4) return '*'.repeat(s.length);
        const head = s.slice(0, 2);
        const tail = s.slice(-2);
        return `${head}${'*'.repeat(s.length - 4)}${tail}`;
    }
    const head = s.slice(0, 4);
    const tail = s.slice(-4);
    return `${head}${'*'.repeat(s.length - 8)}${tail}`;
}

module.exports = { maskApiKey };
