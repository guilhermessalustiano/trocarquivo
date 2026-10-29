const mode = document.getElementById('mode');
const input = document.getElementById('files');
const dropzone = document.getElementById('dropzone');
const list = document.getElementById('file-list');
const status = document.getElementById('status');
const choose = document.getElementById('choose');
const maxFileSize = 50 * 1024 * 1024;
let uploading = false;
let listRequest = 0;

mode.addEventListener('change', () => {
    document.getElementById('upload-panel').hidden = mode.checked;
    document.getElementById('download-panel').hidden = !mode.checked;
    if (mode.checked) loadFiles();
});
choose.addEventListener('click', () => input.click());

function showListMessage(message) {
    const text = document.createElement('p');
    text.className = 'empty';
    text.textContent = message;
    list.replaceChildren(text);
}

async function loadFiles() {
    const currentRequest = ++listRequest;
    list.setAttribute('aria-busy', 'true');
    showListMessage('Carregando arquivos…');
    try {
        const response = await fetch('/api/files');
        if (!response.ok) throw new Error('Não foi possível listar os arquivos.');
        const { files } = await response.json();
        if (currentRequest !== listRequest) return;
        list.replaceChildren();
        if (!files.length) showListMessage('Nenhum arquivo por aqui ainda. Selecione Upload para adicionar.');
        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'file';
            const info = document.createElement('div');
            info.className = 'file-info';
            const name = document.createElement('strong');
            name.className = 'file-name';
            name.textContent = file.name;
            const size = document.createElement('span');
            size.className = 'file-size';
            size.textContent = file.size < 1024 * 1024
                ? `${(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`
                : `${(file.size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
            const link = document.createElement('a');
            link.className = 'download';
            link.href = file.downloadUrl;
            link.download = file.name;
            link.textContent = 'Baixar';
            link.setAttribute('aria-label', `Baixar ${file.name}`);
            info.append(name, size);
            row.append(info, link);
            list.append(row);
        }
    } catch {
        if (currentRequest !== listRequest) return;
        showListMessage('Não foi possível carregar os arquivos.');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Tentar novamente';
        retry.addEventListener('click', loadFiles);
        list.append(retry);
    } finally {
        if (currentRequest === listRequest) list.setAttribute('aria-busy', 'false');
    }
}

async function uploadFiles(files) {
    if (!files.length || uploading) return;
    uploading = true;
    choose.disabled = true;
    dropzone.setAttribute('aria-busy', 'true');
    const failures = [];
    let sent = 0;
    try {
        for (const file of files) {
            status.textContent = `Enviando ${file.name}…`;
            try {
                if (file.size > maxFileSize) throw new Error('O limite é de 50 MB por arquivo.');
                const response = await fetch(`/api/files?name=${encodeURIComponent(file.name)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Falha no envio.');
                sent++;
            } catch (error) {
                failures.push(`${file.name}: ${error.message}`);
            }
        }
        status.textContent = `${sent} arquivo(s) salvo(s). ${failures.length ? failures.join(' ') : 'Selecione Download para baixar.'}`;
        await loadFiles();
    } finally {
        uploading = false;
        choose.disabled = false;
        dropzone.setAttribute('aria-busy', 'false');
    }
}

input.addEventListener('change', () => {
    const files = Array.from(input.files);
    input.value = '';
    uploadFiles(files);
});
for (const event of ['dragenter', 'dragover']) {
    dropzone.addEventListener(event, e => {
        e.preventDefault();
        if (!uploading) dropzone.classList.add('dragging');
    });
}
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    uploadFiles(Array.from(e.dataTransfer.files));
});
loadFiles();
