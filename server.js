const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { loadEnvFile } = require('node:process');

try {
    loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}

const publicDirectory = path.join(__dirname, 'public');
const windows = process.platform === 'win32';
const generatedPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}--/i;
const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/script.js', ['script.js', 'text/javascript; charset=utf-8']]
]);

function json(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
}

function fail(status, message) {
    return Object.assign(new Error(message), { status });
}

function validName(name) {
    return typeof name === 'string' && name.length > 0 && !name.startsWith('.')
        && !/[/\\\x00-\x1f\x7f]/.test(name);
}

function validWindowsName(name) {
    return !/[<>:"|?*]|[ .]$/.test(name)
        && !/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³]) *(?:\.|$)/i.test(name);
}

function readFileName(url) {
    const name = url.searchParams.get('name');
    if (!validName(name) || Buffer.byteLength(name) > 180) {
        throw fail(400, 'Nome inválido: use até 180 bytes, sem caminhos ou ponto inicial.');
    }
    if (windows && !validWindowsName(name)) {
        throw fail(400, 'Nome inválido no Windows: evite caracteres e nomes reservados ou ponto ou espaço no final.');
    }
    return name;
}

function describe(id, stat) {
    return {
        id,
        name: id.replace(generatedPrefix, ''),
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
        downloadUrl: `/api/files/${encodeURIComponent(id)}`
    };
}

function createServer({ uploadsDirectory = path.resolve(__dirname, process.env.UPLOADS_DIR || 'uploads'), maxFileSize = 50 * 1024 * 1024 } = {}) {
    const ready = fs.mkdir(uploadsDirectory, { recursive: true });
    return http.createServer(async (request, response) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-store');
        try {
            await ready;
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname === '/api/files' && request.method === 'GET') {
                const entries = await fs.readdir(uploadsDirectory, { withFileTypes: true });
                const files = [];
                for (const entry of entries) {
                    if (!entry.isFile() || entry.name.startsWith('.') || (windows && !validWindowsName(entry.name))) continue;
                    try {
                        const stat = await fs.lstat(path.join(uploadsDirectory, entry.name));
                        if (stat.isFile()) files.push(describe(entry.name, stat));
                    } catch (error) {
                        if (error.code !== 'ENOENT') throw error;
                    }
                }
                files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
                return json(response, 200, { files });
            }
            if (url.pathname === '/api/files' && request.method === 'POST') {
                // Require a non-simple request to prevent cross-origin HTML form uploads.
                if (request.headers['content-type'] !== 'application/octet-stream') {
                    throw fail(415, 'Envie o arquivo como application/octet-stream.');
                }
                const name = readFileName(url);
                if (Number(request.headers['content-length']) > maxFileSize) {
                    throw fail(413, 'O arquivo excede o tamanho permitido.');
                }
                const id = `${randomUUID()}--${name}`;
                const temporary = path.join(uploadsDirectory, `.upload-${randomUUID()}`);
                let handle;
                try {
                    handle = await fs.open(temporary, 'wx', 0o600);
                    let size = 0;
                    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
                        size += chunk.length;
                        if (size > maxFileSize) throw fail(413, 'O arquivo excede o tamanho permitido.');
                        await handle.writeFile(chunk);
                    }
                    await handle.sync();
                    await handle.close();
                    handle = undefined;
                    await fs.rename(temporary, path.join(uploadsDirectory, id));
                    return json(response, 201, { file: describe(id, await fs.stat(path.join(uploadsDirectory, id))) });
                } finally {
                    if (handle) await handle.close();
                    await fs.rm(temporary, { force: true });
                }
            }
            if (url.pathname.startsWith('/api/files/')) {
                if (!['GET', 'PATCH', 'DELETE'].includes(request.method)) {
                    response.setHeader('Allow', 'GET, PATCH, DELETE');
                    throw fail(405, 'Método não permitido.');
                }
                let id;
                try { id = decodeURIComponent(url.pathname.slice('/api/files/'.length)); }
                catch { throw fail(400, 'Identificador inválido.'); }
                if (!validName(id) || (windows && !validWindowsName(id))) throw fail(400, 'Identificador inválido.');
                const filePath = path.join(uploadsDirectory, id);
                if (request.method !== 'GET') {
                    const stat = await fs.lstat(filePath);
                    if (!stat.isFile()) throw fail(404, 'Arquivo não encontrado.');
                    if (request.method === 'DELETE') {
                        await fs.unlink(filePath);
                        response.writeHead(204);
                        return response.end();
                    }

                    const name = readFileName(url);
                    const file = describe(id, stat);
                    if (name === file.name) return json(response, 200, { file });

                    const renamedId = `${randomUUID()}--${name}`;
                    await fs.rename(filePath, path.join(uploadsDirectory, renamedId));
                    return json(response, 200, { file: describe(renamedId, stat) });
                }

                const entry = await fs.lstat(filePath, { bigint: true });
                if (!entry.isFile()) throw fail(404, 'Arquivo não encontrado.');
                const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
                try {
                    // Windows lacks O_NOFOLLOW. Verify that open returned the same file as lstat.
                    const stat = await handle.stat({ bigint: true });
                    if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino) {
                        throw fail(404, 'Arquivo não encontrado.');
                    }
                    const name = id.replace(generatedPrefix, '');
                    const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
                    response.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': stat.size.toString(),
                        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encoded}`
                    });
                    await pipeline(handle.createReadStream({ autoClose: false }), response);
                } finally {
                    await handle.close();
                }
                return;
            }
            if (request.method === 'GET' && staticFiles.has(url.pathname)) {
                const [filename, type] = staticFiles.get(url.pathname);
                const body = await fs.readFile(path.join(publicDirectory, filename));
                response.writeHead(200, { 'Content-Type': type });
                return response.end(body);
            }
            if (url.pathname === '/api/files') {
                response.setHeader('Allow', 'GET, POST');
                throw fail(405, 'Método não permitido.');
            }
            throw fail(404, 'Página não encontrada.');
        } catch (error) {
            if (response.headersSent || response.destroyed) {
                response.destroy();
                return;
            }
            const status = error.status || (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code) ? 404 : 500);
            if (status === 500) console.error(error);
            json(response, status, { error: status === 500 ? 'Erro interno do servidor.' : status === 404 ? 'Arquivo ou página não encontrado.' : error.message });
        } finally {
            // Drain rejected bodies without retaining them in memory.
            if (!request.readableEnded) request.resume();
        }
    });
}

if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    createServer().listen(port, host, () => console.log(`Trocarquivo: http://${host}:${port}`));
}

module.exports = { createServer };
