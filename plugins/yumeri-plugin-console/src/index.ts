import { Core, Context, Session, Logger, Schema } from 'yumeri';
import * as fs from 'fs';
import * as path from 'path';
import mime from 'mime';
import { PluginConfigManager, ConsoleItem } from './utils';

declare module 'yumeri' {
    interface Components {
      console: Console
    }
}

export const logger = new Logger("console");

export const provide = ['console'];
export const usage = `Yumeri 基础控制台插件<br>请勿直接禁用或重载此插件，这会导致插件在此实例内无法开启。<br>可通过控制台操作API对控制台项进行添加。`;

export interface ConsoleConfig {
  path: string;
  adminname: string;
  adminpassword: string;
}

export interface Console {
  addconsoleitem: (
    name: string,
    icon: string,
    displayname: string,
    htmlpath: string,
    staticpath: string
  ) => void;
  
  removeconsoleitem: (name: string) => void;
  
  getloginstatus: (session: Session) => boolean;
}

export const config: Schema<ConsoleConfig> = Schema.object({
  path: Schema.string('监听路径（命令）').default('console'),
  adminname: Schema.string('管理员用户名').default('admin'),
  adminpassword: Schema.string('管理员密码').default('admin'),
});

let loginstatus: Record<string, string> = {};

let consoleitem: Record<string, ConsoleItem> = {};

const operateconsole = {
  addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => {
    consoleitem[name] = new ConsoleItem(icon, displayname, htmlpath, staticpath);
  },
  removeconsoleitem: (name: string) => {
    delete consoleitem[name];
  },
  getloginstatus: (session: Session) => !!loginstatus[session.sessionid]
} as Console

async function getHook(ctx: Context, hookname: string, originString: string) {
  const result: string[] = await ctx.executeHook(hookname);
  let item = '';
  if (result) {
    result.forEach((items) => {
      item = item + items;
    })
  }
  const newString = originString.replace(`{{${hookname}}}`, item);
  return newString;
}

export async function apply(ctx: Context, config: ConsoleConfig) {
  const configManager = new PluginConfigManager();
  const core = ctx.getCore();
  configManager.setCore(core);
  const staticDir = path.join(__dirname, '..', 'static');
  const basePath = config.path;

  consoleitem['config'] = new ConsoleItem('fa-cog', '配置', path.join(staticDir, 'config.html'), path.join(staticDir, 'files'));

  const requireLogin = async (session: Session, next: () => Promise<void>) => {
    if (loginstatus[session.sessionid]) {
      await next();
    } else {
      session.setMime('html');
      session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>请先登录</title></head><body><script>window.onload = function() {alert(\"请先登录\");window.location.href = \"/${basePath}/login\";};</script><p>正在重定向</p></body></html>`;
    }
  };

  ctx.route(`/${basePath}`).action((session) => {
    session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>重定向</title></head><body><script>window.location.href = "/${basePath}/home";</script><p>正在重定向</p></body></html>`;
    session.setMime('html');
  });

  ctx.route(`/${basePath}/login`).action((session) => {
    const loginHtmlPath = path.join(staticDir, 'login.html');
    if (fs.existsSync(loginHtmlPath)) {
      session.body = fs.readFileSync(loginHtmlPath, 'utf8');
      session.setMime('html');
    }
  });

  ctx.route(`/${basePath}/home`).action((session) => requireLogin(session, async () => {
    const consoleHtmlPath = path.join(staticDir, 'home.html');
    if (fs.existsSync(consoleHtmlPath)) {
      const parseone = await getHook(ctx, 'console:home', fs.readFileSync(consoleHtmlPath, 'utf8'));
      // const parsetwo = await getHook(ctx, 'console:homejs', parseone);
      session.body = parseone;
      session.setMime('html');
    }
  }));

  ctx.route(`/${basePath}/home/script.js`).action((session) => requireLogin(session, async () => {
    const consoleHtmlPath = path.join(staticDir, 'home.js');
    if (fs.existsSync(consoleHtmlPath)) {
      const parseone = await getHook(ctx, 'console:homejs', fs.readFileSync(consoleHtmlPath, 'utf8'));
      session.body = parseone;
      session.setMime('application/javascript');
    }
  }))

  ctx.route(`/api/console/loginpass`).action(async (session, params) => {
    session.setMime('json');
    const reqst = await session.parseRequestBody();
    if (reqst.username === config.adminname && reqst.password === config.adminpassword) {
      loginstatus[session.sessionid] = reqst.username!;
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
    pluginmetadata: (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { usage: '', provide: [], depend: [] };
      const meta = configManager.getMetadata(pluginName) || {};
      return {
        usage: meta.usage || '',
        provide: meta.provide || [],
        depend: meta.depend || []
      };
    },
    // 新建插件
    addplugin: async (params: URLSearchParams) => {
      const pluginName = params.get('name');
      if (!pluginName) return { success: false, message: '缺少插件名称参数' };
      try {
        await configManager.addPluginToConfig(pluginName);
        return { success: true, message: `插件 ${pluginName} 已成功添加` };
      } catch (error) {
        return { success: false, message: `添加插件失败: ${error}` };
      }
    },

    // 获取未在配置文件声明的已安装插件
    unregistered: async () => {
      try {
        const unregistered = await configManager.getUnregisteredPlugins();
        return { success: true, plugins: unregistered };
      } catch (error) {
        return { success: false, message: `获取未注册插件失败: ${error}` };
      }
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
    ctx.route(`/api/console/${routeName}`).action(async (session, params) => {
      await requireLogin(session, async () => {
        try {
          session.setMime('json');
          const result = await handler(params);
          session.body = JSON.stringify(result);
        } catch (err) {
          session.setMime('json');
          session.body = JSON.stringify({ success: false, error: String(err) });
        }
      });
    });
  }
  ctx.route(`/${basePath}/:item/:asset*`).action((session, params, item, asset) => requireLogin(session, async () => {
    const consoleItem = consoleitem[item];
    if (consoleItem) {
      const assetPath = asset ? path.join(consoleItem.staticpath, asset) : consoleItem.htmlpath;
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const mimeType = asset ? (mime.getType(assetPath) || 'application/octet-stream') : 'text/html';
        session.setMime(mimeType);
        session.body = fs.readFileSync(assetPath, 'utf-8');
      }
    }
  }
  ));


  ctx.registerComponent('console', operateconsole);
}
