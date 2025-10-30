
class PluginInfo {
    constructor(name, description, version, author, unpackedSize, updatedAt, keywords) {
        this.name = name;
        this.description = description;
        this.version = version;
        this.author = author;
        this.unpackedSize = unpackedSize; // 例如 "1.23 MB"
        this.updatedAt = updatedAt;       // 例如 "2023/10/26 14:30:00"
        this.keywords = keywords || [];   // 数组
    }
}

// 后端API的基础URL
const BASE_API_URL = '';

// 获取DOM元素
const pluginListDiv = document.getElementById('plugin-list');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const emptyResultsMessage = document.getElementById('empty-results');

const modalOverlay = document.getElementById('modal-overlay');
const pluginModal = document.getElementById('plugin-modal');
const closeModalBtn = document.getElementById('close-modal-btn');

const modalPluginName = document.getElementById('modal-plugin-name');
const modalDescription = document.getElementById('modal-description');
const modalAuthor = document.getElementById('modal-author');
const modalLatestVersion = document.getElementById('modal-latest-version');
const modalCurrentVersion = document.getElementById('modal-current-version');
const modalSize = document.getElementById('modal-size');
const modalUpdatedAt = document.getElementById('modal-updated-at');
const modalKeywords = document.getElementById('modal-keywords');

const versionSelect = document.getElementById('version-select');
const installBtn = document.getElementById('install-btn');
const uninstallBtn = document.getElementById('uninstall-btn');

const loadingOverlay = document.getElementById('loading-overlay');
const messageDisplay = document.getElementById('message-display');

let currentPluginName = ''; // 当前在模态框中显示的插件名称

// --- 辅助函数 ---

/** 显示/隐藏加载遮罩 */
function toggleLoadingOverlay(show) {
    loadingOverlay.classList.toggle('visible', show);
}

/** 显示/隐藏模态框 */
function toggleModal(show) {
    modalOverlay.classList.toggle('visible', show);
    if (!show) {
        // 关闭时清空选择，防止快速点击
        versionSelect.innerHTML = '<option value="">加载中...</option>';
        modalCurrentVersion.textContent = '未安装';
    }
}

/** 显示顶部提示消息 */
function showMessage(type, message) {
    messageDisplay.textContent = message;
    messageDisplay.className = `message-display visible ${type}`; // success 或 error
    setTimeout(() => {
        messageDisplay.classList.remove('visible');
    }, 3000); // 3秒后自动消失
}

/** 通用的 API 请求函数 */
async function fetchApi(endpoint, method = 'GET') {
    try {
        const response = await fetch(`${BASE_API_URL}${endpoint}`, { method });
        const data = await response.json();
        if (data.success === false) {
            throw new Error(data.message || '操作失败，后端返回错误。');
        }
        return data;
    } catch (error) {
        console.error(`API 请求失败(${endpoint}):`, error);
        throw error; // 重新抛出错误以便调用方处理
    }
}

// --- 核心功能函数 ---

/** 刷新插件列表 */
async function refreshPluginList(query = '') {
    pluginListDiv.innerHTML = ''; // 清空列表
    emptyResultsMessage.classList.add('hidden'); // 隐藏无结果提示
    toggleLoadingOverlay(true); // 显示加载遮罩

    try {
        let pluginsData;
        if (query) {
            pluginsData = await fetchApi(`/api/market/search?q=${encodeURIComponent(query)}`);
        } else {
            pluginsData = await fetchApi('/api/market/list');
        }

        if (!pluginsData || pluginsData.length === 0) {
            emptyResultsMessage.classList.remove('hidden');
            return;
        }

        pluginsData.forEach(plugin => {
            const card = document.createElement('div');
            card.className = 'plugin-card';
            card.innerHTML = `
                        <h3>${plugin.name}</h3>
                        <p class="description">${plugin.description || '无描述'}</p>
                        <div class="details">
                            <span><strong>作者:</strong> ${plugin.author || '未知'}</span>
                            <span><strong>版本:</strong> ${plugin.version}</span>
                            <span><strong>大小:</strong> ${plugin.unpackedSize || '未知'}</span>
                            <span><strong>更新:</strong> ${plugin.updatedAt || '未知'}</span>
                        </div>
                        <div class="actions">
                            <button data-plugin-name="${plugin.name}">详情</button>
                        </div>
                    `;
            card.querySelector('button').addEventListener('click', () => openPluginDetails(plugin));
            pluginListDiv.appendChild(card);
        });

    } catch (error) {
        showMessage('error', `加载插件列表失败: ${error.message}`);
        emptyResultsMessage.textContent = `加载失败：${error.message}`;
        emptyResultsMessage.classList.remove('hidden');
    } finally {
        toggleLoadingOverlay(false); // 隐藏加载遮罩
    }
}

