/**
 * @time: 2025/07/12 18:14
 * @author: FireGuo & Manus
 * WindyPear-Team All right reserved
 **/
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { Logger } from './logger';
import { Command } from './command';
import { Session } from './session';
import { Platform } from './platform';
import chokidar from 'chokidar';
import { Middleware } from './middleware';
import { Context } from './context';

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
  // TODO: Core的配置项
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
  public platforms: Platform[] = [];
  private eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
  public components: { [name: string]: any } = {};
  public commands: Record<string, Command> = {};
  public pluginLoader: PluginLoader;
  public logger = new Logger('core');
  public providedComponents: { [name: string]: string } = {};
  private pluginModules: { [name: string]: any } = {};
  private configPath: string = '';
  private globalMiddlewares: Record<string, Middleware> = {};
  public cmdtoplu: Record<string, string> = {};
  public comtoplu: Record<string, string> = {};
  public evttoplu: Record<string, Record<string, ((...args: any[]) => Promise<void>)[]>> = {};
  public mdwtoplu: Record<string, string> = {};
  public plftoplu: Record<string, string> = {};
  public pluginStatus: Record<string, PluginStatus> = {};

  constructor(pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader;
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
    } catch (e) {
      this.logger.error('Failed to load config:', e);
      throw e;
    }
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

    if (process.env.NODE_ENV === 'development') {
      this.watchPlugins(this);
    }
  }

  /**
   * 导出的函数：加载单个插件
   * @param pluginName 要加载的插件名
   * @param triggerPendingCheck 是否在加载后触发对其他待定插件的检查，默认为 true
   * @returns Promise<boolean> 是否加载成功
   */
  public async loadSinglePlugin(pluginName: string, triggerPendingCheck: boolean = true): Promise<boolean> {
    // 如果插件不存在于状态记录中（例如，动态添加），则设为 PENDING
    if (!this.pluginStatus[pluginName]) {
        this.pluginStatus[pluginName] = PluginStatus.PENDING;
    }

    // 只有 PENDING 状态的插件才能被加载
    if (this.pluginStatus[pluginName] !== PluginStatus.PENDING) {
      // this.logger.info(`Plugin "${pluginName}" is not in a pending state (current: ${this.pluginStatus[pluginName]}). Skipping load.`);
      return false;
    }

    try {
      const pluginInstance = await this.pluginLoader.load(pluginName);
      if (!pluginInstance) {
        throw new Error('Plugin loader returned no instance.');
      }

      const deps = pluginInstance.depend || [];
      const unmetDependencies = deps.filter(dep => !this.providedComponents[dep]);

      if (unmetDependencies.length > 0) {
        // this.logger.info(`Plugin "${pluginName}" has unmet dependencies: [${unmetDependencies.join(', ')}]. Will retry later.`);
        return false;
      }

      // 依赖满足，开始加载
      this.plugins[pluginName] = pluginInstance;

      if (pluginInstance.apply) {
        await pluginInstance.apply(new Context(this, pluginName), await this.getPluginConfig(pluginName));
        this.pluginLoader.logger.info(`Applied plugin "${pluginName}"`);
      }

      // 注册提供的组件
      if (pluginInstance.provide) {
        for (const componentName of pluginInstance.provide) {
          if (this.providedComponents[componentName]) {
            this.logger.error(`Component "${componentName}" is provided by multiple plugins: "${this.providedComponents[componentName]}" and "${pluginName}".`);
          } else {
            this.providedComponents[componentName] = pluginName;
          }
        }
      }

      this.pluginStatus[pluginName] = PluginStatus.ENABLED; // 更新状态为已启用
      // this.logger.info(`Plugin "${pluginName}" loaded successfully.`);

      // 加载成功后，检查是否可以加载其他等待中的插件
      if (triggerPendingCheck) {
        await this._loadPendingPlugins();
      }

      return true;
    } catch (err) {
      this.pluginLoader.logger.error(`Failed to load plugin "${pluginName}":`, err);
      // 加载失败的插件保持 PENDING 状态，以便后续重试
      return false;
    }
  }

  /**
   * 内部函数：尝试加载所有处于 PENDING 状态的插件
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
  public async unloadPlugin(pluginNameToUnload: string): Promise<void> {
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
      await this._unloadSinglePlugin(dependentName);
    }

    // 3. 最后卸载目标插件
    await this._unloadSinglePlugin(pluginNameToUnload);

    // 4. 卸载完成后，尝试重新加载处于 PENDING 状态的插件
    // await this._loadPendingPlugins();
  }

  /**
   * 内部函数：执行单个插件的卸载逻辑
   * @param pluginName 插件名
   */
  private async _unloadSinglePlugin(pluginName: string): Promise<void> {
    if (this.pluginStatus[pluginName] !== PluginStatus.ENABLED) {
      return; // 只卸载已启用的插件
    }

    this.logger.info(`Unloading plugin "${pluginName}"...`);
    try {
      const plugin = this.plugins[pluginName];
      if (plugin && plugin.disable) {
        await plugin.disable(new Context(this, pluginName));
      }

      await this.pluginLoader.unloadPlugin(pluginName);
      this.unregall(pluginName); // 清理该插件注册的所有内容

      delete this.plugins[pluginName];
      delete this.pluginModules[pluginName];

      // 更新状态为 PENDING，因为它的配置仍然是启用的
      // 如果它被其他插件依赖，当那个插件被卸载时，它也会被重新评估
      this.pluginStatus[pluginName] = PluginStatus.PENDING;

      this.emit('plugin-unloaded', pluginName);
      // this.logger.info(`Plugin "${pluginName}" unloaded.`);
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
   * 监听插件文件变化，实现热更新
   * @param core Core 实例
   * @param pluginsDir 插件目录，默认为 'plugins'
   */
  watchPlugins(core: Core, pluginsDir: string = 'plugins') {
    const logger = new Logger('hmr');
    const watcher = chokidar.watch(pluginsDir, {
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const getPluginNameFromPath = (changePath: string): string | null => {
        if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return null;
        const parts = changePath.split(path.sep);
        return parts.length > 1 ? parts[1] : null;
    };

    watcher.on('change', async (changePath) => {
      const pluginName = getPluginNameFromPath(changePath);
      if (pluginName) {
        logger.info(`Plugin file changed: ${changePath}`);
        await core.reloadPlugin(pluginName);
      }
    });

    watcher.on('add', async (changePath) => {
        const pluginName = getPluginNameFromPath(changePath);
        if (pluginName) {
            logger.info(`New plugin file added: ${changePath}`);
            await core.reloadPlugin(pluginName);
        }
    });

    watcher.on('unlink', async (changePath) => {
        const pluginName = getPluginNameFromPath(changePath);
        if (pluginName) {
            logger.info(`Plugin file removed: ${changePath}`);
            await core.unloadPlugin(pluginName);
        }
    });

    logger.info(`Watching for plugin changes in ${pluginsDir}`);
  }

  /**
   * 注册组件
   * @param name 组件名称
   * @param component 组件实例
   */
  registerComponent(name: string, component: any): void {
    if (this.components.hasOwnProperty(name)) {
      this.logger.warn(`Component "${name}" already registered by plugin "${this.providedComponents[name]}".`);
      return;
    }
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
    delete this.providedComponents[name];
    delete this.comtoplu[name];
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
   * 注册命令
   * @param name 命令名称
   * @returns Command 实例
   */
  command(name: string): Command {
    const command = new Command(this, name);
    this.commands[name] = command;
    return command;
  }

  /**
   * 执行命令
   * @param name 命令名称
   * @param session 会话对象
   * @param args 传递给命令处理函数的参数
   * @returns 会话对象或 null
   */
  async executeCommand(name: string, session: any, ...args: any[]): Promise<Session | null> {
    const command = this.commands[name];
    if (command) {
      const globalMiddlewareList = Object.values(this.globalMiddlewares || {});
      const commandMiddlewareList = command.middlewares || [];
      const middlewares = [...globalMiddlewareList, ...commandMiddlewareList];

      let index = 0;
      const runner = async (): Promise<void> => {
        if (index < middlewares.length) {
          const middleware = middlewares[index++];
          await middleware(session, runner);
        } else {
          await command.executeHandler(session, ...args);
        }
      };

      await runner();
      return session;
    }
    return null;
  }

  /**
   * 注册平台
   * @param platform 平台实例
   * @returns 平台启动结果
   */
  registerPlatform(platform: Platform): any {
    this.platforms.push(platform);
    return platform.startPlatform(this);
  }

  /**
   * 清理指定插件注册的所有内容
   * @param pluginname 插件名称
   */
  unregall(pluginname: string): void {
    // 清理 commands
    Object.keys(this.cmdtoplu)
      .filter(cmd => this.cmdtoplu[cmd] === pluginname)
      .forEach(cmd => {
        delete this.cmdtoplu[cmd];
        delete this.commands[cmd];
      });

    // 清理 components 和 providedComponents
    Object.keys(this.comtoplu)
      .filter(comp => this.comtoplu[comp] === pluginname)
      .forEach(comp => {
        delete this.comtoplu[comp];
        delete this.components[comp];
        delete this.providedComponents[comp];
      });

    // 清理 event listeners
    for (const evt in this.evttoplu) {
      if (this.evttoplu[evt][pluginname]) {
        const pluginListeners = this.evttoplu[evt][pluginname] || [];
        if (this.eventListeners[evt]) {
          this.eventListeners[evt] = this.eventListeners[evt].filter(l => !pluginListeners.includes(l));
        }
        delete this.evttoplu[evt][pluginname];
      }
    }

    // 清理 middlewares
    Object.keys(this.mdwtoplu)
      .filter(mdw => this.mdwtoplu[mdw] === pluginname)
      .forEach(mdw => {
        delete this.mdwtoplu[mdw];
        delete this.globalMiddlewares[mdw];
      });
  }

  /**
   * 获取命令
   * @param name 命令名称
   * @returns Command 实例或 null
   */
  getCommand(name: string): Command | null {
    return this.commands[name] || null;
  }
}