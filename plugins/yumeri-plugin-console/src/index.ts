import { Core, Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { registerVirtualAssetResolver } from '@yumerijs/types';
import * as fs from 'fs';
import * as path from 'path';
import mime from 'mime';
import { PluginConfigManager } from './utils';
import App from './views/App.vue';
import Login from './views/Login.vue';

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
  
  addvueconsoleitem: (
    name: string,
    icon: string,
    displayname: string,
    component: any,
    options?: { pluginName?: string; entry?: string }
  ) => void;

  removeconsoleitem: (name: string) => void;
  
  getloginstatus: (session: Session) => boolean;
}

export const config = {
  schema: {
    path: { type: 'string', default: 'console', description: '监听路径（命令）' },
    adminname: { type: 'string', default: 'admin', description: '管理员用户名' },
    adminpassword: { type: 'string', default: 'admin', description: '管理员密码' }
  } as Record<string, ConfigSchema>
};

let loginstatus: Record<string, string> = {};

type ConsoleView =
  | { type: 'iframe'; icon: string; name: string; htmlpath: string; staticpath: string }
  | { type: 'vue'; icon: string; name: string; entry?: string };

let consoleitem: Record<string, ConsoleView> = {};

export const render = 'vue';

const operateconsole = {
  addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => {
    consoleitem[name] = { type: 'iframe', icon, name: displayname, htmlpath, staticpath };
  },
  addvueconsoleitem: (name: string, icon: string, displayname: string, component: any, options?: { pluginName?: string; entry?: string }) => {
    const entry = resolveVueEntry(component, options?.pluginName, options?.entry);
    consoleitem[name] = { type: 'vue', icon, name: displayname, entry };
  },
  removeconsoleitem: (name: string) => {
    delete consoleitem[name];
  },
  getloginstatus: (session: Session) => !!loginstatus[session.sessionid]
} as Console

