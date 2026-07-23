const sseClients = new Set();

function addSseClient(res) {
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
}

function broadcastSse(event) {
    if (sseClients.size === 0) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(data);
        } catch (_) {
            sseClients.delete(res);
        }
    }
}

module.exports = { addSseClient, broadcastSse };