import { Core, Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as fs from 'fs'; // 引入同步 fs 模块
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml'; // 引入 js-yaml

const logger = new Logger("console");

export const depend = ['server']; // 需要的服务
export const provide = ['console']; // 提供的服务

/**
 * 控制台插件配置接口
 */
export interface ConsoleConfig {
  /**
   * 监听路径（命令）
   * @default "console"
   */
  path: string;

  /**
   * 管理员用户名
   * @default "admin"
   */
  adminname: string;

  /**
   * 管理员密码
   * @default "admin"
   */
  adminpassword: string;
}

/**
 * 控制台插件配置schema
 */
export const config = {
  schema: {
    path: {
      type: 'string',
      default: 'console',
      description: '监听路径（命令）'
    },
    adminname: {
      type: 'string',
      default: 'admin',
      description: '管理员用户名'
    },
    adminpassword: {
      type: 'string',
      default: 'admin',
      description: '管理员密码'
    }
  } as Record<string, ConfigSchema>
};

// 登录状态记录
let loginstatus: Record<string, string> = {};

/**
 * 插件配置类型定义接口
 */
export interface PluginConfigSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  default?: any;
  description?: string;
  required?: boolean;
  enum?: any[];
  items?: PluginConfigSchema; // 用于数组类型的子项
  properties?: Record<string, PluginConfigSchema>; // 用于对象类型的属性
}

/**
 * 插件配置管理器
 */
class PluginConfigManager {
  private configCache: Record<string, any> = {};
  private schemaCache: Record<string, Record<string, PluginConfigSchema>> = {};
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

    if (process.env.NODE_ENV === 'development' || !this.configCache[actualPluginName]) {
      try {
        const configFileContent = fs.readFileSync(this.configPath, 'utf8');
        const configData: any = yaml.load(configFileContent);

        if (configData?.plugins?.[actualPluginName]) {
          this.configCache[actualPluginName] = configData.plugins[actualPluginName];
        } else if (configData?.plugins?.[pluginName]) {
          this.configCache[actualPluginName] = configData.plugins[pluginName];
        } else {
          this.configCache[actualPluginName] = null;
        }
      } catch (error) {
        logger.error(`Failed to get config for plugin ${actualPluginName}:`, error);
        return null;
      }
    }

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
    // 如果插件名以~开头，去掉~前缀获取schema
    const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

    // 开发模式下不使用缓存
    if (process.env.NODE_ENV === 'development' || !this.schemaCache[actualPluginName]) {
      try {
        // 尝试从插件模块中获取配置schema
        const pluginPath = path.join(process.cwd(), 'plugins', actualPluginName);

        // 检查插件目录是否存在
        if (!fs.existsSync(pluginPath)) {
          return null;
        }

        // 尝试加载插件的配置schema
        try {
          // 清除模块缓存以确保获取最新的配置
          Object.keys(require.cache).forEach(key => {
            if (key.includes(actualPluginName)) {
              delete require.cache[key];
            }
          });

          // 尝试导入插件模块
          const pluginModule = require(pluginPath);

          // 检查是否有config.schema导出
          if (pluginModule.config?.schema) {
            this.schemaCache[actualPluginName] = pluginModule.config.schema;
          }
        } catch (importError) {
          logger.warn(`Failed to import plugin module ${actualPluginName}:`, importError);
        }
      } catch (error) {
        logger.error(`Failed to get schema for plugin ${actualPluginName}:`, error);
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
          // 触发配置变更事件
          await this.core.emit('config-changed', configData);

          // 重新加载插件
          await this.core.reloadPlugin(actualPluginName, this.core);
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
          await this.core.unloadPluginAndEmit(pluginName, this.core);
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
    if (!pluginName.startsWith('~')) {
      return true;
    }

    const actualPluginName = pluginName.substring(1);

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

        // 加载插件
        try {
          // 获取插件配置
          const config = await this.core.getPluginConfig(actualPluginName);

          // 加载插件
          const plugin = await this.core.pluginLoader.load(actualPluginName);

          // 应用插件
          if (plugin && plugin.apply) {
            await plugin.apply(new Context(this.core, actualPluginName), config);
            // logger.info(`Plugin ${actualPluginName} loaded after being enabled.`);
          }
        } catch (loadError) {
          logger.error(`Failed to load plugin ${actualPluginName} after being enabled:`, loadError);
        }
      }

      return true;
    } catch (error) {
      logger.error(`Failed to enable plugin ${pluginName}:`, error);
      return false;
    }
  }

  /**
   * 检查插件是否被禁用
   * @param pluginName 插件名称
   * @returns 是否被禁用
   */
  async isPluginDisabled(pluginName: string): Promise<boolean> {
    // 如果插件名以~开头，则是禁用状态
    if (pluginName.startsWith('~')) {
      return true;
    }

    try {
      const configFileContent = fs.readFileSync(this.configPath, 'utf8');
      const configData: any = yaml.load(configFileContent);

      // 确保plugins对象存在
      configData.plugins = configData.plugins || {};

      // 检查是否存在禁用的插件配置
      return configData.plugins[`~${pluginName}`] !== undefined;
    } catch (error) {
      logger.error(`Failed to check if plugin ${pluginName} is disabled:`, error);
      return false;
    }
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
}

