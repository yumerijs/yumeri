/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { Logger } from './logger';
import { Session } from './session';
import * as chokidar from 'chokidar';
import { Middleware } from './middleware';
import { Route } from './route';
import { Context } from './context';
import { HookHandler, Hook } from './hook';
import { Server } from 'http';
import { Server as CoreServer } from './server';

interface Plugin {
  apply: (ctx: Context, config: Config) => Promise<void>;
  disable: (ctx: Context) => Promise<void>;
  depend: Array<string>;
  provide: Array<string>;
}

interface PluginLoader {
  load(pluginName: string): Promise<Plugin>;
  unloadPlugin(pluginName: string): Promise<void>;
  checkPluginDependencies(pluginPath: string): Promise<boolean>;
  installPluginDependencies(pluginName: string): Promise<void>;
  logger: Logger;
}

interface CoreOptions {
  port: number;
  host: string;
  staticDir: string;
  enableCors: boolean;
  enableWs: boolean;
}

/**
 * 定义插件状态枚举
 */
export const enum PluginStatus {
  ENABLED = 'enabled', // 正常启用
  DISABLED = 'disabled', // 已禁用
  PENDING = 'pending', // 依赖未满足，等待加载
}

export class Core {
  public plugins: { [name: string]: Plugin & { depend?: string[]; provide?: string[] } } = {};
  public config: any = null;
  public eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
  public components: { [name: string]: any } = {};
  public routes: Record<string, Route> = {};
  public pluginLoader: PluginLoader;
  public logger = new Logger('core');
  public globalMiddlewares: Record<string, Middleware> = {};
  public pluginStatus: Record<string, PluginStatus> = {};
  public hooks: Record<string, Hook> = {};
  public coreConfig: CoreOptions;
  public server: CoreServer;
  private pluginWatchers: Record<string, chokidar.FSWatcher> = {};
  private pluginModules: { [name: string]: any } = {};
  private configPath: string = '';

  /**
   * 插件名 -> Context 映射
   */
  private pluginContexts: Record<string, Context> = {};

  constructor(pluginLoader?: PluginLoader, coreConfig?: CoreOptions, setCore = true) {
    this.coreConfig = coreConfig;
    this.pluginLoader = pluginLoader;
    if (setCore) Logger.setCore(this);
  }

  /**
   * 获取或创建插件对应 Context
   */
  getContext(pluginName: string): Context {
    if (!this.pluginContexts[pluginName]) {
      this.pluginContexts[pluginName] = new Context(this, pluginName);
    }
    return this.pluginContexts[pluginName];
  }

  /**
   * 清理指定插件注册的所有内容
   */
  unregall(pluginName: string): void {
    const ctx = this.pluginContexts[pluginName];
    if (ctx) {
      ctx.dispose(); 
      delete this.pluginContexts[pluginName];
    }
  }

  /**
   * 加载配置文件
   * @param configPath 配置文件的路径
   */
  async loadConfig(configPath: string): Promise<void> {
    try {
      this.configPath = configPath;
      const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
      this.config = doc;
      this.logger.info('Config loaded.');

      if (process.env.NODE_ENV === 'development') {
        this.watchConfig(configPath);
      }
      this.coreConfig = this.config.core || {};
    } catch (e) {
      this.logger.error('Failed to load config:', e);
      throw e;
    }
  }

  /**
   * 启动应用
   * @returns Promise<void>
   */
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

