const http = require('http');
const assert = require('assert');

async function request(path, method = 'GET', body = null, token = null) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: '127.0.0.1',
            port: process.env.PORT || 3000,
            path,
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (token) opts.headers.Authorization = `Bearer ${token}`;
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function main() {
    // register
    const reg = await request('/api/v1/auth/register', 'POST', {
        username: `smoke_${Date.now()}`,
        password: 'SmokePass123!',
        device_name: 'smoke-test',
    });
    assert.strictEqual(reg.status, 200, `register failed: ${JSON.stringify(reg.body)}`);
    assert.ok(reg.body.access_token, 'access_token missing');
    assert.ok(reg.body.refresh_token, 'refresh_token missing');

    // refresh
    const refresh = await request('/api/v1/auth/refresh', 'POST', {
        refresh_token: reg.body.refresh_token,
    });
    assert.strictEqual(refresh.status, 200, `refresh failed: ${JSON.stringify(refresh.body)}`);
    assert.ok(refresh.body.access_token, 'new access_token missing');

    // me
    const me = await request('/api/v1/auth/me', 'GET', null, reg.body.access_token);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.username, reg.body.user.username);

    console.log('smoke ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
