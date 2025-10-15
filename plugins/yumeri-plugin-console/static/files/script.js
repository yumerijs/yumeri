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

    let currentPluginName = null; // 用于存储当前选中的插件名称
    let currentPluginStatus = null; // 用于存储当前插件状态

    // 初始隐藏启用/禁用按钮
    enableButton.style.display = 'none';
    disableButton.style.display = 'none';

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

    // 获取插件状态
    async function getPluginStatus(pluginName) {
        try {
            const cleanPluginName = pluginName.replace(/^~/, '');
            const response = await fetch(`/api/console/pluginstatus?name=${cleanPluginName}`);
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
            for (const pluginName of plugins) {
                const listItem = document.createElement('li');

                // 创建状态指示器
                const statusIndicator = document.createElement('span');
                statusIndicator.className = 'plugin-status';

                // 创建插件名称元素
                const nameSpan = document.createElement('span');

                // 去掉~符号显示名称
                const cleanPluginName = pluginName.replace(/^~/, '');
                nameSpan.textContent = cleanPluginName;

                // 获取插件状态
                const status = await getPluginStatus(pluginName);

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
                listItem.dataset.plugin = cleanPluginName; // 存储清理后的插件名
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

    // 加载插件配置
    async function loadPluginConfiguration(pluginName, pluginStatus) {
        try {
            currentPluginName = pluginName;
            currentPluginStatus = pluginStatus;
            updatePluginStatus();

            const response = await fetch(`/api/console/config?name=${pluginName}`);
            let usage = await fetch(`/api/console/pluginusage?name=${pluginName}`);
            if (!usage.ok) {
                throw new Error(`HTTP error! status: ${usage.status}`);
            }
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const config = await response.json();
            pluginUsage.innerHTML = '';
            usage = await usage.json();
            configurationArea.innerHTML = '';

            // 渲染配置项
            if (Array.isArray(config)) {
                renderConfigItems(config);
            } else if (config.error) {
                configurationArea.innerHTML = `<p>${config.error}</p>`;
            } else {
                console.warn('Invalid configuration format received:', config);
                configurationArea.innerHTML = '<p>Received invalid configuration format from server.</p>';
            }
            if (usage.usage) { pluginUsage.innerHTML = usage.usage; }
            pluginTitle.textContent = `${pluginName} 配置`;

            // 绑定事件监听器
            bindEventListeners();
        } catch (error) {
            console.error('Failed to load plugin configuration:', error);
            configurationArea.innerHTML = `<p>Failed to load configuration: ${error.message}</p>`;
        }
    }

    // 渲染配置项
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

    // 渲染文本输入框
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

    // 渲染数字输入框
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

    // 渲染布尔输入框
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

    // 渲染选择框
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

    // 渲染基本数组输入
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

        // 渲染现有数组项
        if (Array.isArray(item.value)) {
            item.value.forEach(value => {
                const arrayItem = createArrayItem(value, item.itemType || 'string');
                arrayContainer.appendChild(arrayItem);
            });
        }

        // 添加新项按钮
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

    // 创建数组项
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

    // 渲染复杂数组输入（数组项为对象或嵌套数组）
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

        // 渲染现有数组项
        if (Array.isArray(item.value)) {
            item.value.forEach((value, index) => {
                const complexItem = createComplexArrayItem(item.key, index, value, item.itemSchema);
                arrayContainer.appendChild(complexItem);
            });
        }

        // 添加新项按钮
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

    // 创建复杂数组项
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

        // 根据itemSchema类型渲染内容
        if (itemSchema.type === 'object' && itemSchema.properties) {
            // 对象类型，渲染其属性
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
            // 数组类型，递归渲染
            const arrayItem = {
                key: `${arrayKey}[${index}]`,
                value: Array.isArray(value) ? value : [],
                description: itemSchema.description || `项 ${index + 1}`,
                type: 'array',
                itemType: itemSchema.items.type
            };

            renderArrayInput(content, arrayItem);
        } else {
            // 基本类型，渲染单个输入框
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

    // 渲染对象头部
    function renderObjectHeader(container, item) {
        const header = document.createElement('div');
        header.className = 'object-header';
        header.textContent = item.description || item.key;

        const objectContainer = document.createElement('div');
        objectContainer.className = 'object-container';
        objectContainer.dataset.key = item.key;
        objectContainer.dataset.type = 'object';

        container.appendChild(header);
        container.appendChild(objectContainer);
    }

    // 绑定事件监听器
    function bindEventListeners() {
        // 添加数组项按钮
        document.querySelectorAll('[data-action="add-array-item"]').forEach(button => {
            button.addEventListener('click', function () {
                const targetKey = this.dataset.target;
                const arrayContainer = document.querySelector(`.array-container[data-key="${targetKey}"]`);
                const itemType = arrayContainer.dataset.itemType || 'string';

                const newItem = createArrayItem('', itemType);
                arrayContainer.appendChild(newItem);
            });
        });

        // 添加复杂数组项按钮
        document.querySelectorAll('[data-action="add-complex-array-item"]').forEach(button => {
            button.addEventListener('click', function () {
                const targetKey = this.dataset.target;
                const arrayContainer = document.querySelector(`.array-container[data-key="${targetKey}"]`);
                const itemSchema = JSON.parse(arrayContainer.dataset.itemSchema);
                const currentItems = arrayContainer.querySelectorAll('.complex-array-item');
                const newIndex = currentItems.length;

                // 创建默认值
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

                // 重新绑定事件
                bindEventListeners();
            });
        });

        // 使用事件委托处理删除按钮
        document.addEventListener('click', function (e) {
            if (e.target.dataset.action === 'remove-array-item') {
                e.target.closest('.array-item').remove();
            } else if (e.target.dataset.action === 'remove-complex-array-item') {
                e.target.closest('.complex-array-item').remove();
            }
        });
    }

    // 收集配置数据
    function collectConfigData() {
        const configData = {};

        // 处理基本输入字段
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

        // 处理基本数组
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

        // 处理复杂数组
        document.querySelectorAll('.array-container[data-type="complex-array"]').forEach(container => {
            const key = container.dataset.key;
            const items = [];

            container.querySelectorAll('.complex-array-item').forEach(complexItem => {
                const index = complexItem.dataset.index;
                let itemData = {};

                // 收集复杂项中的所有输入
                complexItem.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                    const inputKey = input.dataset.key;
                    // 从inputKey中提取属性名
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

                        // 处理嵌套属性
                        if (propKey.includes('.')) {
                            deepMergeObject(itemData, propKey, value);
                        } else {
                            itemData[propKey] = value;
                        }
                    }
                });

                // 处理嵌套数组
                complexItem.querySelectorAll('.array-container').forEach(nestedArray => {
                    const nestedKey = nestedArray.dataset.key;
                    // 从nestedKey中提取属性名
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

                        // 处理嵌套路径
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

    // 更新插件状态UI
    function updatePluginStatus() {
        if (currentPluginStatus === 'DISABLED') {
            pluginStatus.innerHTML = '<p style="color: #ccc;">当前状态: 未启用</p>';
            enableButton.style.display = 'inline-block';
            disableButton.style.display = 'none';
        } else if (currentPluginStatus === 'PENDING') {
            pluginStatus.innerHTML = '<p style="color: #f44336;">当前状态: 依赖未满足</p>';
            enableButton.style.display = 'none';
            disableButton.style.display = 'inline-block';
        } else { // ENABLE
            pluginStatus.innerHTML = '<p style="color: #4CAF50;">当前状态: 已启用</p>';
            enableButton.style.display = 'none';
            disableButton.style.display = 'inline-block';
        }
    }

    // 保存配置按钮事件
    saveButton.addEventListener('click', async function () {
        if (!currentPluginName) {
            showNotification('请先选择一个插件', 'error');
            return;
        }

        try {
            const configData = collectConfigData();
            const jsonContent = JSON.stringify(configData);
            console.log('Saving configuration:', jsonContent);
            // 构建保存配置的URL，并确保内容被URIComponent编码
            const url = `/api/console/saveconfig?name=${currentPluginName}&config=${encodeURIComponent(jsonContent)}`;
            const response = await fetch(url);

            if (!response.ok) {
                // 如果HTTP响应不成功，尝试解析错误信息
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            showNotification(result.success ? '配置保存成功' : result.message, result.success ? true : false);

            // 如果保存成功，延迟刷新插件列表
            if (result.success) {
                setTimeout(fetchPluginList, 1000);
            }

        } catch (error) {
            console.error('Failed to save configuration:', error);
            showNotification(`保存配置失败: ${error.message}`, 'error');
        }
    });

    // 启用插件按钮事件
    enableButton.addEventListener('click', async function () {
        if (!currentPluginName || currentPluginStatus !== 'DISABLED') {
            showNotification('当前插件不需要启用', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/console/enableplugin?name=${currentPluginName}`);

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                showNotification('插件启用成功', 'success');

                // 更新当前插件状态
                currentPluginStatus = 'ENABLED';
                updatePluginStatus();

                // 刷新插件列表
                setTimeout(fetchPluginList, 1000);

                // 重新加载插件配置
                setTimeout(() => loadPluginConfiguration(currentPluginName, currentPluginStatus), 1500);
            } else {
                showNotification(result.message || '插件启用失败', 'error');
            }
        } catch (error) {
            console.error('Failed to enable plugin:', error);
            showNotification(`启用插件失败: ${error.message}`, 'error');
        }
    });

    // 禁用插件按钮事件
    disableButton.addEventListener('click', async function () {
        if (!currentPluginName || currentPluginStatus === 'DISABLED') {
            showNotification('当前插件不需要禁用', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/console/disableplugin?name=${currentPluginName}`);

            if (!response.ok) {
                const errorResult = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
                throw new Error(errorResult.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                showNotification('插件禁用成功', 'success');

                // 更新当前插件状态
                currentPluginStatus = 'DISABLED';
                updatePluginStatus();

                // 刷新插件列表
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