  /**
   * 监听配置文件变化，实现热重载
   * @param configPath 配置文件的路径
   */
  private watchConfig(configPath: string): void {
    const watcher = chokidar.watch(configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher.on('change', async () => {
      try {
        const doc = yaml.load(fs.readFileSync(configPath, 'utf8')) as any;
        if (doc && doc.plugins) {
          this.config.plugins = doc.plugins;
        }
        await this.emit('config-changed', this.config);
      } catch (error) {
        this.logger.error('Failed to reload config:', error);
      }
    });

    this.logger.info(`Watching for config changes at ${configPath}`);
  }

  /**
   * 获取指定插件的配置
   * @param pluginName 插件名称
   * @returns 插件的配置对象
   */
  async getPluginConfig(pluginName: string): Promise<Config> {
    const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

    if (this.configPath && process.env.NODE_ENV === 'development') {
      try {
        const doc = yaml.load(fs.readFileSync(this.configPath, 'utf8')) as any;
        if (doc && doc.plugins) {
          this.config.plugins = doc.plugins;
        }
      } catch (error) {
        this.logger.warn('Failed to refresh config for hot reload:', error);
      }
    }

    if (!this.config.plugins[actualPluginName]) {
      return new Config(actualPluginName);
    }
    return new Config(actualPluginName, this.config.plugins[actualPluginName]);
  }

  /**
   * 加载所有在配置文件中启用的插件
   * @returns Promise<void>
   */
  async loadPlugins(): Promise<void> {
    if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
      this.logger.info('No plugins configuration found. No plugins to load.');
      return;
    }

    const allPluginNames = Object.keys(this.config.plugins);
    this.pluginStatus = {}; // 重置状态

    // 初始化所有插件的状态
    for (const name of allPluginNames) {
      if (name.startsWith('~')) {
        const actualName = name.substring(1);
        this.pluginStatus[actualName] = PluginStatus.DISABLED;
      } else {
        this.pluginStatus[name] = PluginStatus.PENDING; // 默认为等待加载
      }
    }

    const enabledPlugins = allPluginNames.filter(name => !name.startsWith('~'));

    // 卸载配置中已禁用或移除的已加载插件
    const currentlyLoaded = Object.keys(this.plugins);
    for (const loadedName of currentlyLoaded) {
      if (!enabledPlugins.includes(loadedName)) {
        await this.unloadPlugin(loadedName);
      }
    }

    if (enabledPlugins.length === 0) {
      this.logger.info('No enabled plugins found in configuration.');
      return;
    }

    // this.logger.info(`Disabled plugins: ${Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.DISABLED).join(', ') || 'None'}`);

    // 循环加载，直到没有插件可以被加载
    let loadedInLastPass = true;
    while (loadedInLastPass) {
      loadedInLastPass = false;
      for (const pluginName of enabledPlugins) {
        // 如果插件已经是启用状态，则跳过
        if (this.pluginStatus[pluginName] === PluginStatus.ENABLED) {
          continue;
        }

        // 尝试加载单个插件
        const success = await this.loadSinglePlugin(pluginName, false); // 内部加载，不触发后续的pending检查
        if (success) {
          loadedInLastPass = true;
        }
      }
    }

    // 加载完所有能加载的插件后，统一检查并加载待定插件
    await this._loadPendingPlugins();

    const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
    if (pendingPlugins.length > 0) {
      // this.logger.warn('Some plugins could not be loaded due to unresolved dependencies:', pendingPlugins);
    }
  }

  /**
   * 加载单个插件
   * @param pluginName 要加载的插件名
   * @param triggerPendingCheck 是否在加载后触发对其他待定插件的检查，默认为 true
   * @returns Promise<boolean> 是否加载成功
   */
  public async loadSinglePlugin(pluginName: string, triggerPendingCheck: boolean = true, onlypending: boolean = false): Promise<boolean> {
    // 如果插件不存在于状态记录中（例如，动态添加），则设为 PENDING
    if (!this.pluginStatus[pluginName]) {
      this.pluginStatus[pluginName] = PluginStatus.PENDING;
    }

    // 只有 PENDING 状态的插件才能被加载
    if (this.pluginStatus[pluginName] !== PluginStatus.PENDING && onlypending) {
      // this.logger.info(`Plugin "${pluginName}" is not in a pending state (current: ${this.pluginStatus[pluginName]}). Skipping load.`);
      return false;
    }

    try {
      const pluginInstance = await this.pluginLoader.load(pluginName);
      if (!pluginInstance) {
        throw new Error('Plugin loader returned no instance.');
      }

      const deps = pluginInstance.depend || [];
      const unmetDependencies = deps.filter(dep => !this.components[dep]);

      if (unmetDependencies.length > 0) {
        // this.logger.info(`Plugin "${pluginName}" has unmet dependencies: [${unmetDependencies.join(', ')}]. Will retry later.`);
        return false;
      }

      // 依赖满足，开始加载
      this.plugins[pluginName] = pluginInstance;

      if (pluginInstance.apply) {
        this.pluginLoader.logger.info(`Apply plugin "${pluginName}"`);
        await pluginInstance.apply(this.getContext(pluginName), await this.getPluginConfig(pluginName));
      }

      // 注册提供的组件
      // if (pluginInstance.provide) {
      //   for (const componentName of pluginInstance.provide) {
      //     if (this.components[componentName]) {
      //       this.logger.error(`Component "${componentName}" is provided by multiple plugins: "${this.providedComponents[componentName]}" and "${pluginName}".`);
      //     } else {
      //       this.components[componentName] = pluginName;
      //     }
      //   }
      // }

      this.pluginStatus[pluginName] = PluginStatus.ENABLED; // 更新状态为已启用

      // 加载成功后，检查是否可以加载其他等待中的插件
      if (triggerPendingCheck) {
        await this._loadPendingPlugins();
      }

      // In development mode, watch the plugin for changes.
      if (process.env.NODE_ENV === 'development') {
        let pluginPathToWatch: string | null = null;
        try {
          const pkgJsonPath = require.resolve(`${pluginName}/package.json`);
          pluginPathToWatch = path.dirname(pkgJsonPath);
        } catch (e) {
          const localPluginPath = path.resolve(process.cwd(), pluginName);
          const localPluginPathInPlugins = path.resolve(process.cwd(), 'plugins', pluginName);
          if (fs.existsSync(localPluginPath)) {
            pluginPathToWatch = localPluginPath;
          } else if (fs.existsSync(localPluginPathInPlugins)) {
            pluginPathToWatch = localPluginPathInPlugins;
        }
        }

        if (pluginPathToWatch) {
          this.watchPlugin(pluginName, pluginPathToWatch);
        } else {
          this.logger.warn(`Could not resolve path for plugin ${pluginName} to watch for changes.`);
        }
      }

      return true;
    } catch (err) {
      this.pluginLoader.logger.error(`Failed to load plugin "${pluginName}":`, err);
      // 加载失败的插件保持 PENDING 状态，以便后续重试
      return false;
    }
  }

