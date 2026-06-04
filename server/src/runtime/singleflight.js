/**
 * 按 key 合并并发中的异步操作（Architecture.md 3.1 provision 单飞）。
 */
const inflight = new Map();

function singleflight(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const promise = Promise.resolve().then(fn).finally(() => {
        inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
}

module.exports = { singleflight };
