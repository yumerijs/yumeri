import { EventEmitter } from 'events';
import { Config, Schema, fallback } from './config.js';
import { Logger } from './logger.js';
import { Session } from './session.js';
import { Middleware } from './middleware.js';
import { Route } from './route.js';
import { Context } from './context.js';
import { HookHandler, Hook } from './hook.js';
import { Server as CoreServer } from './server.js';
import { I18n } from './i18n.js';
import { IRenderer } from '@yumerijs/types';
import { SessionStorageProcessor, Storage, SessionStorageSnapshot } from './storage.js';
import * as fs from 'fs'

const version = JSON.parse(await fs.promises.readFile(new URL('../package.json', import.meta.url), 'utf-8')).version;

// This interface should probably be in @yumerijs/types
export interface Plugin {
  apply?: (ctx: Context, config: Config) => Promise<void> | void;
  disable?: (ctx: Context) => Promise<void> | void;
  depend?: Array<string>;
  provide?: Array<string>;
  render?: string;
  config?: Schema<any>;
}

type PluginConstructor = new (ctx: Context, config: Config) => Plugin;
type PluginModuleLike = Plugin | PluginConstructor | ((ctx: Context, config: Config) => Promise<void> | void) | {
  default?: Plugin | PluginConstructor | ((ctx: Context, config: Config) => Promise<void> | void);
  apply?: ((ctx: Context, config: Config) => Promise<void> | void);
  disable?: (ctx: Context) => Promise<void> | void;
  depend?: Array<string>;
  provide?: Array<string>;
  render?: string;
  config?: Schema<any>;
};

function isClassPlugin(value: unknown): value is PluginConstructor {
  if (typeof value !== 'function') return false;
  const source = Function.prototype.toString.call(value);
  return source.startsWith('class ');
}

function mergePluginMeta(target: Plugin, source: any): Plugin {
  if (!source || typeof source !== 'object') return target;
  if (target.depend == null && Array.isArray(source.depend)) target.depend = source.depend;
  if (target.provide == null && Array.isArray(source.provide)) target.provide = source.provide;
  if (target.render == null && typeof source.render === 'string') target.render = source.render;
  if (target.config == null && source.config) target.config = source.config;
  if (target.disable == null && typeof source.disable === 'function') target.disable = source.disable.bind(source);
  return target;
}

export function resolvePluginModule(module: PluginModuleLike, context: Context, config: Config): Plugin {
  const candidate = (module as any)?.default ?? (module as any)?.apply ?? module;
  let plugin: Plugin;

  if (isClassPlugin(candidate)) {
    plugin = new candidate(context, config);
  } else if (typeof candidate === 'function') {
    plugin = { apply: candidate };
  } else if (candidate && typeof candidate === 'object') {
    plugin = candidate;
  } else {
    throw new TypeError('Invalid plugin module. Expected class, function, or plugin object.');
  }

  mergePluginMeta(plugin, module);
  if (candidate !== module) {
    mergePluginMeta(plugin, candidate);
  }

  return plugin;
}

export interface CoreOptions {
  port?: number;
  host?: string;
  enableCors?: boolean;
  enableWs?: boolean;
  lang?: string[];
  skipcheckUpdates?: boolean
}

export const coreConfigSchema = Schema.object<CoreOptions>({
  port: Schema.number('监听端口').default(14510),
  host: Schema.string('监听地址').default('0.0.0.0'),
  enableCors: Schema.boolean('启用跨域').default(false),
  enableWs: Schema.boolean('启用 WebSocket').default(false),
  lang: Schema.array(Schema.string(), '语言列表').default(['zh', 'en']),
  skipcheckUpdates: Schema.boolean('启动时检查更新').default(false)
});

export const enum PluginStatus {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  PENDING = 'pending',
}

export class Core {
  public emitter = new EventEmitter();
  public components: { [name: string]: any } = {};
  public routes: Record<string, Route> = {};
  public logger = new Logger('core');
  public globalMiddlewares: Record<string, Middleware> = {};
  public hooks: Record<string, Hook> = {};
  public coreConfig: CoreOptions;
  public server!: CoreServer;
  public i18n!: I18n;
  public loader: any;
  public storage: SessionStorageProcessor = new SessionStorageProcessor();
  public renderers: Map<string, IRenderer> = new Map();
  public pluginRenderers: Map<string, string> = new Map(); // Stores which plugin uses which renderer

  constructor(loader?: any, coreConfig: CoreOptions = {}, loggersetCore = true, splash = true) {
    this.coreConfig = fallback(coreConfigSchema, coreConfig);
    this.loader = loader;
    if (splash) this.logger.info('Welcome to use Yumeri ver.' + version)
    if (!this.coreConfig.skipcheckUpdates) this.checkUpdate();
    if (loggersetCore) Logger.setCore(this);
  }

  async checkUpdate() {
    try {
      const response = await fetch('https://registry.npmjs.org/yumeri/latest');

      if (!response.ok) return;

      const { version: latest } = await response.json();

      if (latest !== version) {
        this.logger.info(`There is new version for Yumeri: ${version} -> ${latest}`);
      } else {
      }
    } catch (error) {
      this.logger.error('Error while checking updates: ', (error as Error).message);
    }
  }

  public addRenderer(renderer: IRenderer): void {
    if (this.renderers.has(renderer.name)) {
      this.logger.warn(`Renderer "${renderer.name}" is already registered and will be overwritten.`);
    }
    this.renderers.set(renderer.name, renderer);
  }

  public setStorage(storage: SessionStorageProcessor | Storage<SessionStorageSnapshot>): void {
    if (storage instanceof SessionStorageProcessor) {
      this.storage = storage;
    } else {
      this.storage.setStorage(storage);
    }
  }

