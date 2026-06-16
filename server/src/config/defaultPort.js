/** Default control-plane listen port (3000 is often taken by other dev tools). */
const DEFAULT_PORT = 3888;

function resolvePort() {
    const fromEnv = Number(process.env.PORT);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT;
}

module.exports = { DEFAULT_PORT, resolvePort };
