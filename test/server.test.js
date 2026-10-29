const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

// Exercise the actual HTTP handlers and disk I/O without requiring a listening socket.
const servers = new Map();

async function start(directory, maxFileSize) {
    const server = createServer({ uploadsDirectory: directory, maxFileSize });
    const url = `http://${randomUUID()}.test`;
    servers.set(url, server);
    return { server, url };
}

async function close(server) {
    for (const [url, registered] of servers) {
        if (registered === server) servers.delete(url);
    }
}

async function fetch(address, options = {}) {
    const url = new URL(address);
    const server = servers.get(url.origin);
    assert.ok(server, 'Server instance exists');
    const chunks = options.chunks || (options.body === undefined ? [] : [Buffer.from(options.body)]);
    const request = Readable.from(chunks);
    request.url = url.pathname + url.search;
    request.method = options.method || 'GET';
    request.headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    if (!options.chunks && options.body !== undefined) request.headers['content-length'] = Buffer.byteLength(options.body);
    return new Promise((resolve, reject) => {
        const received = [];
        const headers = {};
        const response = new Writable({ write(chunk, encoding, callback) { received.push(Buffer.from(chunk)); callback(); } });
        response.headersSent = false;
        response.setHeader = (key, value) => { headers[key] = String(value); };
        response.writeHead = (status, extra) => {
            response.statusCode = status;
            Object.assign(headers, extra);
            response.headersSent = true;
        };
        response.on('error', reject);
        response.on('finish', () => resolve(new Response(Buffer.concat(received), { status: response.statusCode, headers })));
        server.emit('request', request, response);
    });
}

async function fixture(t, maxFileSize) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trocarquivo-'));
    const directory = path.join(root, 'uploads');
    const instance = await start(directory, maxFileSize);
    t.after(async () => {
        await close(instance.server);
        await fs.rm(root, { recursive: true, force: true });
    });
    return { ...instance, root, directory };
}

function upload(url, name, body) {
    return fetch(`${url}/api/files?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body
    });
}

test('lists files, persists binary uploads across restart, preserves duplicate names and serves the UI', async t => {
    const { server, url, directory } = await fixture(t);
    assert.deepEqual(await (await fetch(`${url}/api/files`)).json(), { files: [] });
    const content = Buffer.from([0, 255, 12, 35, 78]);
    const first = await upload(url, 'relatório (final).bin', content);
    assert.equal(first.status, 201);
    const { file } = await first.json();
    assert.equal(file.name, 'relatório (final).bin');
    assert.equal(file.size, content.length);
    const duplicate = await upload(url, file.name, 'second file');
    assert.equal(duplicate.status, 201);
    assert.notEqual((await duplicate.json()).file.id, file.id);
    await fs.writeFile(path.join(directory, 'manual.txt'), 'existing file');
    assert.match(await (await fetch(url)).text(), /script.js/);
    assert.equal((await fetch(`${url}/style.css`)).status, 200);
    assert.equal((await fetch(`${url}/script.js`)).status, 200);
    await close(server);
    const restarted = await start(directory);
    t.after(() => close(restarted.server));
    const { files } = await (await fetch(`${restarted.url}/api/files`)).json();
    assert.equal(files.length, 3);
    assert.ok(files.some(item => item.name === 'manual.txt'));
    const download = await fetch(`${restarted.url}${file.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
});

test('rejects invalid paths, hidden files, symbolic links and unsupported methods', async t => {
    const { url, directory, root } = await fixture(t);
    for (const name of ['../secret', 'folder/file', 'folder\\file', '.hidden', 'a\nfile', 'a'.repeat(181)]) {
        assert.equal((await upload(url, name, 'data')).status, 400);
    }
    const secret = path.join(root, 'secret.txt');
    await fs.writeFile(secret, 'private');
    await fs.symlink(secret, path.join(directory, 'link.txt'));
    assert.equal((await fetch(`${url}/api/files/link.txt`)).status, 404);
    assert.equal((await fetch(`${url}/api/files/..%2Fsecret.txt`)).status, 400);
    assert.equal((await fetch(`${url}/api/files/.gitkeep`)).status, 400);
    assert.equal((await fetch(`${url}/server.js`)).status, 404);
    assert.equal((await fetch(`${url}/api/files/missing`)).status, 404);
    assert.equal((await fetch(`${url}/api/files`, { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(`${url}/api/files?name=x`, { method: 'POST', body: 'data' })).status, 415);
    assert.deepEqual(await (await fetch(`${url}/api/files`)).json(), { files: [] });
});

test('enforces size limits on fixed and chunked uploads without keeping incomplete files', async t => {
    const { url, directory } = await fixture(t, 4);
    assert.equal((await upload(url, 'large.txt', '12345')).status, 413);
    const result = await fetch(`${url}/api/files?name=chunked.txt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        chunks: [Buffer.from('123'), Buffer.from('456')]
    });
    assert.equal(result.status, 413);
    assert.match(await result.text(), /excede/);
    assert.deepEqual(await fs.readdir(directory), []);
    assert.equal((await upload(url, 'empty.txt', '')).status, 201);
    assert.equal((await upload(url, 'exact.txt', '1234')).status, 201);
});
