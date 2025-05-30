/**
 * @time: 2025/04/20 11:45
 * @author: FireGuo
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
  // Note: depend and provide are handled after plugin load due to loader constraints
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
  private configPath: string = ''; // 存储配置文件路径
  private globalMiddlewares: Record<string, Middleware> = {}; // 全局中间件数组
  public cmdtoplu: Record<string, string> = {}; // 存储命令与插件名的映射关系
  public comtoplu: Record<string, string> = {}; // 存储组件与插件名的映射关系
  public evttoplu: Record<string, Record<string, ((...args: any[]) => Promise<void>)[]>> = {}; // 存储事件与插件名的映射关系
  public mdwtoplu: Record<string, string> = {}; // 存储中间件与插件名的映射关系
  public plftoplu: Record<string, string> = {}; // 存储平台与插件名的映射关系

  /**
   * 创建Core实例
   * @param pluginLoader 插件加载器
   */
  constructor(pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader;
  }

  /**
   * 加载配置文件
   * @param configPath 配置文件路径
   */
  async loadConfig(configPath: string): Promise<void> {
    try {
      this.configPath = configPath; // 保存配置文件路径
      const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
      this.config = doc;
      this.logger.info('Config loaded.');

      // 开发环境下监听配置文件变化
      if (process.env.NODE_ENV === 'development') {
        this.watchConfig(configPath);
      }
    } catch (e) {
      this.logger.error('Failed to load config:', e);
      throw e; // 抛出异常，让上层处理
    }
  }

  /**
   * 监听配置文件变化
   * @param configPath 配置文件路径
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
      //this.logger.info('Config file changed, reloading...');
      try {
        // 重新加载配置文件
        const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
        this.config = doc;
        // this.logger.info('Config reloaded successfully.');

        // 触发配置变更事件
        await this.emit('config-changed', this.config);
      } catch (error) {
        // this.logger.error('Failed to reload config:', error);
      }
    });

    this.logger.info(`Watching for config changes at ${configPath}`);
  }
  /**
   * 获取插件配置
   * @param pluginName 插件名称
   * @returns 配置
   */
  async getPluginConfig(pluginName: string): Promise<Config> {
    // 如果插件名以~开头，则去掉~前缀获取配置
    const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;

    // 如果配置文件路径存在且处于开发模式，每次都重新读取配置文件
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
    const config = new Config(actualPluginName, this.config.plugins[actualPluginName]);
    return config;
  }

  /**
   * 加载插件
   * @returns Promise<void>
   */
  async loadPlugins(): Promise<void> {
    // 检查 plugins 配置是否存在且是对象类型
    if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
      this.logger.info('No plugins configuration found or it is not an object. No plugins to load.');
      return;
    }

    // 获取所有需要加载的插件名，过滤掉以~开头的插件（禁用的插件）
    const pluginNamesToLoad = Object.keys(this.config.plugins).filter(name => !name.startsWith('~'));

    if (pluginNamesToLoad.length === 0) {
      this.logger.info('No enabled plugins found in configuration. All plugins might be disabled or configuration is empty.');
      return;
    }

    // 记录被禁用的插件
    const disabledPlugins = Object.keys(this.config.plugins).filter(name => name.startsWith('~'));
    if (disabledPlugins.length > 0) {
      this.logger.info(`Skipping disabled plugins: ${disabledPlugins.join(', ')}`);
    }

    const loadedPluginNames: string[] = [];
    // 使用对象来跟踪尝试加载的插件名
    let loadAttempted: { [name: string]: boolean } = {};
    // 使用插件名数组来管理剩余待加载的插件
    let remainingPluginNames = [...pluginNamesToLoad];
    // 不加载名称以~开头的插件
    remainingPluginNames = remainingPluginNames.filter(name => !name.startsWith('~'));

    // 多次尝试加载插件，直到所有插件加载完毕或检测到循环依赖
    while (remainingPluginNames.length > 0) {
      let loadedInThisPass = false;
      // 用于存储下一轮尝试加载的插件名
      const nextRemainingPluginNames: string[] = [];

      // 遍历当前剩余待加载的插件名
      for (const pluginName of remainingPluginNames) {
        // 如果插件已经加载或已尝试加载，则跳过
        if (loadedPluginNames.includes(pluginName) || loadAttempted[`${pluginName}`]) {
          continue;
        }
        // 标记该插件已尝试加载
        loadAttempted[`${pluginName}`] = true;

        try {
          this.logger.info(`Attempting to load plugin: ${pluginName}`);
          // 使用插件名加载插件实例和模块
          const pluginInstance = await this.pluginLoader.load(pluginName);
          //const pluginModule = await this.importPluginModule(pluginName);

          if (pluginInstance) {
            const depend: string[] | undefined = pluginInstance.depend;
            const provide: string[] | undefined = pluginInstance.provide;

            // 检查依赖是否满足 (此处仍然检查 this.components，请确保 this.components 在此阶段已包含必要的基准组件)
            const unmetDependencies = depend?.filter(dep => !this.components.hasOwnProperty(dep)) || [];

            if (unmetDependencies.length === 0) {
              // 将加载成功并满足依赖的插件存储起来
              this.plugins[`${pluginName}`] = Object.assign(pluginInstance, { depend, provide });
              //this.pluginModules[`${pluginName}`] = pluginModule;
              //this.logger.info(`Plugin ${pluginName} loaded.`);
              loadedPluginNames.push(pluginName);
              loadedInThisPass = true; // 标记本轮有插件加载成功
              if (loadedInThisPass && pluginInstance && pluginInstance.apply) {
                await pluginInstance.apply(new Context(this, pluginName), await this.getPluginConfig(pluginName));
                // 使用 pluginName
                this.pluginLoader.logger.info(`apply plugin ${pluginName}`);
              }
              // 记录该插件提供了哪些组件
              if (provide) {
                for (const componentName of provide) {
                  if (this.providedComponents.hasOwnProperty(componentName)) {
                    this.logger.error(
                      `Multiple plugins provide the component "${componentName}". Provided by "${this.providedComponents[`${componentName}`]}" and "${pluginName}". Only the first loaded will be active.`
                    );
                  } else {
                    this.providedComponents[`${componentName}`] = pluginName;
                  }
                }
              }
            } else {
              // 如果存在未满足的依赖，将插件名放回下一轮尝试加载列表
              nextRemainingPluginNames.push(pluginName);
              /*this.logger.warn(
                `Plugin ${pluginName} has unmet dependencies: ${unmetDependencies.join(', ')}. Will try again later.`
              );*/
            }
          } else {
            //this.logger.warn(`Plugin "${pluginName}" could not be loaded or its module could not be imported.`);
          }
        } catch (err) {
          this.pluginLoader.logger.error(`Failed to load or process plugin ${pluginName}:`, err);
          // 如果加载或处理失败，不将其加入下一轮尝试列表，但也不标记为已加载成功
        }
      }

      // 如果本轮没有插件加载成功，并且剩余插件列表没有变化，则检测到循环或无法解决的依赖
      if (!loadedInThisPass && nextRemainingPluginNames.length === remainingPluginNames.length && remainingPluginNames.length > 0) {
        this.logger.error(
          'Detected circular or unresolvable plugin dependencies. Remaining plugins:',
          nextRemainingPluginNames.map(name => name) // 映射回插件名
        );
        break; // 防止无限循环
      }

      // 更新剩余待加载插件列表为下一轮的列表
      remainingPluginNames = nextRemainingPluginNames;
    }


    // 警告未加载成功的插件
    if (remainingPluginNames.length > 0) {
      this.logger.warn(
        'Some plugins could not be fully loaded due to unresolved dependencies or errors:',
        remainingPluginNames.map(name => name) // 映射回插件名
      );
    }

    // 开发环境下监听插件变化
    if (process.env.NODE_ENV === 'development') {
      this.watchPlugins(this);
    }
  }

  /**
   * 监听插件目录，实现热重载
   * @param core Core实例
   * @param pluginsDir 插件目录
   */
  watchPlugins(core: Core, pluginsDir: string = 'plugins') {
    const logger = new Logger('hmr');
    const watcher = chokidar.watch(pluginsDir, {
      ignored: /(^|[/\\])\../, // 忽略点文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });
    watcher.on('change', async (changePath) => {
      if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return;
      const parts = changePath.split(path.sep);
      if (parts.length < 2) return;
      const pluginName = parts[1];
      this.logger.info(`Plugin file changed: ${changePath}`);
      this.reloadPlugin(pluginName, core);
    });

    watcher.on('add', async (changePath) => {
      if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return;
      const parts = changePath.split(path.sep);
      if (parts.length < 2) return;
      const pluginName = parts[1];
      this.logger.info(`New plugin file added: ${changePath}`);
      this.reloadPlugin(pluginName, core);
    });

    watcher.on('unlink', async (changePath) => {
      if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return;
      const parts = changePath.split(path.sep);
      if (parts.length < 2) return;
      const pluginName = parts[1];
      this.logger.info(`Plugin file removed: ${changePath}`);
      await this.unloadPluginAndEmit(pluginName, core);
    });

    logger.info(`Watching for plugin changes in ${pluginsDir}`);
  }

  /**
   * 重新加载插件
   * @param pluginName 插件名称
   * @param core Core实例
   */
  public async reloadPlugin(pluginName: string, core: Core) {
    try {
      // 强制重新读取配置文件，确保获取最新配置
      if (this.configPath && process.env.NODE_ENV === 'development') {
        try {
          const doc = yaml.load(fs.readFileSync(this.configPath, 'utf8')) as any;
          if (doc && doc.plugins) {
            this.config.plugins = doc.plugins;
          }
        } catch (error) {
          this.logger.warn('Failed to refresh config for plugin reload:', error);
        }
      }

      // 获取最新的插件配置
      const config = await core.getPluginConfig(pluginName);

      // 加载插件实例
      const plugin = await core.pluginLoader.load(pluginName);

      // 如果插件存在，先禁用旧实例
      if (plugin && plugin.disable) {
        await plugin.disable(new Context(this, pluginName));
      }

      // 清理插件提供的组件
      // if (plugin.provide) {
      //   for (let providedmodules of plugin.provide) {
      //     if (this.components[`${providedmodules}`]) {
      //       this.unregisterComponent(providedmodules);
      //     }
      //   }
      // }

      // 卸载插件
      await core.unloadPluginAndEmit(pluginName, core);

      // 应用新的插件实例
      if (plugin && plugin.apply) {
        await plugin.apply(new Context(this, pluginName), config);
      }

      this.pluginLoader.logger.info(`apply plugin ${pluginName}`);

      // 触发插件重载事件
      core.emit('plugin-reloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to reload plugin ${pluginName}:`, error);
    }
  }

  /**
   * 卸载插件并触发事件
   * @param pluginName 插件名称
   * @param core Core实例
   */
  public async unloadPluginAndEmit(pluginName: string, core: Core) {
    try {
      const plugin = core.plugins[`${pluginName}`];
      if (plugin && plugin.disable) {
        await plugin.disable(new Context(this, pluginName));
      }
      await core.pluginLoader.unloadPlugin(pluginName);
      delete core.plugins[`${pluginName}`];
      delete this.pluginModules[`${pluginName}`];
      // Remove provided components from this plugin
      // for (const componentName in this.providedComponents) {
      //   if (this.providedComponents[`${componentName}`] === pluginName) {
      //     delete this.components[`${componentName}`];
      //     delete this.providedComponents[`${componentName}`];
      //   }
      // }
      this.unregall(pluginName);
      core.emit('plugin-unloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to unload plugin ${pluginName}:`, error);
    }
  }

  /**
   * 注册组件
   * @param name 组件名称
   * @param component 组件
   * @returns void
   */
  registerComponent(name: string, component: any): void {
    if (this.components.hasOwnProperty(name)) {
      this.logger.warn(`Component "${name}" already registered by plugin "${this.providedComponents[`${name}`]}".`);
      return;
    }
    this.components[`${name}`] = component;
    this.logger.info(`Component "${name}" registered.`);
  }

  /**
   * 获取组件
   * @param name 组件名称
   * @returns 组件
   */
  getComponent(name: string): any {
    return this.components[`${name}`];
  }

  /**
   * 取消注册组件
   * @param name 组件名称
   */
  unregisterComponent(name: string): void {
    delete this.components[`${name}`];
    delete this.providedComponents[`${name}`];
    delete this.comtoplu[`${name}`]
  }

  /**
   * 监听事件
   * @param event 事件名称
   * @param listener 回调函数
   */
  on(event: string, listener: (...args: any[]) => Promise<void>): void {
    if (!this.eventListeners[`${event}`]) {
      this.eventListeners[`${event}`] = [];
    }
    this.eventListeners[`${event}`].push(listener);
    //this.logger.info(`Listener added for event "${event}".`);
  }

  /**
   * 触发事件
   * @param event 事件名称
   * @param args 参数
   */
  async emit(event: string, ...args: any[]): Promise<void> {
    if (this.eventListeners[`${event}`]) {
      // this.logger.info(`Emitting event "${event}" with args:`, args);
      for (const listener of this.eventListeners[`${event}`]) {
        try {
          await listener(...args);
        } catch (err) {
          this.logger.error(`Error in event listener for "${event}":`, err);
        }
      }
    } else {
      //this.logger.info(`No listeners for event "${event}".`);
    }
  }

  /**
   * 注册全局中间件
   * @param name 中间件名称
   * @param middleware 中间件
   * @returns Core对象
   */
  use(name: string, middleware: Middleware): Core {
    this.globalMiddlewares[name] = middleware;
    return this;
  }

  /**
   * 定义指令
   * @param name 指令名称
   * @returns 指令对象
   */
  command(name: string): Command {
    const command = new Command(this, name); // 传递 Core 实例
    this.commands[`${name}`] = command;
    return command;
  }

  /**
   * 执行指令
   * @param name 指令名称
   * @param session 会话
   * @param args 参数
   * @returns 回话/null
   */
  async executeCommand(name: string, session: any, ...args: any[]): Promise<Session | null> {
    const command = this.commands[`${name}`];
    if (command) {
      // 将 globalMiddlewares 从对象转为数组
      const globalMiddlewareList = Object.values(this.globalMiddlewares || {});
      const commandMiddlewareList = command.middlewares || [];

      // 如果有中间件，执行中间件链
      if (globalMiddlewareList.length > 0 || commandMiddlewareList.length > 0) {
        const middlewares = [...globalMiddlewareList, ...commandMiddlewareList];

        let index = 0;
        const runner = async (): Promise<void> => {
          if (index >= middlewares.length) {
            await command.executeHandler(session, ...args);
            return;
          }

          const middleware = middlewares[index++];
          await middleware(session, runner);
        };

        await runner();
        return session;
      } else {
        return await command.execute(session, ...args);
      }
    }
    return null;
  }

  /**
   * 注册平台
   * @param platform 平台名称
   * @returns 启动结果
   */
  registerPlatform(platform: Platform): any {
    this.platforms.push(platform);
    return platform.startPlatform(this);
  }
  /**
   * 取消注册插件
   * @param pluginname 插件名称
   */
  unregall(pluginname: string): void {
    let cmdtodel = [];
    for (const cmd in this.cmdtoplu) {
      if (this.cmdtoplu[cmd] === pluginname) {
        cmdtodel.push(cmd);
      }
    }
    for (const cmd of cmdtodel) {
      delete this.cmdtoplu[cmd];
      delete this.commands[cmd];
    }
    let comptodel = [];
    for (const comp in this.comtoplu) {
      if (this.comtoplu[comp] === pluginname) {
        comptodel.push(comp);
      }
    }
    for (const comp of comptodel) {
      delete this.comtoplu[comp];
      delete this.components[comp];
      delete this.providedComponents[comp];
    }
    let evttodel: string[] = [];

    for (const evt in this.evttoplu) {
      if (this.evttoplu[evt][pluginname]) {
        // 清除插件在 evttoplu 中的记录
        delete this.evttoplu[evt][pluginname];

        // 如果该事件的插件已经全部清除了，也可以选择删掉整个事件
        if (Object.keys(this.evttoplu[evt]).length === 0) {
          evttodel.push(evt);
        }

        // 同时在 this.eventListeners 中删掉对应 listener
        const pluginListeners = this.evttoplu[evt][pluginname] || [];
        this.eventListeners[evt] = this.eventListeners[evt]?.filter(l => !pluginListeners.includes(l)) || [];
      }
    }
    let mdwtodel = [];
    for (const mdw in this.mdwtoplu) {
      if (this.mdwtoplu[mdw] === pluginname) {
        mdwtodel.push(mdw);
      }
    }
    for (const mdw of mdwtodel) {
      delete this.mdwtoplu[mdw];
      delete this.globalMiddlewares[mdw];
    }
  }
  /**
   * 获取指令对象
   * @param name 指令名称
   * @returns null/指令对象
   */
  getCommand(name: string): Command | null {
    if (Object.hasOwn(this.commands, name)) {
      return this.commands[name]; 
    } else {
      return null;
    }
  }
}
