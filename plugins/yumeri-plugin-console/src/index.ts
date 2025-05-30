import { Core, Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as fs from 'fs'; // 引入同步 fs 模块
import * as path from 'path';
import { PluginConfigManager, ConsoleItem } from './utils';

export const logger = new Logger("console");

export const depend = ['server']; // 需要的服务
export const provide = ['console']; // 提供的服务
export const usage = `Yumeri 基础控制台插件<br>请勿直接禁用或重载此插件，这会导致插件在此实例内无法开启。<br>可通过控制台操作API对控制台项进行添加。`

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
        if (param.path === '/api/pluginusage') {
          const pluginName = param.name;

          if (!pluginName) {
            session.body = JSON.stringify({ success: false, message: '缺少插件名称参数' });
            return;
          }
          const usage = configManager.getPluginUsage(pluginName);
          if (usage) {
            session.body = JSON.stringify({ usage });
          } else {
            session.body = JSON.stringify({ usage: '' });
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