/** 打开插件详情模态框 */
async function openPluginDetails(plugin) {
    currentPluginName = plugin.name;

    // 填充基本信息
    modalPluginName.textContent = plugin.name;
    modalDescription.textContent = plugin.description || '无描述';
    modalAuthor.textContent = plugin.author || '未知';
    modalLatestVersion.textContent = plugin.version;
    modalSize.textContent = plugin.unpackedSize || '未知';
    modalUpdatedAt.textContent = plugin.updatedAt || '未知';

    modalKeywords.innerHTML = '';
    if (plugin.keywords && plugin.keywords.length > 0) {
        plugin.keywords.forEach(keyword => {
            const li = document.createElement('li');
            li.textContent = keyword;
            modalKeywords.appendChild(li);
        });
    } else {
        modalKeywords.innerHTML = '<li>无</li>';
    }

    // 加载版本和当前安装版本
    versionSelect.innerHTML = '<option value="">加载中...</option>';
    modalCurrentVersion.textContent = '获取中...';
    toggleLoadingOverlay(true); // 模态框内操作也用加载遮罩

    try {
        // 获取所有版本并填充下拉框
        const versionsData = await fetchApi(`/api/market/versions?name=${encodeURIComponent(plugin.name)}`);
        versionSelect.innerHTML = ''; // 清空原有选项

        if (versionsData && Object.keys(versionsData).length > 0) {
            for (const ver in versionsData) {
                const option = document.createElement('option');
                option.value = versionsData[ver].version;
                option.textContent = versionsData[ver].version;
                versionSelect.appendChild(option);
            };
            // 默认选择最新版本
            versionSelect.value = plugin.version;
        } else {
            versionSelect.innerHTML = '<option value="">无可用版本</option>';
            installBtn.disabled = true; // 如果没有版本，则禁用安装按钮
        }

        // 获取当前已安装版本
        const currentVerData = await fetchApi(`/api/market/currentver?name=${encodeURIComponent(plugin.name)}`);
        if (currentVerData && currentVerData.version) {
            modalCurrentVersion.textContent = currentVerData.version;
            uninstallBtn.disabled = false; // 已安装则启用卸载
        } else {
            modalCurrentVersion.textContent = '未安装';
            uninstallBtn.disabled = true; // 未安装则禁用卸载
        }

    } catch (error) {
        showMessage('error', `获取版本信息失败: ${error.message}`);
        currentVerData.textContent = '获取失败';
        versionSelect.innerHTML = '<option value="">加载失败</option>';
        installBtn.disabled = true;
        uninstallBtn.disabled = true;
    } finally {
        toggleLoadingOverlay(false);
        toggleModal(true); // 最后显示模态框
    }
}

/** 处理安装插件 */
async function handleInstall() {
    const selectedVersion = versionSelect.value;
    if (!selectedVersion) {
        showMessage('error', '请选择要安装的版本！');
        return;
    }

    toggleModal(false); // 关闭模态框
    toggleLoadingOverlay(true); // 显示加载遮罩

    try {
        await fetchApi(`/api/market/install?name=${encodeURIComponent(currentPluginName)}&version=${encodeURIComponent(selectedVersion)}`, 'POST');
        showMessage('success', `${currentPluginName} v${selectedVersion} 安装成功！`);
        // 安装成功后刷新插件列表，因为状态可能改变
        refreshPluginList(searchInput.value);
    } catch (error) {
        showMessage('error', `安装 ${currentPluginName} 失败: ${error.message}`);
    } finally {
        toggleLoadingOverlay(false); // 隐藏加载遮罩
    }
}

/** 处理卸载插件 */
async function handleUninstall() {
    if (!currentPluginName) return; // 避免没有选中插件时误操作

    toggleModal(false); // 关闭模态框
    toggleLoadingOverlay(true); // 显示加载遮罩

    try {
        await fetchApi(`/api/market/uninstall?name=${encodeURIComponent(currentPluginName)}`, 'POST');
        showMessage('success', `${currentPluginName} 卸载成功！`);
        // 卸载成功后刷新插件列表
        refreshPluginList(searchInput.value);
    } catch (error) {
        showMessage('error', `卸载 ${currentPluginName} 失败: ${error.message}`);
    } finally {
        toggleLoadingOverlay(false); // 隐藏加载遮罩
    }
}

// --- 事件监听 ---

// 搜索按钮点击事件
searchButton.addEventListener('click', () => {
    refreshPluginList(searchInput.value.trim());
});

// 搜索输入框回车事件
searchInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        searchButton.click();
    }
});

// 关闭模态框按钮点击事件
closeModalBtn.addEventListener('click', () => {
    toggleModal(false);
});

// 点击模态框背景关闭模态框
modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
        toggleModal(false);
    }
});

// 安装按钮点击事件
installBtn.addEventListener('click', handleInstall);

// 卸载按钮点击事件
uninstallBtn.addEventListener('click', handleUninstall);

// 页面加载完成时加载插件列表
window.addEventListener('load', () => {
    refreshPluginList();
});