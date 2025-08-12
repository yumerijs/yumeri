import { Logger, Core, Context, ConfigSchema } from 'yumeri'
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import * as fs from 'fs'; // 引入同步 fs 模块
import * as path from 'path';

const logger = new Logger('console');

export interface PluginConfigSchema {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    default?: any;
    description?: string;
    required?: boolean;
    enum?: any[];
    items?: PluginConfigSchema;
    properties?: Record<string, PluginConfigSchema>;
}

export class PluginConfigManager {
    private configCache: Record<string, any> = {};
    private schemaCache: Record<string, Record<string, PluginConfigSchema>> = {};
    private usageCache: Record<string, string> = {};
    private core: Core | null = null;
    private configPath: string = path.join(process.cwd(), 'config.yml');

    /**
     * 设置Core实例
     * @param core Core实例
     */
    setCore(core: Core): void {
        this.core = core;

        // 监听配置变更事件
        if (this.core) {
            this.core.on('config-changed', async () => {
                // 配置文件变更时清除缓存
                this.clearCache();
                // logger.info('Config cache cleared due to config file change');
            });
        }
    }

    /**
     * 获取插件配置
     * @param pluginName 插件名称
     * @returns 插件配置对象
     */
    async getPluginConfig(pluginName: string): Promise<any> {
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        this.configCache[actualPluginName] = this.core?.getPluginConfig(actualPluginName) || {};
        const schema = await this.getPluginSchema(actualPluginName);
        const config = this.configCache[actualPluginName] || {};

        const mergedConfig: any[] = [];

        /**
         * 递归解析配置模式和值
         * @param key 配置键
         * @param value 配置值
         * @param node 配置模式节点
         * @param parentPath 父路径
         */
        function parseSchema(key: string, value: any, node: any, parentPath: string = ''): void {
            const fullPath = parentPath ? `${parentPath}.${key}` : key;
            const description = node.description || '';

            // 处理枚举类型
            if (node.enum) {
                mergedConfig.push({
                    key: fullPath,
                    value,
                    description,
                    type: 'select',
                    options: node.enum
                });
                return;
            }

            // 根据类型处理
            switch (node.type) {
                case 'boolean':
                    mergedConfig.push({
                        key: fullPath,
                        value: !!value,
                        description,
                        type: 'boolean'
                    });
                    break;

                case 'array':
                    // 处理数组类型
                    const arrayValue = Array.isArray(value) ? value :
                        (typeof value === 'string' && value.trim() !== '' ?
                            value.split(',').map(s => s.trim()) : []);

                    // 如果数组项是对象或数组类型，需要特殊处理
                    if (node.items && (node.items.type === 'object' || node.items.type === 'array')) {
                        mergedConfig.push({
                            key: fullPath,
                            value: arrayValue,
                            description,
                            type: 'complex-array',
                            itemType: node.items.type,
                            itemSchema: node.items
                        });
                    } else {
                        // 基本类型数组
                        mergedConfig.push({
                            key: fullPath,
                            value: arrayValue,
                            description,
                            type: 'array',
                            itemType: node.items ? node.items.type : 'string'
                        });
                    }
                    break;

                case 'object':
                    // 处理对象类型
                    if (node.properties) {
                        // 添加对象本身的信息
                        mergedConfig.push({
                            key: fullPath,
                            value: value || {},
                            description,
                            type: 'object-header'
                        });

                        // 递归处理对象的每个属性
                        for (const subKey in node.properties) {
                            const subNode = node.properties[subKey];
                            const subValue = value && typeof value === 'object' ? value[subKey] : undefined;

                            // 使用默认值，如果值不存在
                            const finalSubValue = subValue !== undefined ? subValue :
                                (subNode.default !== undefined ? subNode.default :
                                    (subNode.type === 'object' ? {} :
                                        (subNode.type === 'array' ? [] : '')));

                            parseSchema(subKey, finalSubValue, subNode, fullPath);
                        }
                    } else {
                        // 没有属性定义的对象，作为普通文本处理
                        mergedConfig.push({
                            key: fullPath,
                            value: typeof value === 'object' ? JSON.stringify(value) : value,
                            description,
                            type: 'text'
                        });
                    }
                    break;

                case 'number':
                    // 数字类型
                    mergedConfig.push({
                        key: fullPath,
                        value: typeof value === 'number' ? value :
                            (value !== undefined && value !== null && value !== '' ? Number(value) :
                                (node.default !== undefined ? node.default : 0)),
                        description,
                        type: 'number'
                    });
                    break;

                default:
                    // 默认作为文本处理（包括string类型）
                    mergedConfig.push({
                        key: fullPath,
                        value: value !== undefined && value !== null ? String(value) :
                            (node.default !== undefined ? node.default : ''),
                        description,
                        type: 'text'
                    });
                    break;
            }
        }

        // 处理顶层配置项
        for (const key in schema) {
            const node = schema[key];
            const value = config.hasOwnProperty(key) ? config[key] :
                (node.default !== undefined ? node.default :
                    (node.type === 'object' ? {} :
                        (node.type === 'array' ? [] : '')));

            parseSchema(key, value, node);
        }

        return mergedConfig;
    }

