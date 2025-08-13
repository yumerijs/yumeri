import { Core, Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as fs from 'fs';
import * as path from 'path';
import mime from 'mime';
import { PluginConfigManager, ConsoleItem } from './utils';

export const logger = new Logger("console");

export const depend = ['server'];
export const provide = ['console'];
export const usage = `Yumeri 基础控制台插件<br>请勿直接禁用或重载此插件，这会导致插件在此实例内无法开启。<br>可通过控制台操作API对控制台项进行添加。`;

export interface ConsoleConfig {
  path: string;
  adminname: string;
  adminpassword: string;
}

export const config = {
  schema: {
    path: { type: 'string', default: 'console', description: '监听路径（命令）' },
    adminname: { type: 'string', default: 'admin', description: '管理员用户名' },
    adminpassword: { type: 'string', default: 'admin', description: '管理员密码' }
  } as Record<string, ConfigSchema>
};

let loginstatus: Record<string, string> = {};

export async function apply(ctx: Context, config: Config) {
  const configManager = new PluginConfigManager();
  const core = ctx.getCore();
  configManager.setCore(core);
  let consoleitem: Record<string, ConsoleItem> = {};
  const staticDir = path.join(__dirname, '..', 'static');
  const basePath = config.get<string>('path', 'console');

  consoleitem['config'] = new ConsoleItem('fa-cog', '配置', path.join(staticDir, 'config.html'), path.join(staticDir, 'files'));

  // Middleware for login check
  const requireLogin = (session: Session, next: () => void) => {
    if (loginstatus[session.sessionid]) {
      next();
    } else {
      session.setMime('html');
      session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>请先登录</title></head><body><script>window.onload = function() {alert("请先登录");window.location.href = "/${basePath}/login";};</script><p>正在重定向</p></body></html>`;
    }
  };

  // Redirect root to home
  ctx.route(`/${basePath}`).action((session) => {
    session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>重定向</title></head><body><script>window.location.href = "/${basePath}/home";</script><p>正在重定向</p></body></html>`;
    session.setMime('html');
  });

  // Static pages
  ctx.route(`/${basePath}/login`).action((session) => {
    const loginHtmlPath = path.join(staticDir, 'login.html');
    if (fs.existsSync(loginHtmlPath)) {
      session.body = fs.readFileSync(loginHtmlPath, 'utf8');
      session.setMime('html');
    }
  });

  ctx.route(`/${basePath}/home`).action((session) => requireLogin(session, () => {
    const consoleHtmlPath = path.join(staticDir, 'home.html');
    if (fs.existsSync(consoleHtmlPath)) {
      session.body = fs.readFileSync(consoleHtmlPath, 'utf8');
      session.setMime('html');
    }
  }));

  // API routes
  ctx.route(`/${basePath}/api/loginpass`).action((session, params) => {
    session.setMime('json');
    if (params.get('username') === config.get<string>('adminname', 'admin') && params.get('password') === config.get<string>('adminpassword', 'admin')) {
      loginstatus[session.sessionid] = params.get('username')!;
      session.body = JSON.stringify({ success: true });
    } else {
      session.body = JSON.stringify({ success: false, message: '用户名或密码错误' });
    }
  });

  const apiRoutes = {
    plugins: async (params: URLSearchParams) => {
      const includeDisabled = params.get('includeDisabled') === 'true';
      return await configManager.getAllPluginNames(includeDisabled);
    },
    config: async (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { success: false, message: '缺少插件名称参数' };
      return await configManager.getPluginConfig(pluginName);
    },
    saveconfig: async (params: URLSearchParams) => {
      const pluginName = params.get('name');
      const configData = params.get('config');
      const reload = params.get('reload') !== 'false';
      if (!pluginName || !configData) return { success: false, message: '缺少参数' };
      try {
        const parsedConfig = JSON.parse(configData);
        let parsedName = pluginName;
        if (configManager.getPluginStatus(pluginName) === 'disabled') {
          parsedName = `~${pluginName}`;
        }
        const success = await configManager.savePluginConfig(parsedName, parsedConfig, reload);
        return { success, message: success ? '配置保存成功' : '配置保存失败' };
      } catch (error) {
        return { success: false, message: `配置保存失败: ${error}` };
      }
    },
    disableplugin: async (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { success: false, message: '缺少插件名称参数' };
      const success = await configManager.disablePlugin(pluginName);
      return { success, message: success ? '插件禁用成功' : '插件禁用失败' };
    },
    enableplugin: async (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { success: false, message: '缺少插件名称参数' };
      const success = await configManager.enablePlugin(pluginName);
      return { success, message: success ? '插件启用成功' : '插件启用失败' };
    },
    pluginstatus: (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { success: false, message: '缺少插件名称参数' };
      return { status: configManager.getPluginStatus(pluginName).toUpperCase() };
    },
    pluginusage: (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { usage: '' };
      return { usage: configManager.getPluginUsage(pluginName) || '' };
    },
    consoleitem: () => {
      return Object.entries(consoleitem).map(([key, item]) => ({
        item: item.icon,
        name: item.name,
        path: `/${basePath}/${key}`
      }));
    }
  };

  for (const [routeName, handler] of Object.entries(apiRoutes)) {
    ctx.route(`/${basePath}/api/${routeName}`).action((session, params) => requireLogin(session, async () => {
      session.setMime('json');
      const result = await handler(params);
      session.body = JSON.stringify(result);
    }));
  }
  // Dynamic console item routes
  const aroute = ctx.route(`/${basePath}/:item/:asset*`).action((session, params, item, asset) => requireLogin(session, () => {
    const consoleItem = consoleitem[item];
    if (consoleItem) {
      const assetPath = asset ? path.join(consoleItem.staticpath, asset) : consoleItem.htmlpath;
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const mimeType = asset ? (mime.getType(assetPath) || 'application/octet-stream') : 'text/html';
        session.setMime(mimeType);
        session.body = fs.readFileSync(assetPath);
      }
    }
  }
  ));

  const operateconsole = {
    addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => {
      consoleitem[name] = new ConsoleItem(icon, displayname, htmlpath, staticpath);
    },
    removeconsoleitem: (name: string) => {
      delete consoleitem[name];
    },
    getloginstatus: (session: Session) => !!loginstatus[session.sessionid]
  };
  ctx.registerComponent('console', operateconsole);
}
