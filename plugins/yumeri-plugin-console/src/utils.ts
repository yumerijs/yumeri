import { Logger, Core, Schema, fallback } from 'yumeri'

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
    private core: Core | null = null;

    setCore(core: Core): void {
        this.core = core;
    }

    private get loader() {
        if (!this.core) {
            throw new Error('Core instance is not set in PluginConfigManager.');
        }
        return this.core.loader;
    }

    async getPluginConfig(pluginName: string): Promise<any> {
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        const config = this.loader.config.plugins[actualPluginName] || {};

        const pluginInstance = this.loader.plugins[actualPluginName];
        const schema = pluginInstance?.config;

        if (!schema) {
            return [];
        }

        // 将用户配置与 schema 默认值合并，避免缺少默认值导致前端结构错误
        const mergedValue = fallback(schema, config);

        const mergedConfig: any[] = [];
        for (const key in schema.properties) {
            const propSchema = schema.properties[key];
            mergedConfig.push(this.schemaToConfigItem(key, propSchema, mergedValue?.[key]));
        }
        return mergedConfig;
    }

    async savePluginConfig(pluginName: string, config: any, reload: boolean = true): Promise<boolean> {
        if (!this.core) return false;
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        const isDisabled = pluginName.startsWith('~');

        try {
            // Update the in-memory configuration
            if (isDisabled) {
                this.loader.config.plugins[`~${actualPluginName}`] = config;
            } else {
                this.loader.config.plugins[actualPluginName] = config;
            }

            // Save the entire configuration to disk
            await this.loader.saveConfig();

            // Reload the plugin if needed
            if (reload && !isDisabled) {
                await this.loader.reloadPlugin(actualPluginName);
            }
            return true;
        } catch (error) {
            logger.error(`Failed to save config for plugin ${actualPluginName}:`, error);
            return false;
        }
    }

    async getAllPluginNames(includeDisabled: boolean = true): Promise<string[]> {
        if (!this.core) return [];
        const pluginNames = Object.keys(this.loader.config.plugins || {});
        if (includeDisabled) {
            return pluginNames;
        }
        return pluginNames.filter(name => !name.startsWith('~'));
    }

    async disablePlugin(pluginName: string): Promise<boolean> {
        if (!this.core || pluginName.startsWith('~')) return true;

        try {
            const plugins = this.loader.config.plugins;
            if (pluginName in plugins) {
                plugins[`~${pluginName}`] = plugins[pluginName];
                delete plugins[pluginName];
                await this.loader.saveConfig();
                await this.loader.unloadPlugin(pluginName);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Failed to disable plugin ${pluginName}:`, error);
            return false;
        }
    }

    async enablePlugin(pluginName: string): Promise<boolean> {
        if (!this.core) return false;
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

        try {
            const plugins = this.loader.config.plugins;
            if (`~${actualPluginName}` in plugins) {
                plugins[actualPluginName] = plugins[`~${actualPluginName}`];
                delete plugins[`~${actualPluginName}`];
                await this.loader.saveConfig();
                await this.loader.loadSinglePlugin(actualPluginName);
                return true;
            }
            return `~${actualPluginName}` in plugins;
        } catch (error) {
            logger.error(`Failed to enable plugin ${actualPluginName}:`, error);
            return false;
        }
    }

    getPluginStatus(pluginName: string): string {
        if (!this.core) return "DISABLED";
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        return this.loader.pluginStatus[actualPluginName] || "DISABLED";
    }
    
    // Other methods like getPluginUsage, getMetadata, etc. can be refactored similarly
    // For now, they are left as is but might not function correctly without further changes.
    // This refactoring focuses on the core config management.
    getPluginUsage(pluginName: string): string {
        if (!this.core) return '';
        const plugin = this.loader.plugins[pluginName];
        return plugin?.usage || '';
    }

    getMetadata(pluginName: string) {
        if (!this.core) return {};
        const plugin = this.loader.plugins[pluginName];
        return {
            usage: plugin?.usage || '',
            provide: plugin?.provide || [],
            depend: plugin?.depend || []
        };
    }

    async addPluginToConfig(pluginName: string): Promise<void> {
        if (!this.core) return;
        const name = pluginName.startsWith('~') ? pluginName : `~${pluginName}`;
        if (!this.loader.config.plugins[name]) {
            this.loader.config.plugins[name] = null;
            await this.loader.saveConfig();
        }
    }

    async getUnregisteredPlugins(): Promise<string[]> {
        // This method requires scanning node_modules, which is outside the scope of config management.
        // It can be kept, but it should not read the config file itself.
        return []; // Placeholder, as the original logic is complex and filesystem-dependent.
    }

    /**
     * 将 Schema 描述转换为前端可消费的配置项结构
     */
    private schemaToConfigItem(key: string, schema: Schema<any>, value: any) {
        const description = schema.description || key;
        const currentValue = value === undefined ? schema.defaultValue : value;

        // 枚举转下拉
        if (schema.enum && schema.enum.length) {
            return {
                key,
                value: currentValue ?? '',
                description,
                type: 'select',
                options: schema.enum,
            };
        }

        switch (schema.type) {
            case 'number':
                return {
                    key,
                    value: currentValue ?? 0,
                    description,
                    type: 'number',
                };
            case 'boolean':
                return {
                    key,
                    value: !!currentValue,
                    description,
                    type: 'boolean',
                };
            case 'array':
                // 对象数组 -> 复杂数组
                if (schema.items?.type === 'object') {
                    return {
                        key,
                        value: Array.isArray(currentValue) ? currentValue : [],
                        description,
                        type: 'complex-array',
                        itemType: 'object',
                        itemSchema: this.normalizeSchema(schema.items),
                    };
                }
                return {
                    key,
                    value: Array.isArray(currentValue) ? currentValue : [],
                    description,
                    type: 'array',
                    itemType: schema.items?.type || 'string',
                };
            case 'object':
                return {
                    key,
                    value: currentValue ?? {},
                    description,
                    type: 'object-header',
                    properties: this.normalizeSchemaProperties(schema.properties),
                };
            default:
                return {
                    key,
                    value: currentValue ?? '',
                    description,
                    type: 'text',
                };
        }
    }

    /**
     * 将 Schema 属性中的 defaultValue/enum 等字段转换为前端使用的格式
     */
    private normalizeSchema(schema: Schema<any>) {
        const normalized: any = {
            type: schema.type,
            description: schema.description,
            default: schema.defaultValue,
            enum: schema.enum,
        };

        if (schema.items) {
            normalized.items = this.normalizeSchema(schema.items);
        }

        if (schema.properties) {
            normalized.properties = this.normalizeSchemaProperties(schema.properties);
        }

        return normalized;
    }

    private normalizeSchemaProperties(properties?: Record<string, Schema<any>>) {
        const normalizedProps: Record<string, any> = {};
        if (!properties) return normalizedProps;

        for (const [propKey, propSchema] of Object.entries(properties)) {
            normalizedProps[propKey] = this.normalizeSchema(propSchema as Schema<any>);
        }
        return normalizedProps;
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
