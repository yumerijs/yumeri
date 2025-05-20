import { Core, Config, Session, Logger, ConfigSchema } from 'yumeri';
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
  
  /**
   * 获取插件配置
   * @param pluginName 插件名称
   * @returns 插件配置对象
   */
  async getPluginConfig(pluginName: string): Promise<any> {
    if (this.configCache[pluginName]) {
      return this.configCache[pluginName];
    }
    
    try {
      const configYmlPath = path.join(process.cwd(), 'config.yml');
      const configFileContent = fs.readFileSync(configYmlPath, 'utf8');
      const configData: any = yaml.load(configFileContent);
      
      if (configData?.plugins?.[pluginName]) {
        this.configCache[pluginName] = configData.plugins[pluginName];
        return this.configCache[pluginName];
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to get config for plugin ${pluginName}:`, error);
      return null;
    }
  }
  
  /**
   * 获取插件配置schema
   * @param pluginName 插件名称
   * @returns 插件配置schema
   */
  async getPluginSchema(pluginName: string): Promise<Record<string, PluginConfigSchema> | null> {
    if (this.schemaCache[pluginName]) {
      return this.schemaCache[pluginName];
    }
    
    try {
      // 尝试从插件模块中获取配置schema
      const pluginPath = path.join(process.cwd(), 'plugins', pluginName);
      
      // 检查插件目录是否存在
      if (!fs.existsSync(pluginPath)) {
        return null;
      }
      
      // 尝试加载插件的配置schema
      try {
        // 清除模块缓存以确保获取最新的配置
        Object.keys(require.cache).forEach(key => {
          if (key.includes(pluginName)) {
            delete require.cache[key];
          }
        });
        
        // 尝试导入插件模块
        const pluginModule = require(pluginPath);
        
        // 检查是否有config.schema导出
        if (pluginModule.config?.schema) {
          this.schemaCache[pluginName] = pluginModule.config.schema;
          return pluginModule.config.schema;
        }
      } catch (importError) {
        logger.warn(`Failed to import plugin module ${pluginName}:`, importError);
      }
      
      return null;
    } catch (error) {
      logger.error(`Failed to get schema for plugin ${pluginName}:`, error);
      return null;
    }
  }
  
  /**
   * 保存插件配置
   * @param pluginName 插件名称
   * @param config 配置对象
   * @returns 是否保存成功
   */
  async savePluginConfig(pluginName: string, config: any): Promise<boolean> {
    try {
      const configYmlPath = path.join(process.cwd(), 'config.yml');
      const configTmpYmlPath = configYmlPath + '.tmp';
      
      const configFileContent = fs.readFileSync(configYmlPath, 'utf8');
      let configData: any = yaml.load(configFileContent);
      
      // 确保plugins对象存在
      configData.plugins = configData.plugins || {};
      
      // 更新插件配置
      configData.plugins[pluginName] = config;
      
      // 将配置写入临时文件
      const yamlStr = yaml.dump(configData, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });
      
      fs.writeFileSync(configTmpYmlPath, yamlStr, 'utf8');
      
      // 重命名覆盖原文件
      fs.renameSync(configTmpYmlPath, configYmlPath);
      
      // 更新缓存
      this.configCache[pluginName] = config;
      
      return true;
    } catch (error) {
      logger.error(`Failed to save config for plugin ${pluginName}:`, error);
      return false;
    }
  }
  
  /**
   * 获取所有插件名称
   * @returns 插件名称数组
   */
  async getAllPluginNames(): Promise<string[]> {
    try {
      const configYmlPath = path.join(process.cwd(), 'config.yml');
      const configFileContent = fs.readFileSync(configYmlPath, 'utf8');
      const configData: any = yaml.load(configFileContent);
      
      return configData.plugins ? Object.keys(configData.plugins) : [];
    } catch (error) {
      logger.error('Failed to get all plugin names:', error);
      return [];
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
    const schema = await this.getPluginSchema(pluginName);
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

export async function apply(core: Core, config: Config) {
  // 创建插件配置管理器
  const configManager = new PluginConfigManager();
  
  // 注册控制台命令
  core.command(config.get<string>('path', 'console'))
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
            session.body = JSON.stringify({ error: `No configuration found for plugin: ${pluginName}` });
          } else {
            logger.warn(`Configuration for plugin "${pluginName}" is not in the expected object format.`);
            session.body = JSON.stringify([]);
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
          const schema = await configManager.getPluginSchema(pluginName);
          
          if (schema) {
            session.body = JSON.stringify(schema);
          } else {
            session.body = JSON.stringify({ error: `No schema found for plugin: ${pluginName}` });
          }
          
          session.setMime('json');
          return;
        }
        
        // 获取所有插件名称
        if (param.path === '/api/getplugins') {
          const plugins = await configManager.getAllPluginNames();
          session.body = JSON.stringify(plugins);
          session.setMime('json');
          return;
        }
        
        // 保存插件配置
        if (param.path === '/api/setconfig') {
          const pluginName = param.name;
          const content = param.content;
          
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
            const success = await configManager.savePluginConfig(pluginName, newConfigObject);
            
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
        
        // 未知API路径
        session.body = JSON.stringify({ error: `Unknown API path: ${param.path}` });
        session.setMime('json');
        return;
      }

      // 处理静态文件请求
      if (param && param.path) {
        const pluginDir = path.resolve(__dirname, '..');
        const filePath = path.join(pluginDir, 'static', param.path + '.html');

        try {
          // 读取静态文件
          const htmlContent = await new Promise<string>((resolve, reject) => {
            fs.readFile(filePath, 'utf-8', (err, data: string) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(data);
            });
          });

          // 替换模板变量
          let modifiedHtmlContent = htmlContent;
          if (param) {
            for (const key in param) {
              if (key !== 'path') {
                const regex = new RegExp(`{{ ${key} }}`, 'g');
                modifiedHtmlContent = modifiedHtmlContent.replace(regex, param[key]);
              }
            }
          }

          session.body = modifiedHtmlContent;
        } catch (error: any) {
          session.body = `<h1>Error</h1><p>Could not read file: ${filePath}</p><p>${error.message}</p>`;
          logger.error('读取文件出错:', error);
        }
      }
    });
    
  // 注册控制台组件
  core.registerComponent('console', {
    getConfigManager: () => configManager
  });
}

export async function disable(core: Core) {
  // 清除登录状态
  loginstatus = {};
  
  // 取消注册控制台组件
  core.unregisterComponent('console');
}
