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
        logger.info('Config cache cleared due to config file change');
      });
    }
  }

  /**
   * 获取插件配置
   * @param pluginName 插件名称
   * @returns 插件配置对象
   */
  async getPluginConfig(pluginName: string): Promise<any> {
    // 如果插件名以~开头，去掉~前缀获取配置
    const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

    // 开发模式下或强制刷新时，不使用缓存
    if (process.env.NODE_ENV === 'development' || !this.configCache[actualPluginName]) {
      try {
        const configFileContent = fs.readFileSync(this.configPath, 'utf8');
        const configData: any = yaml.load(configFileContent);

        if (configData?.plugins?.[actualPluginName]) {
          this.configCache[actualPluginName] = configData.plugins[actualPluginName];
        } else if (configData?.plugins?.[pluginName]) {
          // 检查是否有禁用版本的配置
          this.configCache[actualPluginName] = configData.plugins[pluginName];
        } else {
          this.configCache[actualPluginName] = null;
        }
      } catch (error) {
        logger.error(`Failed to get config for plugin ${actualPluginName}:`, error);
        return null;
      }
    }
    const schema = await this.getPluginSchema(actualPluginName)
    const config = this.configCache[actualPluginName] || {}
    
    const mergedConfig: { key: string, value: any, description?: string }[] = []
    
    for (const key in schema) {
      const value = config.hasOwnProperty(key) ? config[key] : (schema[key].default ?? '')
      const description = schema[key].description || ''
      mergedConfig.push({
        key,
        value,
        description
      })
    }
    return mergedConfig
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
          logger.info(`Plugin ${actualPluginName} reloaded after config change.`);
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
          logger.info(`Plugin ${pluginName} unloaded after being disabled.`);
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
            await plugin.apply(new Context(this.core, pluginName), config);
            logger.info(`Plugin ${actualPluginName} loaded after being enabled.`);
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

export async function apply(ctx: Context, config: Config) {
  // 创建插件配置管理器
  const configManager = new PluginConfigManager();
  const core = ctx.getCore();
  configManager.setCore(core);

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
        // 处理登录请求
        if (param.path === '/api/loginpass') {
          if (param.username === config.get<string>('adminname', 'admin') && param.password === config.get<string>('adminpassword', 'admin')) {
            // 登录成功
            loginstatus[session.sessionid] = config.get<string>('adminname', 'admin');
            session.body = JSON.stringify({ success: '登录成功' });
            session.setMime('json');
          } else {
            // 登录失败
            session.body = JSON.stringify({ error: `账号或密码错误` });
            session.setMime('json');
            logger.info(param.username + '尝试登录');
          }
          return;
        }

        // 获取插件配置
        if (param.path === '/api/config') {
          const pluginName = param.name;
          if (!pluginName) {
            session.body = JSON.stringify({ error: 'Plugin name is required.' });
            session.setMime('json');
            return;
          }

          // 获取插件配置
          const pluginConfig = await configManager.getPluginConfig(pluginName);

          if (pluginConfig !== null && typeof pluginConfig === 'object' && !Array.isArray(pluginConfig)) {
            // 将对象格式转换为数组格式以适应前端
            const pluginConfigArray = Object.keys(pluginConfig).map(key => ({ [key]: pluginConfig[key] }));
            session.body = JSON.stringify(pluginConfigArray);
          } else if (pluginConfig === null) {
            session.body = JSON.stringify({ error: `No configuration found for plugin ${pluginName}.` });
          } else {
            session.body = JSON.stringify(pluginConfig);
          }

          session.setMime('json');
          return;
        }

        // 获取插件配置schema
        if (param.path === '/api/schema') {
          const pluginName = param.name;
          if (!pluginName) {
            session.body = JSON.stringify({ error: 'Plugin name is required.' });
            session.setMime('json');
            return;
          }

          // 获取插件配置schema
          const pluginSchema = await configManager.getPluginSchema(pluginName);

          if (pluginSchema) {
            session.body = JSON.stringify(pluginSchema);
          } else {
            session.body = JSON.stringify({ error: `No schema found for plugin ${pluginName}.` });
          }

          session.setMime('json');
          return;
        }

        // 保存插件配置
        if (param.path === '/api/saveconfig') {
          const pluginName = param.name;
          const content = param.content;
          const reload = param.reload !== 'false'; // 默认为true
          
          if (!pluginName || !content) {
            session.body = JSON.stringify({ error: 'Plugin name and content are required.' });
            session.setMime('json');
            return;
          }
          
          try {
            const newConfigArray = JSON.parse(content);
            
            // 验证newConfigArray是否是数组
            if (!Array.isArray(newConfigArray)) {
              session.body = JSON.stringify({ error: 'Content must be a valid JSON array.' });
              session.setMime('json');
              return;
            }
            
            // 将前端发送的数组格式转换为后端期望的对象格式
            const newConfigObject: { [key: string]: any } = {};
            for (const item of newConfigArray) {
              // 验证数组里的每个元素是否是object且只有一个key-value对
              const keys = Object.keys(item);
              if (typeof item !== 'object' || item === null || keys.length !== 1) {
                session.body = JSON.stringify({ error: 'Each item in the array must be a valid JSON object with a single key-value pair.' });
                session.setMime('json');
                return;
              }
              const key = keys[0];
              newConfigObject[key] = item[key];
            }
            
            // 验证配置是否符合schema
            const validationResult = await configManager.validatePluginConfig(pluginName, newConfigObject);
            if (validationResult !== true) {
              session.body = JSON.stringify({ error: `Configuration validation failed: ${validationResult}` });
              session.setMime('json');
              return;
            }
            
            // 保存插件配置
            const success = await configManager.savePluginConfig(pluginName, newConfigObject, reload);
            
            if (success) {
              session.body = JSON.stringify({ success: `Configuration for plugin ${pluginName} updated.` });
            } else {
              session.body = JSON.stringify({ error: `Failed to update configuration for plugin ${pluginName}.` });
            }
            
            session.setMime('json');
            return;
          } catch (error: any) {
            session.body = JSON.stringify({ error: `Error processing config update: ${error.message}` });
            logger.error('Error processing config update:', error);
            session.setMime('json');
            return;
          }
        }

        // 获取所有插件名称
        if (param.path === '/api/plugins') {
          const includeDisabled = param.includeDisabled === 'true';

          // 获取所有插件名称
          const pluginNames = await configManager.getAllPluginNames(includeDisabled);

          session.body = JSON.stringify(pluginNames);
          session.setMime('json');
          return;
        }

        // 禁用插件
        if (param.path === '/api/disableplugin') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ error: 'Plugin name is required.' });
            session.setMime('json');
            return;
          }

          // 禁用插件
          const disableResult = await configManager.disablePlugin(pluginName);

          if (disableResult) {
            session.body = JSON.stringify({ success: `Plugin ${pluginName} disabled successfully.` });
          } else {
            session.body = JSON.stringify({ error: `Failed to disable plugin ${pluginName}.` });
          }

          session.setMime('json');
          return;
        }

        // 启用插件
        if (param.path === '/api/enableplugin') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ error: 'Plugin name is required.' });
            session.setMime('json');
            return;
          }

          // 启用插件
          const enableResult = await configManager.enablePlugin(pluginName);

          if (enableResult) {
            session.body = JSON.stringify({ success: `Plugin ${pluginName.startsWith('~') ? pluginName.substring(1) : pluginName} enabled successfully.` });
          } else {
            session.body = JSON.stringify({ error: `Failed to enable plugin ${pluginName}.` });
          }

          session.setMime('json');
          return;
        }

        // 检查插件状态
        if (param.path === '/api/pluginstatus') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ error: 'Plugin name is required.' });
            session.setMime('json');
            return;
          }

          // 检查插件是否被禁用
          const isDisabled = await configManager.isPluginDisabled(pluginName);

          session.body = JSON.stringify({ disabled: isDisabled });
          session.setMime('json');
          return;
        }

        // 未知API请求
        session.body = JSON.stringify({ error: 'Unknown API endpoint.' });
        session.setMime('json');
        return;
      }

      // 处理静态文件请求
      if (param && param.path) {
        // 获取当前文件的目录
        const __dirname = path.dirname(__filename);

        // 静态文件目录
        const staticDir = path.join(__dirname, '..', 'static');

        // 默认页面
        if (param.path === '/') {
          param.path = '/index.html';
        }
        if (!param.path.includes('.')) {
          param.path += '.html';
        }

        // 构建文件路径
        const filePath = path.join(staticDir, param.path);

        // 检查文件是否存在
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          // 读取文件内容
          const content = fs.readFileSync(filePath, 'utf8');

          // 设置MIME类型
          const ext = path.extname(filePath).toLowerCase();
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
          }

          // 返回文件内容
          session.body = content;
          return;
        }
      }

      // 默认返回404
      session.body = '<h1>404 Not Found</h1>';
      session.setMime('html');
    });

  // 注册控制台组件
  ctx.registerComponent('console', {
    configManager
  });

  logger.info('Console plugin initialized');
}