class ConsoleItem {
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

export async function apply(ctx: Context, config: Config) {
  // 创建插件配置管理器
  const configManager = new PluginConfigManager();
  const core = ctx.getCore();
  configManager.setCore(core);
  let consoleitem: Record<string, ConsoleItem> = {};
  const staticDir = path.join(__dirname, '..', 'static');
  consoleitem['config'] = new ConsoleItem('fa-cog', '配置', path.join(staticDir, 'config.html'), path.join(staticDir, 'files'));
  // 注册控制台命令
  ctx.command(config.get<string>('path', 'console'))
    .action(async (session: Session, param?: any) => {
      session.setMime('html'); // 默认设置为 HTML 类型

      // 检查登录状态
      if (param && param.path && !param.path.startsWith('/login') && !loginstatus[session.sessionid] && !param.path.startsWith('/api/loginpass')) {
        session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>请先登录</title></head><body><script>window.onload = function() {alert("请先登录");window.location.href = "/${config.get<string>('path', 'console')}/login";};</script><p>正在重定向</p></body></html>`;
        return;
      }

      // 处理API请求
      if (param && param.path && param.path.startsWith('/api/')) {
        // 设置MIME类型为JSON
        session.setMime('json');

        // 处理登录请求
        if (param.path === '/api/loginpass') {
          if (param.username === config.get<string>('adminname', 'admin') && param.password === config.get<string>('adminpassword', 'admin')) {
            loginstatus[session.sessionid] = param.username;
            session.body = JSON.stringify({ success: true });
          } else {
            session.body = JSON.stringify({ success: false, message: '用户名或密码错误' });
          }
          return;
        }

        // 处理获取插件列表请求
        if (param.path === '/api/plugins') {
          const includeDisabled = param.includeDisabled === 'true';
          const plugins = await configManager.getAllPluginNames(includeDisabled);
          session.body = JSON.stringify(plugins);
          return;
        }

        // 处理获取插件配置请求
        if (param.path === '/api/config') {
          const pluginName = param.name;
          if (!pluginName) {
            session.body = JSON.stringify({ success: false, message: '缺少插件名称参数' });
            return;
          }

          const config = await configManager.getPluginConfig(pluginName);
          session.body = JSON.stringify(config);
          return;
        }

        // 处理保存插件配置请求
        if (param.path === '/api/saveconfig') {
          const pluginName = param.name;
          const configData = param.config;
          const reload = param.reload !== 'false';

          if (!pluginName) {
            session.body = JSON.stringify({ success: false, message: '缺少插件名称参数' });
            return;
          }

          if (!configData) {
            session.body = JSON.stringify({ success: false, message: '缺少配置数据' });
            return;
          }

          try {
            // 解析配置数据
            const parsedConfig = typeof configData === 'string' ? JSON.parse(configData) : configData;

            // 保存配置
            const success = await configManager.savePluginConfig(pluginName, parsedConfig, reload);

            if (success) {
              session.body = JSON.stringify({ success: true, message: '配置保存成功' });
            } else {
              session.body = JSON.stringify({ success: false, message: '配置保存失败' });
            }
          } catch (error) {
            session.body = JSON.stringify({ success: false, message: `配置保存失败: ${error}` });
          }
          return;
        }

        // 处理禁用插件请求
        if (param.path === '/api/disableplugin') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ success: false, message: '缺少插件名称参数' });
            return;
          }

          const success = await configManager.disablePlugin(pluginName);

          if (success) {
            session.body = JSON.stringify({ success: true, message: '插件禁用成功' });
          } else {
            session.body = JSON.stringify({ success: false, message: '插件禁用失败' });
          }
          return;
        }

        // 处理启用插件请求
        if (param.path === '/api/enableplugin') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ success: false, message: '缺少插件名称参数' });
            return;
          }

          const success = await configManager.enablePlugin(pluginName);

          if (success) {
            session.body = JSON.stringify({ success: true, message: '插件启用成功' });
          } else {
            session.body = JSON.stringify({ success: false, message: '插件启用失败' });
          }
          return;
        }
        if (param.path === '/api/consoleitem') {
          session.setMime('json');
          // 使用 Object.entries 来同时获取键 (key) 和值 (item)
          const resultArray = Object.entries(consoleitem)
            .map(([key, item]) => { // 解构赋值，key 是 record 的键名（例如 "settings"），item 是 ConsoleItem 实例
              const itemIcon = item.icon;
              const itemName = item.name; // 这里仍然使用 ConsoleItem 内部的 name 属性作为显示名称
              
              // 路径拼接：使用 record 的键名 (key)
              const itemPath = `/${config.get<string>('path', 'console')}/${key}`; 
        
              return {
                item: itemIcon,
                name: itemName,
                path: itemPath
              };
            });
          const jsonOutput = JSON.stringify(resultArray, null, 2);
          session.body = jsonOutput;
          return;
        }

        // 未知API请求
        session.body = JSON.stringify({ success: false, message: '未知API请求' });
        return;
      }

      // 处理静态文件请求
      if (param && param.path) {
        // 处理登录页面请求
        if (param.path === '/login') {
          const loginHtmlPath = path.join(staticDir, 'login.html');

          if (fs.existsSync(loginHtmlPath)) {
            session.body = fs.readFileSync(loginHtmlPath, 'utf8');
            return;
          }
        }
        // 处理控制台主页请求
        if (param.path === '/home') {
          const consoleHtmlPath = path.join(staticDir, 'home.html');

          if (fs.existsSync(consoleHtmlPath)) {
            session.body = fs.readFileSync(consoleHtmlPath, 'utf8');
            return;
          }
        }

        // 处理其他consoleitem页面请求
        if (consoleitem[param.path.split('/')[1]]) {
          if (param.path.split('/').length === 2) {
            if (fs.existsSync(consoleitem[param.path.split('/')[1]].htmlpath)) {
              session.body = fs.readFileSync(consoleitem[param.path.split('/')[1]].htmlpath, 'utf8');
              return;
            }
          } else {
            if (fs.existsSync(consoleitem[param.path.split('/')[1]].staticpath + '/' + param.path.split('/').slice(2).join('/'))) {
              const filePath = consoleitem[param.path.split('/')[1]].staticpath + '/' + param.path.split('/').slice(2).join('/');
              if (filePath.startsWith(staticDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();

                // 根据文件扩展名设置MIME类型
                switch (ext) {
                  case '.html':
                    session.setMime('html');
                    break;
                  case '.css':
                    session.setMime('css');
                    break;
                  case '.js':
                    session.setMime('javascript');
                    break;
                  case '.json':
                    session.setMime('json');
                    break;
                  case '.png':
                    session.setMime('png');
                    break;
                  case '.jpg':
                  case '.jpeg':
                    session.setMime('jpeg');
                    break;
                  case '.gif':
                    session.setMime('gif');
                    break;
                  case '.svg':
                    session.setMime('svg');
                    break;
                  default:
                    session.setMime('text');
                    break;
                }
                session.body = fs.readFileSync(filePath, ext.match(/\.(png|jpg|jpeg|gif|svg)$/) ? null : 'utf8');
                return;
              }
            }
          }
        }
      }

      // 默认重定向到主页面
      session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>重定向</title></head><body><script>window.location.href = "/${config.get<string>('path', 'console')}/home";</script><p>正在重定向</p></body></html>`;
    });

  const operateconsole = {
    addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => {
      consoleitem[name] = new ConsoleItem(icon, displayname, htmlpath, staticpath);
    },
    removeconsoleitem: (name: string) => {
      delete consoleitem[name];
    },
    getloginstatus: (session: Session) => {
      if (loginstatus[session.sessionid]) {
        return true;
      } else {
        return false;
      }
    }
  }
  ctx.registerComponent('console', operateconsole);
}