export async function apply(ctx: Context, config: Config) {
  const configManager = new PluginConfigManager();
  const core = ctx.getCore();
  configManager.setCore(core);
  const staticDir = path.join(__dirname, '..', 'static');
  const basePath = config.get<string>('path', 'console');

  consoleitem['config'] = { type: 'iframe', icon: 'fa-cog', name: '配置', htmlpath: path.join(staticDir, 'config.html'), staticpath: path.join(staticDir, 'files') };

  const requireLogin = async (session: Session, next: () => Promise<void>) => {
    if (loginstatus[session.sessionid]) {
      await next();
    } else {
      session.setMime('html');
      session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>请先登录</title></head><body><script>window.location.href = "/${basePath}/login";</script><p>正在重定向</p></body></html>`;
    }
  };

  ctx.route(`/${basePath}`).action(async (session) => {
    session.setMime('html');
    session.body = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>重定向</title></head><body><script>window.location.href = "/${basePath}/home";</script><p>正在重定向</p></body></html>`;
  });

  ctx.route(`/${basePath}/login`).action(async (session) => {
    await session.renderView(Login, { basePath });
  });

  ctx.route(`/${basePath}/home`).action((session) => requireLogin(session, async () => {
    const items = Object.entries(consoleitem).map(([key, item]) => {
      if (item.type === 'iframe') {
        return { name: key, displayName: item.name, icon: item.icon, type: 'iframe' as const, path: `/${basePath}/${key}` };
      }
      return { name: key, displayName: item.name, icon: item.icon, type: 'vue' as const, entry: item.entry };
    });

    await session.renderView(App, { items, basePath });
  }));

  ctx.route(`/api/console/loginpass`).action(async (session, params) => {
    session.setMime('json');
    const reqst = await session.parseRequestBody();
    if (reqst.username === config.get<string>('adminname', 'admin') && reqst.password === config.get<string>('adminpassword', 'admin')) {
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
      return Object.entries(consoleitem).map(([key, item]) => {
        if (item.type === 'iframe') {
          return {
            type: 'iframe',
            item: item.icon,
            name: item.name,
            path: `/${basePath}/${key}`
          };
        }
        return {
          type: 'vue',
          item: item.icon,
          name: item.name,
          entry: item.entry || null
        };
      });
    },
    logout: async (params: URLSearchParams, session?: Session) => {
      if (session) {
        delete loginstatus[session.sessionid];
      }
      return { success: true };
    }
  };

  for (const [routeName, handler] of Object.entries(apiRoutes)) {
    ctx.route(`/api/console/${routeName}`).action(async (session, params) => {
      const needLogin = routeName !== 'loginpass';
      const exec = async () => {
        try {
          session.setMime('json');
          const result = await (handler as any)(params, session);
          session.body = JSON.stringify(result);
        } catch (err) {
          session.setMime('json');
          session.body = JSON.stringify({ success: false, error: String(err) });
        }
      };
      if (needLogin) {
        await requireLogin(session, exec);
      } else {
        await exec();
      }
    });
  }
  ctx.route(`/${basePath}/:item/:asset*`).action((session, params, item, asset) => requireLogin(session, async () => {
    const consoleItem = consoleitem[item];
    if (consoleItem && consoleItem.type === 'iframe') {
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

type ManifestEntry = { entry: string; file: string; css?: string[] }
type ManifestRecord = { plugin: string; entries: Record<string, ManifestEntry> }
const manifestCache = new Map<string, ManifestRecord | null>();
const manifestResolvers = new Set<string>();

function resolveVueEntry(component: any, pluginName?: string, directEntry?: string): string | undefined {
  if (directEntry) return directEntry;
  const file = component?.__file;
  const inferredPlugin = pluginName || inferPluginFromFile(file);
  if (!inferredPlugin) return undefined;
  const manifest = loadManifest(inferredPlugin);
  if (!manifest) return undefined;

  const pluginRoot = getPluginRoot(inferredPlugin);
  const relId = file && pluginRoot ? toPosixPath(path.relative(pluginRoot, file)) : null;
  const entry = (relId && manifest.entries[relId]) || (file && manifest.entries[file]);
  if (entry && pluginRoot) {
    ensureManifestResolver(inferredPlugin, manifest, pluginRoot);
    return entry.entry;
  }
  return undefined;
}

function loadManifest(pluginName: string): ManifestRecord | null {
  if (manifestCache.has(pluginName)) return manifestCache.get(pluginName)!;
  const root = getPluginRoot(pluginName);
  if (!root) {
    manifestCache.set(pluginName, null);
    return null;
  }
  const manifestPath = path.join(root, 'dist', 'ui-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    manifestCache.set(pluginName, null);
    return null;
  }
  try {
    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifestCache.set(pluginName, json);
    return json;
  } catch (err) {
    logger.error('[console] Failed to load ui-manifest', err);
    manifestCache.set(pluginName, null);
    return null;
  }
}

function ensureManifestResolver(pluginName: string, manifest: ManifestRecord, pluginRoot: string) {
  if (manifestResolvers.has(pluginName)) return;
  const prefix = `/__yumeri_vue_prebuilt/${pluginName}`;
  registerVirtualAssetResolver(async (pathname) => {
    if (!pathname.startsWith(prefix)) return null;
    const fileName = pathname.slice(prefix.length + 1);
    for (const entry of Object.values(manifest.entries)) {
      const fileCandidates = [entry.file];
      if (entry.css) fileCandidates.push(...entry.css.map((css) => css.replace(prefix + '/', 'client/')));
      for (const fileRel of fileCandidates) {
        if (fileRel.endsWith(fileName)) {
          const abs = path.join(pluginRoot, 'dist', fileRel);
          if (!fs.existsSync(abs)) return null;
          const body = await fs.promises.readFile(abs);
          const contentType = fileRel.endsWith('.css') ? 'text/css' : 'application/javascript';
          return { body, contentType };
        }
      }
    }
    return null;
  });
  manifestResolvers.add(pluginName);
}

function getPluginRoot(pluginName: string): string | null {
  try {
    const pkgPath = require.resolve(`${pluginName}/package.json`);
    return path.dirname(pkgPath);
  } catch {
    return null;
  }
}

function inferPluginFromFile(file?: string): string | null {
  if (!file) return null;
  let dir = path.dirname(file);
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (json?.name) return json.name as string;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}
