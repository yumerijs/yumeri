
import { Config } from './config';
import { Logger } from './logger';
import { Session } from './session';
import { Middleware } from './middleware';
import { Route } from './route';
import { Context } from './context';
import { HookHandler, Hook } from './hook';
import { Server as CoreServer } from './server';
import { I18n } from './i18n';

// This interface should probably be in @yumerijs/types
interface Plugin {
  apply: (ctx: Context, config: Config) => Promise<void>;
  disable: (ctx: Context) => Promise<void>;
  depend: Array<string>;
  provide: Array<string>;
}

interface CoreOptions {
  port: number;
  host: string;
  staticDir: string;
  enableCors: boolean;
  enableWs: boolean;
  lang: string[];
}

export const enum PluginStatus {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  PENDING = 'pending',
}

export class Core {
  public eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
  public components: { [name: string]: any } = {};
  public routes: Record<string, Route> = {};
  public logger = new Logger('core');
  public globalMiddlewares: Record<string, Middleware> = {};
  public hooks: Record<string, Hook> = {};
  public coreConfig: CoreOptions;
  public server: CoreServer;
  public i18n: I18n;
  public loader: any;

  constructor(loader?: any, coreConfig?: CoreOptions, setCore = true) {
    this.coreConfig = coreConfig || ({} as CoreOptions);
    this.loader = loader;
    if (setCore) Logger.setCore(this);
  }

  async runCore(): Promise<void> {
    this.server = new CoreServer(this, {
      port: this.coreConfig.port || 14510,
      host: this.coreConfig.host || '0.0.0.0',
      enableCors: this.coreConfig.enableCors || false,
      enableWs: this.coreConfig.enableWs || false,
      staticDir: this.coreConfig.staticDir || 'public',
    });
    await this.server.start();
    this.logger.info(`Yumeri server started at ${this.coreConfig.host}:${this.coreConfig.port}`);
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

  public async plugin(pluginInstance: Plugin, context: Context, config: Config): Promise<void> {
    const shortName = this.getShortPluginName(context.pluginname);
    this.logger.info(`apply plugin ${shortName}`);
    if (pluginInstance.apply) {
        await pluginInstance.apply(context, config);
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
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  }

  async emit(event: string, ...args: any[]): Promise<void> {
    if (this.eventListeners[event]) {
      for (const listener of this.eventListeners[event]) {
        try {
          await listener(...args);
        } catch (err) {
          this.logger.error(`Error in event listener for "${event}":`, err);
        }
      }
    }
  }

  use(name: string, middleware: Middleware): Core {
    this.globalMiddlewares[name] = middleware;
    return this;
  }

  route(path: string): Route {
    const route = new Route(path);
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
      const result = route.match(pathname);
      if (result) {
        const middlewares = [...Object.values(this.globalMiddlewares), ...(route.middlewares || [])];
        let index = 0;
        const runner = async (): Promise<void> => {
          if (index < middlewares.length) await middlewares[index++](session, runner);
          else await route.executeHandler(session, queryParams, result.pathParams);
        };
        await runner();
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