  /**
   * 尝试加载所有处于 PENDING 状态的插件
   * @returns Promise<void>
   */
  private async _loadPendingPlugins(): Promise<void> {
    const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
    if (pendingPlugins.length === 0) return;

    // this.logger.info('Checking pending plugins...');
    for (const pluginName of pendingPlugins) {
      await this.loadSinglePlugin(pluginName, false); // 递归调用，但不触发顶层的pending检查
    }
  }

  /**
   * 卸载插件，并递归卸载依赖于它的其他插件
   * @param pluginNameToUnload 要卸载的插件名
   */
  public async unloadPlugin(pluginNameToUnload: string, ispending = false): Promise<void> {
    // 1. 找出所有直接或间接依赖于此插件的插件
    const dependents: string[] = [];
    const pluginsToCheck = [pluginNameToUnload];

    while (pluginsToCheck.length > 0) {
      const currentPluginName = pluginsToCheck.shift()!;
      const provided = this.plugins[currentPluginName]?.provide || [];

      if (provided.length === 0) continue;

      for (const pluginName in this.plugins) {
        if (dependents.includes(pluginName) || pluginName === pluginNameToUnload) continue;

        const deps = this.plugins[pluginName].depend || [];
        if (provided.some(p => deps.includes(p))) {
          if (!dependents.includes(pluginName)) {
            dependents.push(pluginName);
            pluginsToCheck.push(pluginName); // 递归查找
            // this.logger.info(`Plugin "${pluginName}" depends on "${currentPluginName}" and will be unloaded.`);
          }
        }
      }
    }

    // 2. 卸载所有依赖者
    for (const dependentName of dependents) {
      await this.unloadPlugin(dependentName, true);
    }

    // 3. 最后卸载目标插件
    await this._unloadSinglePlugin(pluginNameToUnload, ispending);

    // 4. 卸载完成后，尝试重新加载处于 PENDING 状态的插件
    // await this._loadPendingPlugins();
  }