    /**
     * 获取插件配置schema
     * @param pluginName 插件名称
     * @returns 插件配置schema
     */
    async getPluginSchema(pluginName: string): Promise<Record<string, ConfigSchema> | null> {
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

        const isDev = process.env.NODE_ENV === 'development';

        // 开发模式或缓存未命中才加载
        if (isDev || !this.schemaCache[actualPluginName]) {
            try {
                // 清缓存：只在开发模式下清除模块缓存
                if (isDev) {
                    Object.keys(require.cache).forEach(key => {
                        if (key.includes(actualPluginName)) {
                            delete require.cache[key];
                        }
                    });
                }

                let pluginModule: any;

                if (isDev) {
                    try {
                        // 优先尝试直接通过模块名导入（开发环境）
                        pluginModule = require(actualPluginName);
                    } catch {
                        // 如果模块名导入失败，再尝试通过路径导入（开发模式）
                        const pluginPath = path.join(process.cwd(), 'plugins', actualPluginName);
                        if (!fs.existsSync(pluginPath)) return null;

                        pluginModule = require(pluginPath);
                    }
                } else {
                    // 生产环境只能通过模块名导入
                    pluginModule = require(actualPluginName);
                }

                if (pluginModule?.config?.schema) {
                    this.schemaCache[actualPluginName] = pluginModule.config.schema;
                }

            } catch (err) {
                logger.warn(`Failed to load schema for plugin ${actualPluginName}:`, err);
            }
        }

        return this.schemaCache[actualPluginName] || null;
    }