  public getStorage(): SessionStorageProcessor {
    return this.storage;
  }

  public getRendererForPlugin(pluginName: string): string | undefined {
    return this.pluginRenderers.get(pluginName);
  }

  async runCore(): Promise<void> {
    this.server = new CoreServer(this, {
      port: this.coreConfig.port || 14510,
      host: this.coreConfig.host || '0.0.0.0',
      enableCors: this.coreConfig.enableCors || false,
      enableWs: this.coreConfig.enableWs || false,
    });
    await this.server.start();
  }

  public getShortPluginName(pluginName: string): string {
    const scopeRegex = /^(@[^/]+\/)/;
    const scopeMatch = pluginName.match(scopeRegex);
    const scope = scopeMatch ? scopeMatch[0] : '';
    const nameWithoutScope = pluginName.replace(scopeRegex, '');

    if (nameWithoutScope.startsWith('yumeri-plugin-')) {
      return `${scope}${nameWithoutScope.substring('yumeri-plugin-'.length)}`;
    }
    return pluginName;
  }

  public async plugin(module: PluginModuleLike, context: Context, config: Config): Promise<void> {
    const plugin = resolvePluginModule(module, context, config);
    const shortName = this.getShortPluginName(context.pluginname);
    context.module = plugin;
    
    // 自动依赖注入
    const depend = plugin.depend || [];
    for (const name of depend) {
      const component = this.getComponent(name);
      if (component) {
        context.inject(name, component);
      }
    }

    this.logger.info(`apply plugin ${shortName}`);
    if (plugin.apply) {
      await plugin.apply(context, config);
    }
  }

  registerComponent(name: string, component: any): void {
    this.components[name] = component;
  }

  getComponent(name: string): any {
    return this.components[name];
  }

  unregisterComponent(name: string): void {
    delete this.components[name];
  }

  on(event: string, listener: (...args: any[]) => Promise<void>): void {
    this.emitter.on(event, (...args) => {
      // 包一层保证 async 可以被捕获
      Promise.resolve(listener(...args)).catch((err) => {
        console.error(`Error in event listener for "${event}":`, err);
      });
    });
  }

  emit(event: string, ...payload: any): void {
    this.emitter.emit(event, ...payload);
  }

  // 删除监听器
  off(event: string, listener: (...args: any[]) => Promise<void>): void {
    // 原生 EventEmitter 必须删“同一个函数引用”
    // 所以必须包装一致，这里我们直接用 listener 本体删
    this.emitter.off(event, listener as any);
  }

  use(name: string, middleware: Middleware): Core {
    this.globalMiddlewares[name] = middleware;
    return this;
  }

  route(path: string, context: Context): Route {
    const route = new Route(path, context);
    this.routes[path] = route;
    return route;
  }

  hook(name: string, hookname: string, callback: HookHandler): any {
    if (!this.hooks[name]) {
      this.hooks[name] = new Hook(name);
    }
    this.hooks[name].add(hookname, callback);
  }

  unhook(name: string, hookname: string): any {
    if (this.hooks[name]) {
      this.hooks[name].remove(hookname);
    }
  }

  async hookExecute(name: string, ...args: any[]): Promise<any[]> {
    if (this.hooks[name]) {
      return await this.hooks[name].trigger(...args);
    }
    return [];
  }

  async executeRoute(pathname: string, session: Session, queryParams: URLSearchParams): Promise<boolean> {
    for (const routePath in this.routes) {
      const route = this.routes[routePath];
      const result = route.match(pathname, session.client?.headers?.host);
      if (result) {
        try {
          this.emit('request:start', {
            path: pathname,
            route: routePath,
            method: session?.client?.req?.method,
            plugin: route.context?.pluginname,
            start: Date.now(),
            sessionId: session?.sessionid,
          });
          const middlewares = [...Object.values(this.globalMiddlewares), ...(route.middlewares || [])];
          let index = 0;
          const runner = async (): Promise<void> => {
            if (index < middlewares.length) {
              const name = Object.keys(this.globalMiddlewares)[index] || `mw-${index}`;
              const start = Date.now();
              await middlewares[index++](session, runner);
              this.emit('middleware:end', {
                name,
                path: pathname,
                plugin: route.context?.pluginname,
                duration: Date.now() - start,
                sessionId: session?.sessionid,
              });
            } else {
              const start = Date.now();
              await route.executeHandler(session, queryParams, result.pathParams, result.hostParams);
              this.emit('route:end', {
                path: pathname,
                route: routePath,
                plugin: route.context?.pluginname,
                duration: Date.now() - start,
                sessionId: session?.sessionid,
                status: session?.status,
              });
            }
          };
          await runner();
          this.emit('request:end', {
            path: pathname,
            route: routePath,
            method: session?.client?.req?.method,
            plugin: route.context?.pluginname,
            duration: Date.now() - (session as any)._startAt || undefined,
            status: session?.status,
            sessionId: session?.sessionid,
          });
        } catch (error) {
          this.logger.error(`Unhandled error in route execution for path "${pathname}":`, error);
          this.emit('request:error', {
            path: pathname,
            route: routePath,
            plugin: route.context?.pluginname,
            error: String(error),
            sessionId: session?.sessionid,
          });
          if (session && session.client.res && !session.client.res.writableEnded) {
            session.client.res.statusCode = 500;
            session.client.res.end('Internal Server Error');
          }
        }
        return true;
      }
    }
    return false;
  }

  getRoute(path: string): Route | false {
    for (const routePath in this.routes) {
      const route = this.routes[routePath];
      if (route.match(path)) {
        return route;
      }
    }
    return false;
  }
}
