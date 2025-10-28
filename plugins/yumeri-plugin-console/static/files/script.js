document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarButton = document.getElementById('toggle-sidebar');
    const overlay = document.getElementById('overlay');
    const pluginList = document.getElementById('plugin-list');
    const configurationArea = document.getElementById('configuration-area');
    const pluginTitle = document.getElementById('plugin-title');
    const pluginStatus = document.getElementById('plugin-status');
    const saveButton = document.querySelector('.save-button');
    const enableButton = document.querySelector('.enable-button');
    const disableButton = document.querySelector('.disable-button');
    const notification = document.getElementById('notification');
    const pluginUsage = document.getElementById('plugin-usage');
    const addPluginBtn = document.getElementById('add-plugin-btn');
    const addPluginModal = document.getElementById('add-plugin-modal');
    const availablePluginList = document.getElementById('available-plugin-list');
    const closeModalBtn = document.getElementById('close-modal-btn');

    addPluginBtn.addEventListener('click', async () => {
        addPluginModal.style.display = 'block';
        availablePluginList.innerHTML = '<li>加载中...</li>';

        try {
            const res = await fetch('/api/console/unregistered');
            const data = await res.json();

            if (data.success && data.plugins.length > 0) {
                availablePluginList.innerHTML = '';
                data.plugins.forEach(name => {
                    const li = document.createElement('li');
                    li.textContent = name;
                    li.className = 'clickable-plugin';
                    li.style.cursor = 'pointer';
                    li.addEventListener('click', async () => {
                        if (!confirm(`确认添加插件 ${name} 吗？`)) return;
                        const resp = await fetch(`/api/console/addplugin?name=${encodeURIComponent(name)}`);
                        const result = await resp.json();
                        alert(result.message);
                        if (result.success) location.reload();
                    });
                    availablePluginList.appendChild(li);
                });
            } else {
                availablePluginList.innerHTML = '<li>没有可添加的插件</li>';
            }
        } catch (err) {
            availablePluginList.innerHTML = `<li>加载失败：${err}</li>`;
        }
    });

    closeModalBtn.addEventListener('click', () => {
        addPluginModal.style.display = 'none';
    });

    let currentPluginName = null; // 显示用短名，例如 "pages"
    let currentPluginStatus = null; // 用于存储当前插件状态

    // 初始隐藏启用/禁用按钮
    enableButton.style.display = 'none';
    disableButton.style.display = 'none';
    saveButton.style.display = 'none';

    // Toggle sidebar
    toggleSidebarButton.addEventListener('click', function () {
        sidebar.classList.add('open');
        overlay.style.display = 'block';
        toggleSidebarButton.style.display = 'none';
    });

    // 点击遮罩层关闭侧边栏
    overlay.addEventListener('click', function () {
        sidebar.classList.remove('open');
        overlay.style.display = 'none';
        toggleSidebarButton.style.display = 'block';
    });

    // 显示通知
    function showNotification(message, type = 'success') {
        notification.textContent = message;
        notification.className = 'notification';
        if (type === 'error') {
            notification.classList.add('error');
        }
        notification.style.display = 'block';
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.style.display = 'none';
            }, 300);
        }, 3000);
    }

    // ---- 工具函数：处理前缀和 ~ ----
    // 去掉开头的 ~（如果有）
    function stripLeadingTilde(name) {
        return name.replace(/^~/, '');
    }

    // 去掉 yumeri-plugin- 前缀（同时也会去掉前面的 ~）
    function stripPluginPrefix(name) {
        const noTilde = stripLeadingTilde(name);
        return noTilde.replace(/^yumeri-plugin-/, '');
    }

    // 给短名补回 yumeri-plugin- 前缀（用于向后端请求），并确保没有开头的 ~
    function addPluginPrefix(name) {
        const noTilde = name.replace(/^~/, '');
        return noTilde.startsWith('yumeri-plugin-') ? noTilde : `yumeri-plugin-${noTilde}`;
    }

    // 尝试把一个输入（可能是短名、可能是 full name、可能带 ~）返回后端能接受的 full name（不带 ~）
    function normalizeToApiFullName(inputName) {
        // 去掉开头的 ~，若已经是 full name（以 yumeri-plugin- 开头）就返回，否则加前缀
        const noTilde = stripLeadingTilde(inputName);
        return noTilde.startsWith('yumeri-plugin-') ? noTilde : `yumeri-plugin-${noTilde}`;
    }
    // ------------------------------------

    // 获取插件状态（接受短名或 full name 或带 ~ 的名字）
    async function getPluginStatus(pluginNameInput) {
        try {
            const fullName = normalizeToApiFullName(pluginNameInput);
            const response = await fetch(`/api/console/pluginstatus?name=${encodeURIComponent(fullName)}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (typeof data === 'string') return data.trim();
            if (data && typeof data.status === 'string') return data.status.trim();
            return 'DISABLED';
        } catch (error) {
            console.error('Failed to get plugin status:', error);
            return 'DISABLED';
        }
    }

    // 获取并显示插件列表
    async function fetchPluginList() {
        try {
            const response = await fetch('/api/console/plugins?includeDisabled=true');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const plugins = await response.json();

            pluginList.innerHTML = ''; // 清空现有列表

            // 为每个插件获取状态并创建列表项
            for (const pluginRawName of plugins) {
                const listItem = document.createElement('li');

                // 创建状态指示器
                const statusIndicator = document.createElement('span');
                statusIndicator.className = 'plugin-status';

                // 处理可能带 ~ 的名字，得到 rawFullName（不带 ~，可能含 yumeri-plugin-）
                const rawFullName = stripLeadingTilde(pluginRawName);
                // 显示名：去掉 yumeri-plugin- 前缀
                const displayName = stripPluginPrefix(rawFullName);

                const nameSpan = document.createElement('span');
                nameSpan.textContent = displayName;

                // 获取插件状态（传 rawFullName 或 displayName 都可以，getPluginStatus 会 normalize）
                const status = await getPluginStatus(rawFullName);

                // 根据状态设置圆点颜色
                if (status === 'ENABLED') {
                    statusIndicator.classList.add('enabled');
                } else if (status === 'PENDING') {
                    statusIndicator.classList.add('pending');
                } else { // DISABLED
                    statusIndicator.classList.add('disabled');
                }

                listItem.appendChild(statusIndicator);
                listItem.appendChild(nameSpan);
                // 存储显示用短名（dataset.plugin）和原始后端full name（dataset.fullname）
                listItem.dataset.plugin = displayName; // "pages"
                listItem.dataset.fullname = rawFullName; // "yumeri-plugin-pages"
                listItem.dataset.status = status; // 存储插件状态

                listItem.addEventListener('click', function () {
                    loadPluginConfiguration(listItem.dataset.plugin, listItem.dataset.status);
                    if (window.innerWidth <= 768) {
                        sidebar.classList.remove('open');
                        overlay.style.display = 'none';
                        toggleSidebarButton.style.display = 'block';
                    }
                });
                pluginList.appendChild(listItem);
            }
        } catch (error) {
            console.error('Failed to fetch plugin list:', error);
            pluginList.innerHTML = '<li>Failed to load plugins.</li>';
        }
    }

    // 深度合并对象
    function deepMergeObject(target, path, value) {
        const keys = path.split('.');
        let current = target;

        keys.forEach((key, index) => {
            if (index === keys.length - 1) {
                current[key] = value;
            } else {
                // 如果路径中的某个部分不存在或不是对象，则初始化为新的空对象
                if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
                    current[key] = {};
                }
                current = current[key];
            }
        });

        return target;
    }

    // 加载插件配置（pluginName 是短名，例如 "pages"）
    async function loadPluginConfiguration(pluginName, pluginStatus) {
        try {
            currentPluginName = pluginName;
            currentPluginStatus = pluginStatus;
            updatePluginStatus();

            // 构建后端需要的 full name
            const fullName = addPluginPrefix(pluginName);

            // 同时请求配置和元信息
            const [configRes, metaRes] = await Promise.all([
                fetch(`/api/console/config?name=${encodeURIComponent(fullName)}`),
                fetch(`/api/console/pluginmetadata?name=${encodeURIComponent(fullName)}`)
            ]);

            if (!configRes.ok) throw new Error(`HTTP error! status: ${configRes.status}`);
            if (!metaRes.ok) throw new Error(`HTTP error! status: ${metaRes.status}`);

            const config = await configRes.json();
            const meta = await metaRes.json();

            // 更新 usage
            pluginUsage.innerHTML = meta.usage || '';

            // 更新依赖与提供服务
            const metaArea = document.getElementById('plugin-meta');
            metaArea.innerHTML = '';

            const dependList = meta.depend && meta.depend.length
                ? `<div class="meta-box depend">依赖服务：${meta.depend.join('，')}</div>`
                : '';
            const provideList = meta.provide && meta.provide.length
                ? `<div class="meta-box provide">提供服务：${meta.provide.join('，')}</div>`
                : '';

            metaArea.innerHTML = dependList + provideList;

            // 渲染配置项
            configurationArea.innerHTML = '';
            if (Array.isArray(config)) {
                renderConfigItems(config);
            } else if (config.error) {
                configurationArea.innerHTML = `<p>${config.error}</p>`;
            } else {
                console.warn('Invalid configuration format received:', config);
                configurationArea.innerHTML = '<p>Received invalid configuration format from server.</p>';
            }

            pluginTitle.textContent = `${pluginName} 配置`;

            // 绑定事件监听器
            bindEventListeners();
        } catch (error) {
            console.error('Failed to load plugin configuration:', error);
            configurationArea.innerHTML = `<p>Failed to load configuration: ${error.message}</p>`;
        }
    }

    // --- 以下渲染函数与原来一致（我只在上方做了必要改动） ---
    function renderConfigItems(configItems) {
        configItems.forEach(item => {
            const configItemDiv = document.createElement('div');
            configItemDiv.className = 'config-item';
            configItemDiv.dataset.key = item.key;

            switch (item.type) {
                case 'text':
                    renderTextInput(configItemDiv, item);
                    break;
                case 'number':
                    renderNumberInput(configItemDiv, item);
                    break;
                case 'boolean':
                    renderBooleanInput(configItemDiv, item);
                    break;
                case 'select':
                    renderSelectInput(configItemDiv, item);
                    break;
                case 'array':
                    renderArrayInput(configItemDiv, item);
                    break;
                case 'complex-array':
                    renderComplexArrayInput(configItemDiv, item);
                    break;
                case 'object-header':
                    renderObjectHeader(configItemDiv, item);
                    break;
                default:
                    renderTextInput(configItemDiv, item);
            }

            configurationArea.appendChild(configItemDiv);
        });
    }

    function renderTextInput(container, item) {
        const label = document.createElement('label');
        label.textContent = item.description || item.key;
        label.htmlFor = item.key;

        const input = document.createElement('input');
        input.type = 'text';
        input.id = item.key;
        input.value = item.value !== null && item.value !== undefined ? item.value : '';
        input.dataset.key = item.key;

        container.appendChild(label);
        container.appendChild(input);
    }

    function renderNumberInput(container, item) {
        const label = document.createElement('label');
        label.textContent = item.description || item.key;
        label.htmlFor = item.key;

        const input = document.createElement('input');
        input.type = 'number';
        input.id = item.key;
        input.value = item.value !== null && item.value !== undefined ? item.value : 0;
        input.dataset.key = item.key;

        container.appendChild(label);
        container.appendChild(input);
    }

    function renderBooleanInput(container, item) {
        const label = document.createElement('label');
        label.textContent = item.description || item.key;
        label.htmlFor = item.key;
        container.appendChild(label);

        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = item.key;
        input.checked = !!item.value;
        input.dataset.key = item.key;

        const slider = document.createElement('span');
        slider.className = 'slider round';

        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        container.appendChild(switchLabel);
    }

    function renderSelectInput(container, item) {
        const label = document.createElement('label');
        label.textContent = item.description || item.key;
        label.htmlFor = item.key;

        const select = document.createElement('select');
        select.id = item.key;
        select.dataset.key = item.key;

        if (Array.isArray(item.options)) {
            item.options.forEach(option => {
                const optionEl = document.createElement('option');
                optionEl.value = option;
                optionEl.textContent = option;
                if (option === item.value) {
                    optionEl.selected = true;
                }
                select.appendChild(optionEl);
            });
        }

        container.appendChild(label);
        container.appendChild(select);
    }

    function renderArrayInput(container, item) {
        const header = document.createElement('div');
        header.className = 'array-header';
        header.textContent = item.description || item.key;
        container.appendChild(header);

        const arrayContainer = document.createElement('div');
        arrayContainer.className = 'array-container';
        arrayContainer.dataset.key = item.key;
        arrayContainer.dataset.type = 'array';
        arrayContainer.dataset.itemType = item.itemType || 'string';

        if (Array.isArray(item.value)) {
            item.value.forEach(value => {
                const arrayItem = createArrayItem(value, item.itemType || 'string');
                arrayContainer.appendChild(arrayItem);
            });
        }

        const addButton = document.createElement('button');
        addButton.className = 'add-array-item';
        addButton.textContent = '添加项';
        addButton.dataset.action = 'add-array-item';
        addButton.dataset.target = item.key;

        const controls = document.createElement('div');
        controls.className = 'array-controls';
        controls.appendChild(addButton);

        container.appendChild(arrayContainer);
        container.appendChild(controls);
    }

    function createArrayItem(value, itemType) {
        const arrayItem = document.createElement('div');
        arrayItem.className = 'array-item';

        const itemContent = document.createElement('div');
        itemContent.className = 'array-item-content';

        let input;
        if (itemType === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.value = value !== null && value !== undefined ? value : 0;
            input.className = 'array-item-input';
        } else if (itemType === 'boolean') {
            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch';

            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!value;
            input.className = 'array-item-input';

            const slider = document.createElement('span');
            slider.className = 'slider round';

            switchLabel.appendChild(input);
            switchLabel.appendChild(slider);
            itemContent.appendChild(switchLabel);
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = value !== null && value !== undefined ? value : '';
            input.className = 'array-item-input';
            itemContent.appendChild(input);
        }

        if (itemType !== 'boolean') {
            itemContent.appendChild(input);
        }

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-array-item';
        removeButton.textContent = '删除';
        removeButton.dataset.action = 'remove-array-item';

        arrayItem.appendChild(itemContent);
        arrayItem.appendChild(removeButton);

        return arrayItem;
    }

    function renderComplexArrayInput(container, item) {
        const header = document.createElement('div');
        header.className = 'array-header';
        header.textContent = item.description || item.key;
        container.appendChild(header);

        const arrayContainer = document.createElement('div');
        arrayContainer.className = 'array-container';
        arrayContainer.dataset.key = item.key;
        arrayContainer.dataset.type = 'complex-array';
        arrayContainer.dataset.itemType = item.itemType;
        arrayContainer.dataset.itemSchema = JSON.stringify(item.itemSchema);

        if (Array.isArray(item.value)) {
            item.value.forEach((value, index) => {
                const complexItem = createComplexArrayItem(item.key, index, value, item.itemSchema);
                arrayContainer.appendChild(complexItem);
            });
        }

        const addButton = document.createElement('button');
        addButton.className = 'add-array-item';
        addButton.textContent = '添加项';
        addButton.dataset.action = 'add-complex-array-item';
        addButton.dataset.target = item.key;

        const controls = document.createElement('div');
        controls.className = 'array-controls';
        controls.appendChild(addButton);

        container.appendChild(arrayContainer);
        container.appendChild(controls);
    }

    function createComplexArrayItem(arrayKey, index, value, itemSchema) {
        const complexItem = document.createElement('div');
        complexItem.className = 'complex-array-item';
        complexItem.dataset.index = index;

        const header = document.createElement('div');
        header.className = 'complex-array-item-header';

        const title = document.createElement('div');
        title.className = 'complex-array-item-title';
        title.textContent = `项 ${index + 1}`;

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-array-item';
        removeButton.textContent = '删除';
        removeButton.dataset.action = 'remove-complex-array-item';

        header.appendChild(title);
        header.appendChild(removeButton);
        complexItem.appendChild(header);

        const content = document.createElement('div');
        content.className = 'complex-array-item-content';

        if (itemSchema.type === 'object' && itemSchema.properties) {
            Object.entries(itemSchema.properties).forEach(([propKey, propSchema]) => {
                const propValue = value && typeof value === 'object' ? value[propKey] : undefined;
                const finalValue = propValue !== undefined ? propValue :
                    (propSchema.default !== undefined ? propSchema.default :
                        (propSchema.type === 'object' ? {} :
                            (propSchema.type === 'array' ? [] : '')));

                const propItem = {
                    key: `${arrayKey}[${index}].${propKey}`,
                    value: finalValue,
                    description: propSchema.description || propKey,
                    type: propSchema.enum ? 'select' : propSchema.type,
                    options: propSchema.enum
                };

                const propDiv = document.createElement('div');
                propDiv.className = 'config-item';
                propDiv.dataset.key = propItem.key;

                switch (propItem.type) {
                    case 'text':
                    case 'string':
                        renderTextInput(propDiv, propItem);
                        break;
                    case 'number':
                        renderNumberInput(propDiv, propItem);
                        break;
                    case 'boolean':
                        renderBooleanInput(propDiv, propItem);
                        break;
                    case 'select':
                        renderSelectInput(propDiv, propItem);
                        break;
                    default:
                        renderTextInput(propDiv, propItem);
                }

                content.appendChild(propDiv);
            });
        } else if (itemSchema.type === 'array' && itemSchema.items) {
            const arrayItem = {
                key: `${arrayKey}[${index}]`,
                value: Array.isArray(value) ? value : [],
                description: itemSchema.description || `项 ${index + 1}`,
                type: 'array',
                itemType: itemSchema.items.type
            };

            renderArrayInput(content, arrayItem);
        } else {
            const basicItem = {
                key: `${arrayKey}[${index}]`,
                value: value,
                description: itemSchema.description || `项 ${index + 1}`,
                type: itemSchema.type === 'boolean' ? 'boolean' :
                    (itemSchema.type === 'number' ? 'number' : 'text')
            };

            switch (basicItem.type) {
                case 'boolean':
                    renderBooleanInput(content, basicItem);
                    break;
                case 'number':
                    renderNumberInput(content, basicItem);
                    break;
                default:
                    renderTextInput(content, basicItem);
            }
        }

        complexItem.appendChild(content);
        return complexItem;
    }

    function renderObjectHeader(container, item) {
        const header = document.createElement('div');
        header.className = 'object-header';
        header.textContent = item.description || item.key;

        const objectContainer = document.createElement('div');
        objectContainer.className = 'object-container';
        objectContainer.dataset.key = item.key;
        objectContainer.dataset.type = 'object';

        if (item.properties && typeof item.properties === 'object') {
            Object.entries(item.properties).forEach(([propKey, propSchema]) => {
                const propValue = item.value && typeof item.value === 'object' ? item.value[propKey] : undefined;
                const propItem = {
                    key: `${item.key}.${propKey}`,
                    value: propValue !== undefined ? propValue :
                        (propSchema.default !== undefined ? propSchema.default : ''),
                    description: propSchema.description || propKey,
                    type: propSchema.enum ? 'select' : propSchema.type,
                    options: propSchema.enum
                };

                const propDiv = document.createElement('div');
                propDiv.className = 'config-item';
                propDiv.dataset.key = propItem.key;

                switch (propItem.type) {
                    case 'number':
                        renderNumberInput(propDiv, propItem);
                        break;
                    case 'boolean':
                        renderBooleanInput(propDiv, propItem);
                        break;
                    case 'select':
                        renderSelectInput(propDiv, propItem);
                        break;
                    case 'object':
                        renderObjectHeader(propDiv, propItem);
                        break;
                    case 'array':
                        renderArrayInput(propDiv, propItem);
                        break;
                    default:
                        renderTextInput(propDiv, propItem);
                }

                objectContainer.appendChild(propDiv);
            });
        }

        container.appendChild(header);
        container.appendChild(objectContainer);
    }

    function bindEventListeners() {
        document.querySelectorAll('[data-action="add-array-item"]').forEach(button => {
            button.addEventListener('click', function () {
                const targetKey = this.dataset.target;
                const arrayContainer = document.querySelector(`.array-container[data-key="${targetKey}"]`);
                const itemType = arrayContainer.dataset.itemType || 'string';

                const newItem = createArrayItem('', itemType);
                arrayContainer.appendChild(newItem);
            });
        });

        document.querySelectorAll('[data-action="add-complex-array-item"]').forEach(button => {
            button.addEventListener('click', function () {
                const targetKey = this.dataset.target;
                const arrayContainer = document.querySelector(`.array-container[data-key="${targetKey}"]`);
                const itemSchema = JSON.parse(arrayContainer.dataset.itemSchema);
                const currentItems = arrayContainer.querySelectorAll('.complex-array-item');
                const newIndex = currentItems.length;

                let defaultValue;
                if (itemSchema.type === 'object') {
                    defaultValue = {};
                    if (itemSchema.properties) {
                        Object.entries(itemSchema.properties).forEach(([key, prop]) => {
                            defaultValue[key] = prop.default !== undefined ? prop.default :
                                (prop.type === 'object' ? {} :
                                    (prop.type === 'array' ? [] : ''));
                        });
                    }
                } else if (itemSchema.type === 'array') {
                    defaultValue = [];
                } else {
                    defaultValue = itemSchema.default !== undefined ? itemSchema.default : '';
                }

                const newItem = createComplexArrayItem(targetKey, newIndex, defaultValue, itemSchema);
                arrayContainer.appendChild(newItem);

                bindEventListeners();
            });
        });

        document.addEventListener('click', function (e) {
            if (e.target.dataset.action === 'remove-array-item') {
                e.target.closest('.array-item').remove();
            } else if (e.target.dataset.action === 'remove-complex-array-item') {
                e.target.closest('.complex-array-item').remove();
            }
        });
    }

    function collectConfigData() {
        const configData = {};

        document.querySelectorAll('#configuration-area input[data-key], #configuration-area select[data-key]').forEach(el => {
            if (!el.closest('.array-container') && !el.closest('.complex-array-item')) {
                const key = el.dataset.key;
                let value;

                if (el.type === 'checkbox') {
                    value = el.checked;
                } else if (el.type === 'number') {
                    value = Number(el.value);
                } else if (el.tagName === 'SELECT') {
                    value = el.value;
                } else {
                    value = el.value;
                }

                deepMergeObject(configData, key, value);
            }
        });

        document.querySelectorAll('.array-container[data-type="array"]').forEach(container => {
            const key = container.dataset.key;
            const itemType = container.dataset.itemType;
            const items = [];

            container.querySelectorAll('.array-item').forEach(item => {
                const input = item.querySelector('.array-item-input');
                if (input) {
                    let value;
                    if (itemType === 'number') {
                        value = Number(input.value);
                    } else if (itemType === 'boolean') {
                        value = input.checked;
                    } else {
                        value = input.value;
                    }
                    items.push(value);
                }
            });

            deepMergeObject(configData, key, items);
        });

        document.querySelectorAll('.array-container[data-type="complex-array"]').forEach(container => {
            const key = container.dataset.key;
            const items = [];

            container.querySelectorAll('.complex-array-item').forEach(complexItem => {
                const index = complexItem.dataset.index;
                let itemData = {};

                complexItem.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                    const inputKey = input.dataset.key;
                    const match = inputKey.match(new RegExp(`${key}\\[(\\d+)\\]\\.(.+)`));

                    if (match) {
                        const propKey = match[2];
                        let value;

                        if (input.type === 'checkbox') {
                            value = input.checked;
                        } else if (input.type === 'number') {
                            value = Number(input.value);
                        } else if (input.tagName === 'SELECT') {
                            value = input.value;
                        } else {
                            value = input.value;
                        }

                        if (propKey.includes('.')) {
                            deepMergeObject(itemData, propKey, value);
                        } else {
                            itemData[propKey] = value;
                        }
                    }
                });

                complexItem.querySelectorAll('.array-container').forEach(nestedArray => {
                    const nestedKey = nestedArray.dataset.key;
                    const match = nestedKey.match(new RegExp(`${key}\\[(\\d+)\\](.+)`));

                    if (match) {
                        const propPath = match[2];
                        const nestedItems = [];

                        nestedArray.querySelectorAll('.array-item').forEach(item => {
                            const input = item.querySelector('.array-item-input');
                            if (input) {
                                let value;
                                if (nestedArray.dataset.itemType === 'number') {
                                    value = Number(input.value);
                                } else if (nestedArray.dataset.itemType === 'boolean') {
                                    value = input.checked;
                                } else {
                                    value = input.value;
                                }
                                nestedItems.push(value);
                            }
                        });

                        if (propPath.startsWith('.')) {
                            deepMergeObject(itemData, propPath.substring(1), nestedItems);
                        } else {
                            itemData[propPath] = nestedItems;
                        }
                    }
                });

                items.push(itemData);
            });

            deepMergeObject(configData, key, items);
        });

        return configData;
    }

    function updatePluginStatus() {
        if (currentPluginStatus === 'DISABLED') {
            pluginStatus.innerHTML = '<p style="color: #ccc;">当前状态: 未启用</p>';
            enableButton.style.display = 'inline-block';
            disableButton.style.display = 'none';
        } else if (currentPluginStatus === 'PENDING') {
            pluginStatus.innerHTML = '<p style="color: #f44336;">当前状态: 依赖未满足</p>';
            enableButton.style.display = 'none';
            disableButton.style.display = 'inline-block';
        } else { // ENABLED
            pluginStatus.innerHTML = '<p style="color: #4CAF50;">当前状态: 已启用</p>';
            enableButton.style.display = 'none';
            disableButton.style.display = 'inline-block';
        }
        saveButton.style.display = 'inline-block';
    }

    // 保存配置按钮事件（向后端发送 fullName，不带 ~）
    saveButton.addEventListener('click', async function () {
        if (!currentPluginName) {
            showNotification('请先选择一个插件', 'error');
            return;
        }

        try {
            const configData = collectConfigData();
            const jsonContent = JSON.stringify(configData);
            console.log('Saving configuration:', jsonContent);

            const fullName = addPluginPrefix(currentPluginName); // e.g. yumeri-plugin-pages
            const url = `/api/console/saveconfig?name=${encodeURIComponent(fullName)}&config=${encodeURIComponent(jsonContent)}`;
            const response = await fetch(url);

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            showNotification(result.success ? '配置保存成功' : result.message, result.success ? true : false);

            if (result.success) {
                setTimeout(fetchPluginList, 1000);
            }
        } catch (error) {
            console.error('Failed to save configuration:', error);
            showNotification(`保存配置失败: ${error.message}`, 'error');
        }
    });

    // 启用插件（向后端发送 fullName，不带 ~）
    enableButton.addEventListener('click', async function () {
        if (!currentPluginName || currentPluginStatus !== 'DISABLED') {
            showNotification('当前插件不需要启用', 'error');
            return;
        }

        try {
            const fullName = addPluginPrefix(currentPluginName);
            const response = await fetch(`/api/console/enableplugin?name=${encodeURIComponent(fullName)}`);

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                showNotification('插件启用成功', 'success');

                currentPluginStatus = 'ENABLED';
                updatePluginStatus();

                setTimeout(fetchPluginList, 1000);
                setTimeout(() => loadPluginConfiguration(currentPluginName, currentPluginStatus), 1500);
            } else {
                showNotification(result.message || '插件启用失败', 'error');
            }
        } catch (error) {
            console.error('Failed to enable plugin:', error);
            showNotification(`启用插件失败: ${error.message}`, 'error');
        }
    });

    // 禁用插件（向后端发送 fullName，不带 ~）
    disableButton.addEventListener('click', async function () {
        if (!currentPluginName || currentPluginStatus === 'DISABLED') {
            showNotification('当前插件不需要禁用', 'error');
            return;
        }

        try {
            const fullName = addPluginPrefix(currentPluginName);
            const response = await fetch(`/api/console/disableplugin?name=${encodeURIComponent(fullName)}`);

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                showNotification('插件禁用成功', 'success');

                currentPluginStatus = 'DISABLED';
                updatePluginStatus();

                setTimeout(fetchPluginList, 1000);
            } else {
                showNotification(result.message || '插件禁用失败', 'error');
            }
        } catch (error) {
            console.error('Failed to disable plugin:', error);
            showNotification(`禁用插件失败: ${error.message}`, 'error');
        }
    });

    // 初始化
    fetchPluginList();
});