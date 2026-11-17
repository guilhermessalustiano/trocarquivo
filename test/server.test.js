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
        response.on('finish', () => {
            const body = response.statusCode === 204 ? null : Buffer.concat(received);
            resolve(new Response(body, { status: response.statusCode, headers }));
        });
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

test('rejects invalid paths, hidden files and unsupported methods', async t => {
    const { url } = await fixture(t);
    for (const name of ['../secret', 'folder/file', 'folder\\file', '.hidden', 'a\nfile', 'a'.repeat(181)]) {
        assert.equal((await upload(url, name, 'data')).status, 400);
    }
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

test('renames files on disk and deletes only the selected file', async t => {
    const { url, directory } = await fixture(t);
    const { file } = await (await upload(url, 'original.txt', 'first file')).json();
    const newName = 'relatório + revisão.txt';
    await fs.writeFile(path.join(directory, newName), 'existing file');

    const response = await fetch(`${url}${file.downloadUrl}?${new URLSearchParams({ name: newName })}`, { method: 'PATCH' });
    assert.equal(response.status, 200);
    const { file: renamed } = await response.json();
    assert.equal(renamed.name, newName);
    assert.equal(renamed.uploadedAt, file.uploadedAt);
    assert.equal(await fs.readFile(path.join(directory, renamed.id), 'utf8'), 'first file');
    assert.equal((await fetch(`${url}${file.downloadUrl}`)).status, 404);
    const download = await fetch(`${url}${renamed.downloadUrl}`);
    assert.equal(await download.text(), 'first file');
    assert.ok(download.headers.get('content-disposition').endsWith(encodeURIComponent(newName)));

    assert.equal((await fetch(`${url}${renamed.downloadUrl}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${url}${renamed.downloadUrl}`)).status, 404);
    assert.deepEqual(await fs.readdir(directory), [newName]);
    const manualRename = await fetch(`${url}/api/files/${encodeURIComponent(newName)}?name=manual.txt`, { method: 'PATCH' });
    assert.equal(manualRename.status, 200);
    const { file: manual } = await manualRename.json();
    assert.equal(manual.name, 'manual.txt');
    assert.equal(await fs.readFile(path.join(directory, manual.id), 'utf8'), 'existing file');
    const { files } = await (await fetch(`${url}/api/files`)).json();
    assert.deepEqual(files, [manual]);
});

test('rejects rename and delete for invalid paths, hidden files and directories', async t => {
    const { url, directory } = await fixture(t);
    await fs.mkdir(path.join(directory, 'folder'));
    await fs.writeFile(path.join(directory, '.hidden'), 'hidden');
    const { file } = await (await upload(url, 'file.txt', 'original')).json();

    for (const id of ['..%2Fsecret.txt', '.hidden', 'folder']) {
        const expected = id === 'folder' ? 404 : 400;
        assert.equal((await fetch(`${url}/api/files/${id}?name=new.txt`, { method: 'PATCH' })).status, expected);
        assert.equal((await fetch(`${url}/api/files/${id}`, { method: 'DELETE' })).status, expected);
    }
    const response = await fetch(`${url}${file.downloadUrl}?name=..%2Fsecret.txt`, { method: 'PATCH' });
    assert.equal(response.status, 400);
    assert.equal(await fs.readFile(path.join(directory, file.id), 'utf8'), 'original');
});

test('ignores symbolic links in all file operations', async t => {
    const { url, directory, root } = await fixture(t);
    const secret = path.join(root, 'secret.txt');
    const link = path.join(directory, 'link.txt');
    await fs.writeFile(secret, 'private');
    try {
        await fs.symlink(secret, link, 'file');
    } catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
        return t.skip('Windows requires Developer Mode or symlink privileges');
    }

    assert.deepEqual(await (await fetch(`${url}/api/files`)).json(), { files: [] });
    for (const method of ['GET', 'PATCH', 'DELETE']) {
        assert.equal((await fetch(`${url}/api/files/link.txt?name=new.txt`, { method })).status, 404);
    }
    assert.equal(await fs.readFile(secret, 'utf8'), 'private');
    assert.equal(await fs.readlink(link), secret);
});

test('rejects Windows file names that resolve to streams, devices or aliases', {
    skip: process.platform !== 'win32'
}, async t => {
    const { url, directory } = await fixture(t);
    const { file } = await (await upload(url, 'arquivo.txt', 'original')).json();
    for (const name of ['arquivo.txt:fluxo', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b',
        'NUL.txt', 'com¹.txt', 'LPT9 .txt', 'CONIN$', 'arquivo.txt.', 'arquivo.txt ']) {
        const query = new URLSearchParams({ name });
        assert.equal((await upload(url, name, 'data')).status, 400, name);
        assert.equal((await fetch(`${url}${file.downloadUrl}?${query}`, { method: 'PATCH' })).status, 400, name);
    }

    for (const id of [`${file.id}:fluxo`, `${file.id}.`, `${file.id} `, 'NUL.txt']) {
        const fileUrl = `${url}/api/files/${encodeURIComponent(id)}?name=new.txt`;
        for (const method of ['GET', 'PATCH', 'DELETE']) {
            assert.equal((await fetch(fileUrl, { method })).status, 400, id);
        }
    }
    assert.deepEqual(await fs.readdir(directory), [file.id]);
    assert.equal(await fs.readFile(path.join(directory, file.id), 'utf8'), 'original');
});
