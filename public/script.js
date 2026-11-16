const mode = document.getElementById('mode');
const input = document.getElementById('files');
const dropzone = document.getElementById('dropzone');
const list = document.getElementById('file-list');
const fileStatus = document.getElementById('file-status');
const status = document.getElementById('status');
const choose = document.getElementById('choose');
const maxFileSize = 50 * 1024 * 1024;
let uploading = false;
let listRequest = 0;
const actionIcons = {
    Baixar: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
    Renomear: 'm14 6 4 4M4 20l4.5-1 12-12a1.4 1.4 0 0 0 0-2l-1.5-1.5a1.4 1.4 0 0 0-2 0l-12 12L4 20Z',
    Excluir: 'M3 6h18M9 6V3h6v3M5 6l1 14h12l1-14M10 10v6m4-6v6'
};

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

function setFileAction(action, label, fileName) {
    action.className = 'file-action';
    action.title = label;
    action.setAttribute('aria-label', `${label} ${fileName}`);
    action.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="${actionIcons[label]}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

async function updateFile(url, method, actions, successMessage) {
    const buttons = actions.querySelectorAll('button');
    for (const button of buttons) button.disabled = true;
    fileStatus.textContent = '';
    try {
        const response = await fetch(url, { method });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Não foi possível atualizar o arquivo.');
        }
        fileStatus.textContent = successMessage;
        await loadFiles();
    } catch (error) {
        fileStatus.textContent = error.message;
    } finally {
        for (const button of buttons) button.disabled = false;
    }
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
            const actions = document.createElement('div');
            actions.className = 'file-actions';
            const link = document.createElement('a');
            setFileAction(link, 'Baixar', file.name);
            link.href = file.downloadUrl;
            link.download = file.name;

            const rename = document.createElement('button');
            rename.type = 'button';
            setFileAction(rename, 'Renomear', file.name);
            rename.addEventListener('click', () => {
                const newName = window.prompt('Novo nome do arquivo', file.name);
                if (newName === null || newName === file.name) return;
                const query = new URLSearchParams({ name: newName });
                updateFile(`${file.downloadUrl}?${query}`, 'PATCH', actions, 'Arquivo renomeado.');
            });

            const remove = document.createElement('button');
            remove.type = 'button';
            setFileAction(remove, 'Excluir', file.name);
            remove.classList.add('file-action-delete');
            remove.addEventListener('click', () => {
                if (!window.confirm(`Excluir “${file.name}” da pasta de uploads?`)) return;
                updateFile(file.downloadUrl, 'DELETE', actions, 'Arquivo excluído.');
            });

            info.append(name, size);
            actions.append(link, rename, remove);
            row.append(info, actions);
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