    /**
     * 保存插件配置
     * @param pluginName 插件名称
     * @param config 配置对象
     * @param reload 是否自动重载插件
     * @returns 是否保存成功
     */
    async savePluginConfig(pluginName: string, config: any, reload: boolean = true): Promise<boolean> {
        // 如果插件名以~开头，去掉~前缀保存配置
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        const isDisabled = pluginName.startsWith('~');

        try {
            const configTmpYmlPath = this.configPath + '.tmp';

            const configFileContent = fs.readFileSync(this.configPath, 'utf8');
            let configData: any = yaml.load(configFileContent);

            // 确保plugins对象存在
            configData.plugins = configData.plugins || {};

            // 更新插件配置，保持禁用状态（如果有）
            if (isDisabled) {
                // 如果是禁用状态，保存到~开头的键
                configData.plugins[pluginName] = config;
            } else {
                // 如果是启用状态，保存到正常键
                configData.plugins[actualPluginName] = config;
            }

            // 将配置写入临时文件
            const yamlStr = yaml.dump(configData, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });

            fs.writeFileSync(configTmpYmlPath, yamlStr, 'utf8');

            // 重命名覆盖原文件
            fs.renameSync(configTmpYmlPath, this.configPath);

            // 清除缓存
            this.clearCache();

            // 如果需要重载插件且Core实例存在
            if (reload && this.core && !isDisabled) {
                try {
                    // 重新加载插件
                    await this.core.reloadPlugin(actualPluginName);
                    // logger.info(`Plugin ${actualPluginName} reloaded after config change.`);
                } catch (reloadError) {
                    logger.error(`Failed to reload plugin ${actualPluginName} after config change:`, reloadError);
                }
            }

            return true;
        } catch (error) {
            logger.error(`Failed to save config for plugin ${actualPluginName}:`, error);
            return false;
        }
    }

    /**
     * 获取所有插件名称（包括禁用的插件）
     * @param includeDisabled 是否包含禁用的插件
     * @returns 插件名称数组
     */
    async getAllPluginNames(includeDisabled: boolean = true): Promise<string[]> {
        try {
            const configFileContent = fs.readFileSync(this.configPath, 'utf8');
            const configData: any = yaml.load(configFileContent);

            if (!configData.plugins) {
                return [];
            }

            if (includeDisabled) {
                // 返回所有插件名称，包括禁用的
                return Object.keys(configData.plugins);
            } else {
                // 只返回未禁用的插件名称
                return Object.keys(configData.plugins).filter(name => !name.startsWith('~'));
            }
        } catch (error) {
            logger.error('Failed to get all plugin names:', error);
            return [];
        }
    }

    /**
     * 禁用插件
     * @param pluginName 插件名称
     * @returns 是否禁用成功
     */
    async disablePlugin(pluginName: string): Promise<boolean> {
        // 如果插件名已经以~开头，则已经是禁用状态
        if (pluginName.startsWith('~')) {
            return true;
        }

        try {
            const configTmpYmlPath = this.configPath + '.tmp';

            const configFileContent = fs.readFileSync(this.configPath, 'utf8');
            let configData: any = yaml.load(configFileContent);

            // 确保plugins对象存在
            configData.plugins = configData.plugins || {};

            // 检查插件是否存在
            if (!configData.plugins[pluginName]) {
                logger.error(`Plugin ${pluginName} not found in configuration.`);
                return false;
            }

            // 保存插件配置
            const pluginConfig = configData.plugins[pluginName];

            // 删除原来的插件配置
            delete configData.plugins[pluginName];

            // 添加禁用的插件配置
            configData.plugins[`~${pluginName}`] = pluginConfig;

            // 将配置写入临时文件
            const yamlStr = yaml.dump(configData, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });

            fs.writeFileSync(configTmpYmlPath, yamlStr, 'utf8');

            // 重命名覆盖原文件
            fs.renameSync(configTmpYmlPath, this.configPath);

            // 清除缓存
            this.clearCache();

            // 触发配置变更事件
            if (this.core) {
                await this.core.emit('config-changed', configData);

                // 卸载插件
                try {
                    await this.core.unloadPlugin(pluginName);
                    // logger.info(`Plugin ${pluginName} unloaded after being disabled.`);
                } catch (unloadError) {
                    logger.error(`Failed to unload plugin ${pluginName} after being disabled:`, unloadError);
                }
            }

            return true;
        } catch (error) {
            logger.error(`Failed to disable plugin ${pluginName}:`, error);
            return false;
        }
    }

    /**
     * 启用插件
     * @param pluginName 插件名称
     * @returns 是否启用成功
     */
    async enablePlugin(pluginName: string): Promise<boolean> {
        // 如果插件名不以~开头，则已经是启用状态
        // if (!pluginName.startsWith('~')) {
        //     return true;
        // }

        // const actualPluginName = pluginName.substring(1);
        const actualPluginName = pluginName;
        pluginName = `~${pluginName}`
        // logger.info(`actualPluginName: ${actualPluginName}, `, `pluginName : ${pluginName}`)

        try {
            const configTmpYmlPath = this.configPath + '.tmp';

            const configFileContent = fs.readFileSync(this.configPath, 'utf8');
            let configData: any = yaml.load(configFileContent);

            // 确保plugins对象存在
            configData.plugins = configData.plugins || {};

            // 检查插件是否存在
            if (!configData.plugins[pluginName]) {
                logger.error(`Plugin ${pluginName} not found in configuration.`);
                return false;
            }

            // 保存插件配置
            const pluginConfig = configData.plugins[pluginName];

            // 删除禁用的插件配置
            delete configData.plugins[pluginName];

            // 添加启用的插件配置
            configData.plugins[actualPluginName] = pluginConfig;

            // 将配置写入临时文件
            const yamlStr = yaml.dump(configData, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });

            fs.writeFileSync(configTmpYmlPath, yamlStr, 'utf8');

            // 重命名覆盖原文件
            fs.renameSync(configTmpYmlPath, this.configPath);

            // 清除缓存
            this.clearCache();

            // 触发配置变更事件
            if (this.core) {
                await this.core.emit('config-changed', configData);
                try {
                    await this.core.loadSinglePlugin(actualPluginName)
                } catch (loadError) {
                    logger.error(`Failed to load plugin ${actualPluginName} after being enabled:`, loadError);
                }
            }
            return true;
        } catch (error) {
            logger.error(`Failed to enable plugin ${actualPluginName}:`, error);
            return false;
        }
    }

    /**
     * 检查插件是否被禁用
     * @param pluginName 插件名称
     * @returns 是否被禁用
     */
    getPluginStatus(pluginName: string): string {
        return this.core?.pluginStatus[pluginName] || "DISABLED";
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.configCache = {};
        this.schemaCache = {};
    }

    /**
     * 验证插件配置是否符合schema
     * @param pluginName 插件名称
     * @param config 配置对象
     * @returns 验证结果，如果通过返回true，否则返回错误信息
     */
    async validatePluginConfig(pluginName: string, config: any): Promise<true | string> {
        // 如果插件名以~开头，去掉~前缀获取schema
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

        const schema = await this.getPluginSchema(actualPluginName);
        if (!schema) {
            return true; // 没有schema，视为验证通过
        }

        for (const key in schema) {
            const schemaItem = schema[key];

            // 检查必需项
            if (schemaItem.required && config[key] === undefined) {
                return `Missing required config: ${key}`;
            }

            // 如果配置项存在，检查类型
            if (config[key] !== undefined) {
                const value = config[key];

                // 类型检查
                switch (schemaItem.type) {
                    case 'string':
                        if (typeof value !== 'string') {
                            return `Config ${key} should be string`;
                        }
                        break;
                    case 'number':
                        if (typeof value !== 'number') {
                            return `Config ${key} should be number`;
                        }
                        break;
                    case 'boolean':
                        if (typeof value !== 'boolean') {
                            return `Config ${key} should be boolean`;
                        }
                        break;
                    case 'object':
                        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                            return `Config ${key} should be object`;
                        }
                        break;
                    case 'array':
                        if (!Array.isArray(value)) {
                            return `Config ${key} should be array`;
                        }
                        break;
                }

                // 枚举值检查
                if (schemaItem.enum && !schemaItem.enum.includes(value)) {
                    return `Config ${key} should be one of: ${schemaItem.enum.join(', ')}`;
                }
            }
        }

        return true;
    }
    getPluginUsage(pluginName: string): string {
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev || !this.schemaCache[pluginName]) {
            try {
                if (isDev) {
                    Object.keys(require.cache).forEach(key => {
                        if (key.includes(pluginName)) {
                            delete require.cache[key];
                        }
                    });
                }
                let pluginModule: any;
                if (isDev) {
                    try {
                        pluginModule = require(pluginName);
                    } catch {
                        const pluginPath = path.join(process.cwd(), 'plugins', pluginName);
                        if (!fs.existsSync(pluginPath)) return '';

                        pluginModule = require(pluginPath);
                    }
                } else {
                    pluginModule = require(pluginName);
                }
                if (pluginModule?.usage) {
                    this.usageCache[pluginName] = pluginModule.usage;
                }
            } catch (err) {
                this.usageCache[pluginName] = '';
            }
        }
        return this.usageCache[pluginName];
    }
}

export class ConsoleItem {
    public icon: string;
    public name: string;
    public htmlpath: string;
    public staticpath: string;
    constructor(icon: string, name: string, htmlpath: string, staticpath: string) {
        this.icon = icon;
        this.name = name;
        this.htmlpath = htmlpath;
        this.staticpath = staticpath;
    }
}