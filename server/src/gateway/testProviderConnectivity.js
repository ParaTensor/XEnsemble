function buildChatCompletionsUrl(baseUrl) {
    const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
}

function authFailureMessage(status, detail) {
    if (status === 401 || status === 403) {
        return detail ? `Invalid API Key: ${detail}` : 'Invalid API Key.';
    }
    return detail
        ? `Provider returned ${status}: ${detail}`
        : `Provider returned ${status}.`;
}

function extractChatContent(body) {
    const message = body?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') return '';
    return String(
        message.content
        || message.reasoning_content
        || message.text
        || '',
    ).trim();
}

function resolveModel({ model, default_model, models }) {
    const direct = String(model || default_model || '').trim();
    if (direct) return direct;
    if (Array.isArray(models)) {
        const first = models.map((m) => String(m || '').trim()).find(Boolean);
        if (first) return first;
    }
    return '';
}

async function testProviderConnectivity({ base_url, api_key, model, default_model, models }) {
    const baseUrl = String(base_url || '').trim();
    const apiKey = String(api_key || '').trim();
    const modelName = resolveModel({ model, default_model, models });
    const started = Date.now();
    const latencyMs = () => Date.now() - started;

    if (!baseUrl) {
        const err = new Error('Base URL is required.');
        err.statusCode = 400;
        throw err;
    }
    if (!apiKey) {
        const err = new Error('API Key is required to verify provider availability.');
        err.statusCode = 400;
        throw err;
    }
    if (!modelName) {
        const err = new Error('Default model is required to verify provider.');
        err.statusCode = 400;
        throw err;
    }

    const chatUrl = buildChatCompletionsUrl(baseUrl);
    if (!chatUrl) {
        const err = new Error('Invalid Base URL.');
        err.statusCode = 400;
        throw err;
    }

    let response;
    try {
        response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
                max_tokens: 32,
                temperature: 0,
            }),
            signal: AbortSignal.timeout(30000),
        });
    } catch (err) {
        const message = err.name === 'TimeoutError'
            ? 'Request timed out.'
            : `Failed to reach provider: ${err.message}`;
        return {
            ok: false,
            latency_ms: latencyMs(),
            message,
        };
    }

    let body;
    const raw = await response.text();
    try {
        body = raw ? JSON.parse(raw) : null;
    } catch {
        body = null;
    }

    if (!response.ok) {
        const detail = body?.error?.message || body?.message || body?.error || raw?.slice(0, 200);
        return {
            ok: false,
            status: response.status,
            latency_ms: latencyMs(),
            message: authFailureMessage(response.status, detail),
        };
    }

    const content = extractChatContent(body);
    if (!content) {
        return {
            ok: false,
            status: response.status,
            latency_ms: latencyMs(),
            message: 'Provider returned an empty response. Check API Key and model.',
        };
    }

    return {
        ok: true,
        status: response.status,
        latency_ms: latencyMs(),
        model: modelName,
        message: `Available · ${latencyMs()}ms`,
    };
}

module.exports = { testProviderConnectivity, buildChatCompletionsUrl, resolveModel };