  /**
   * 执行单个插件的卸载逻辑
   * @param pluginName 插件名
   * @param ispending 是否处于 PENDING 状态
   */
  private async _unloadSinglePlugin(pluginName: string, ispending = false): Promise<void> {
    if (this.pluginStatus[pluginName] !== PluginStatus.ENABLED) {
      return; // 只卸载已启用的插件
    }

    this.logger.info(`Unloading plugin "${pluginName}"...`);
    try {
      const plugin = this.plugins[pluginName];
      if (plugin && plugin.disable) await plugin.disable(this.getContext(pluginName));

      await this.pluginLoader.unloadPlugin(pluginName);
      this.unregall(pluginName); // 清理该插件注册的所有内容

      delete this.plugins[pluginName];
      delete this.pluginModules[pluginName];

      this.pluginStatus[pluginName] = ispending ? PluginStatus.PENDING : PluginStatus.DISABLED;

      // Stop watching the plugin directory
      if (this.pluginWatchers[pluginName]) {
        this.pluginWatchers[pluginName].close();
        delete this.pluginWatchers[pluginName];
      }

      this.emit('plugin-unloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to unload plugin "${pluginName}":`, error);
    }
  }

  /**
   * 重新加载插件
   * @param pluginName 插件名称
   */
  public async reloadPlugin(pluginName: string): Promise<void> {
    // this.logger.info(`Reloading plugin "${pluginName}"...`);

    // 1. 递归卸载插件及其依赖者
    await this.unloadPlugin(pluginName);

    // 2. 重新加载该插件
    // unloadPlugin 已经将状态设置为 PENDING，所以 loadSinglePlugin 可以直接工作
    const success = await this.loadSinglePlugin(pluginName);

    if (success) {
      // this.logger.info(`Plugin "${pluginName}" reloaded successfully.`);
      this.emit('plugin-reloaded', pluginName);
    } else {
      this.logger.error(`Failed to reload plugin "${pluginName}". It may have unmet dependencies.`);
    }
  }

  /**
   * 监听插件文件变化
   * @param pluginName 插件名称
   * @param pluginPath 插件路径
   */
  private watchPlugin(pluginName: string, pluginPath: string): void {
    if (this.pluginWatchers[pluginName]) {
      return; // Already watching
    }

    const logger = new Logger('hmr');
    const watcher = chokidar.watch(pluginPath, {
      ignored: /(^|[\/])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    watcher.on('change', async (changePath) => {
      logger.info(`Plugin file changed: ${changePath}`);
      await this.reloadPlugin(pluginName);
    });

    watcher.on('add', async (changePath) => {
      logger.info(`New file added to plugin ${pluginName}: ${changePath}`);
      await this.reloadPlugin(pluginName);
    });

    watcher.on('unlink', async (changePath) => {
      logger.info(`File removed from plugin ${pluginName}: ${changePath}`);
      await this.reloadPlugin(pluginName);
    });

    this.pluginWatchers[pluginName] = watcher;
    // logger.info(`Watching for changes in plugin: ${pluginName}`);
  }

  /**
   * 注册组件
   * @param name 组件名称
   * @param component 组件实例
   */
  registerComponent(name: string, component: any): void {
    // if (this.components.hasOwnProperty(name)) {
    //   this.logger.warn(`Component "${name}" already registered by plugin "${this.providedComponents[name]}".`);
    //   return;
    // }
    this.components[name] = component;
    // this.logger.info(`Component "${name}" registered.`);
  }

  /**
   * 获取组件
   * @param name 组件名称
   * @returns 组件实例
   */
  getComponent(name: string): any {
    return this.components[name];
  }

  /**
   * 注销组件
   * @param name 组件名称
   */
  unregisterComponent(name: string): void {
    delete this.components[name];
    // delete this.providedComponents[name];
  }

  /**
   * 注册事件监听器
   * @param event 事件名称
   * @param listener 事件回调函数
   */
  on(event: string, listener: (...args: any[]) => Promise<void>): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 传递给事件监听器的参数
   */
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

  /**
   * 注册全局中间件
   * @param name 中间件名称
   * @param middleware 中间件函数
   * @returns Core 实例
   */
  use(name: string, middleware: Middleware): Core {
    this.globalMiddlewares[name] = middleware;
    return this;
  }

  /**
   * 注册路由
   * @param path 路由路径
   * @returns Route 实例
   */
  route(path: string): Route {
    const route = new Route(path);
    this.routes[path] = route;
    return route;
  }

  /**
   * 注册 Hook 钩子
   * @param name Hook 点名称
   * @param hookname 钩子名称
   * @param callback 钩子函数
   */
  hook(name: string, hookname: string, callback: HookHandler): any {
    if (!this.hooks[name]) {
      this.hooks[name] = new Hook(name);
    }
    this.hooks[name].add(hookname, callback);
  }

  /**
   * 消除 Hook 钩子
   */
  unhook(name: string, hookname: string): any {
    if (this.hooks[name]) {
      this.hooks[name].remove(hookname);
    }
  }

  /**
   * 执行 Hook 钩子
   * @param name Hook 点名称
   * @param args 参数
   * @return Promise<any[]>
   */
  async hookExecute(name: string, ...args: any[]): Promise<any[]> {
    if (this.hooks[name]) {
      return await this.hooks[name].trigger(...args);
    }
    return [];
  }

  /**
   * 执行路由
   * @param pathname 需要匹配的URL
   * @param session 当前会话
   * @param queryParams URL参数
   * @returns 是否匹配成功
   */
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

  /**
   * 获取路由
   * @param path 匹配路径
   * @return Route 实例或 false
   */
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
