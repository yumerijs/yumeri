document.addEventListener('DOMContentLoaded', () => {
    // 元素
    const fileListEl = document.getElementById('file-list');
    const breadcrumbEl = document.getElementById('breadcrumb');
    const editorContainer = document.getElementById('editor-container');
    const editorInfoEl = document.getElementById('editor-info');
    const editorFilenameEl = document.getElementById('editor-filename');
    const saveBtn = document.getElementById('save-btn');
    const downloadBtn = document.getElementById('download-btn');
    const createFolderBtn = document.getElementById('create-folder-btn');
    const createFileBtn = document.getElementById('create-file-btn');
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');

    let currentPath = '.';
    let selectedFile = null;
    let editor;

    // --- Monaco 编辑器初始化 ---
    require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.33.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
        editor = monaco.editor.create(editorContainer, {
            value: '// 请选择一个文件开始编辑',
            language: 'plaintext',
            theme: 'vs-light',
            automaticLayout: true,
            readOnly: true
        });
    });

    // --- 错误处理 ---
    async function handleApiError(response) {
        if (response.ok) return;
        let errorMessage = `HTTP 错误: ${response.status}`;
        try {
            const errorBody = await response.json();
            if (errorBody.message) {
                errorMessage = errorBody.message;
            }
        } catch (e) {
            try {
                const textError = await response.text();
                if (textError) errorMessage = textError;
            } catch (e2) { /* 忽略 */ }
        }
        throw new Error(errorMessage);
    }

    // --- API 调用 ---
    async function fetchFiles(path) {
        try {
            const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`);
            await handleApiError(response);
            const files = await response.json();
            renderFiles(files);
            renderBreadcrumb(path);
            currentPath = path;
        } catch (error) {
            console.error('获取文件列表失败:', error);
            alert(`加载文件失败: ${error.message}`);
        }
    }

    // --- UI 渲染 ---
    function renderFiles(files) {
        fileListEl.innerHTML = '';
        if (currentPath !== '.') {
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
            const parentDir = { name: '..', isDirectory: true, path: parentPath || '.' };
            fileListEl.appendChild(createFileElement(parentDir));
        }

        files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(file => fileListEl.appendChild(createFileElement(file)));
    }

    function createFileElement(file) {
        const li = document.createElement('li');
        li.dataset.path = file.path;
        li.dataset.isDirectory = file.isDirectory;
        li.title = file.name;
        li.innerHTML = `<i class="fas ${file.isDirectory ? 'fa-folder' : 'fa-file-alt'}"></i> <span>${file.name}</span>`;
        
        li.addEventListener('click', () => onFileClick(li, file)); // 直接传 li
        return li;
    }

    function renderBreadcrumb(path) {
        breadcrumbEl.innerHTML = '';
        let current = '.';
        const rootLink = document.createElement('a');
        rootLink.href = '#';
        rootLink.textContent = '根目录';
        rootLink.addEventListener('click', (e) => { e.preventDefault(); fetchFiles('.'); });
        breadcrumbEl.appendChild(rootLink);

        const parts = path.split('/').filter(p => p && p !== '.');
        parts.forEach(part => {
            current += `/${part}`;
            breadcrumbEl.appendChild(document.createTextNode(' / '));
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = part;
            link.dataset.path = current;
            link.addEventListener('click', (e) => { e.preventDefault(); fetchFiles(e.target.dataset.path); });
            breadcrumbEl.appendChild(link);
        });
    }

    // --- 文件点击事件 ---
    async function onFileClick(li, file) {
        if (file.isDirectory) {
            fetchFiles(file.path);
            return;
        }
        try {
            const response = await fetch(`/api/files/read?path=${encodeURIComponent(file.path)}`);
            await handleApiError(response);
            const content = await response.text();

            editor.setValue(content);
            const model = editor.getModel();
            const language = getLanguageForFile(file.name);
            monaco.editor.setModelLanguage(model, language);

            editor.updateOptions({ readOnly: false });
            editorFilenameEl.textContent = `编辑中: ${file.name}`;
            saveBtn.disabled = false;
            downloadBtn.disabled = false;
            selectedFile = file;

            document.querySelectorAll('#file-list li').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');

            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            }

        } catch (error) {
            console.error('读取文件失败:', error);
            alert(`读取文件失败: ${error.message}`);
        }
    }

    // 手机端打开/关闭 sidebar
    sidebarToggle.addEventListener('click', () => {
        const isOpen = sidebar.classList.toggle('open');
        overlay.classList.toggle('active', isOpen);
    });

    // 点击遮罩关闭 sidebar
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    });

    // 保存文件
    saveBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        try {
            const response = await fetch('/api/files/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: selectedFile.path, content: editor.getValue() })
            });
            await handleApiError(response);
            alert('文件保存成功！');
        } catch (error) {
            console.error('保存文件失败:', error);
            alert(`保存文件失败: ${error.message}`);
        }
    });

    // 下载文件
    downloadBtn.addEventListener('click', () => {
        if (!selectedFile) return;
        window.location.href = `/api/files/download?path=${encodeURIComponent(selectedFile.path)}`;
    });

    // 创建文件夹
    createFolderBtn.addEventListener('click', async () => {
        const folderName = prompt('请输入新文件夹名称:');
        if (!folderName) return;
        try {
            const response = await fetch('/api/files/create-dir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentPath, name: folderName })
            });
            await handleApiError(response);
            fetchFiles(currentPath);
        } catch (error) {
            console.error('创建文件夹失败:', error);
            alert(`创建文件夹失败: ${error.message}`);
        }
    });

    // 创建新文件
    createFileBtn.addEventListener('click', async () => {
        const fileName = prompt('请输入新文件名:');
        if (!fileName) return;
        const newFilePath = currentPath === '.' ? fileName : `${currentPath}/${fileName}`;
        try {
            const response = await fetch('/api/files/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newFilePath, content: '' })
            });
            await handleApiError(response);
            fetchFiles(currentPath);
        } catch (error) {
            console.error('创建文件失败:', error);
            alert(`创建文件失败: ${error.message}`);
        }
    });

    function getLanguageForFile(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const langMap = { js: 'javascript', ts: 'typescript', json: 'json', css: 'css', html: 'html', md: 'markdown' };
        return langMap[ext] || 'plaintext';
    }

    // 初始化加载
    fetchFiles('.');
});