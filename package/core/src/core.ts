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
import chokidar from 'chokidar';

interface Plugin {
  apply: (core: Core, config: Config) => Promise<void>;
  disable: (core: Core) => Promise<void>;
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
  private eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
  private components: { [name: string]: any } = {};
  public commands: Record<string, Command> = {};
  private pluginLoader: PluginLoader;
  private logger = new Logger('core');
  private providedComponents: { [name: string]: string } = {}; // componentName: pluginName
  private pluginModules: { [name: string]: any } = {}; // Store imported plugin modules

  constructor(pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader;
  }

  // 加载配置文件
  async loadConfig(configPath: string): Promise<void> {
    try {
      const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
      this.config = doc;
      this.logger.info('Config loaded.');
    } catch (e) {
      this.logger.error('Failed to load config:', e);
      throw e; // 抛出异常，让上层处理
    }
  }

  async getPluginConfig(pluginName: string): Promise<Config> {
    if (!this.config.pluginName) {
      return new Config(pluginName);
    }
    const config = new Config(pluginName, this.config.pluginName);
    return config;
  }
/*
  private async importPluginModule(pluginName: string): Promise<any | undefined> {
    try {
      // Assuming plugin files are in a 'plugins' directory and follow a naming convention
      const pluginPath = path.resolve('plugins', pluginName, 'index.js'); // Or .ts if you're using ts-node
      if (fs.existsSync(pluginPath)) {
        const module = await import(pluginPath);
        return module;
      }
      const alternativePath = path.resolve('plugins', `${pluginName}.js`); // Or .ts
      if (fs.existsSync(alternativePath)) {
        const module = await import(alternativePath);
        return module;
      }
      this.logger.warn(`Could not find main file (index.js or ${pluginName}.js/ts) for plugin: ${pluginName}`);
      return undefined;
    } catch (error) {
      this.logger.error(`Error importing plugin module for ${pluginName}:`, error);
      return undefined;
    }
  }
*/
  // 加载插件
async loadPlugins(): Promise<void> {
    // 检查 plugins 配置是否存在且是对象类型
    if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
      this.logger.info('No plugins configuration found or it is not an object. No plugins to load.');
      return;
    }

    // 获取所有需要加载的插件名
    const pluginNamesToLoad = Object.keys(this.config.plugins);

    if (pluginNamesToLoad.length === 0) {
       this.logger.info('Plugins configuration is empty. No plugins to load.');
       return;
    }

    const loadedPluginNames: string[] = [];
    // 使用对象来跟踪尝试加载的插件名
    let loadAttempted: { [name: string]: boolean } = {};
    // 使用插件名数组来管理剩余待加载的插件
    let remainingPluginNames = [...pluginNamesToLoad];

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
        await pluginInstance.apply(this, await this.getPluginConfig(pluginName));
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
      const pluginName = parts.slice(0, 2).join(path.sep);
      const simplePluginName = parts.length >= 2 ? parts.slice(0, 2).join('/') : path.basename(changePath, path.extname(changePath));

      this.logger.info(`Plugin file changed: ${simplePluginName}`);
      this.reloadPlugin(simplePluginName, core);
    });

    watcher.on('add', async (changePath) => {
      if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return;
      const parts = changePath.split(path.sep);
      if (parts.length < 2) return;
      const pluginName = parts.slice(0, 2).join(path.sep);
      const simplePluginName = parts.length >= 2 ? parts.slice(0, 2).join('/') : path.basename(changePath, path.extname(changePath));

      this.logger.info(`New plugin file added: ${simplePluginName}`);
      this.reloadPlugin(simplePluginName, core);
    });

    watcher.on('unlink', async (changePath) => {
      if (!changePath.endsWith('.ts') && !changePath.endsWith('.js')) return;
      const parts = changePath.split(path.sep);
      if (parts.length < 2) return;
      const pluginName = parts.slice(0, 2).join(path.sep);
      const simplePluginName = parts.length >= 2 ? parts.slice(0, 2).join('/') : path.basename(changePath, path.extname(changePath));

      this.logger.info(`Plugin file removed: ${simplePluginName}`);
      await this.unloadPluginAndEmit(simplePluginName, core);
    });

    logger.info(`Watching for plugin changes in ${pluginsDir}`);
  }

  private async reloadPlugin(pluginName: string, core: Core) {
    try {
      const config = await core.getPluginConfig(pluginName);
      const plugin = await core.pluginLoader.load(pluginName);
      if (plugin && plugin.disable) {
        await plugin.disable(core);
      }
      if (plugin.provide) {
        for (let providedmodules of plugin.provide) {
          if (this.components[`${providedmodules}`]) {
            this.unregisterComponent(providedmodules);
          }
        }
      }
      await core.pluginLoader.unloadPlugin(pluginName);
      if (plugin && plugin.apply) {
        await plugin.apply(core, config);
      }
      this.pluginLoader.logger.info(`apply plugin ${pluginName}`);

      core.emit('plugin-reloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to reload plugin ${pluginName}:`, error);
    }
  }

  private async unloadPluginAndEmit(pluginName: string, core: Core) {
    try {
      const plugin = core.plugins[`${pluginName}`];
      if (plugin && plugin.disable) {
        await plugin.disable(core);
      }
      await core.pluginLoader.unloadPlugin(pluginName);
      delete core.plugins[`${pluginName}`];
      delete this.pluginModules[`${pluginName}`];
      // Remove provided components from this plugin
      for (const componentName in this.providedComponents) {
        if (this.providedComponents[`${componentName}`] === pluginName) {
          delete this.components[`${componentName}`];
          delete this.providedComponents[`${componentName}`];
        }
      }
      core.emit('plugin-unloaded', pluginName);
    } catch (error) {
      this.logger.error(`Failed to unload plugin ${pluginName}:`, error);
    }
  }

  // 注册组件
  registerComponent(name: string, component: any): void {
    if (this.components.hasOwnProperty(name)) {
      this.logger.warn(`Component "${name}" already registered by plugin "${this.providedComponents[`${name}`]}".`);
      return;
    }
    this.components[`${name}`] = component;
    this.logger.info(`Component "${name}" registered.`);
  }

  // 获取组件
  getComponent(name: string): any {
    return this.components[`${name}`];
  }

  // 取消注册组件
  unregisterComponent(name: string): void {
    delete this.components[`${name}`];
    delete this.providedComponents[`${name}`];
  }

  // 事件系统：监听事件
  on(event: string, listener: (...args: any[]) => Promise<void>): void {
    if (!this.eventListeners[`${event}`]) {
      this.eventListeners[`${event}`] = [];
    }
    this.eventListeners[`${event}`].push(listener);
    //this.logger.info(`Listener added for event "${event}".`);
  }

  // 事件系统：触发事件
  async emit(event: string, ...args: any[]): Promise<void> {
    if (this.eventListeners[`${event}`]) {
      this.logger.info(`Emitting event "${event}" with args:`, args);
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

  // 定义指令
  command(name: string): Command {
    const command = new Command(this, name); // 传递 Core 实例
    this.commands[`${name}`] = command;
    return command;
  }

  // 执行指令
  async executeCommand(name: string, session: any, ...args: any[]): Promise<Session | null> {
    const command = this.commands[`${name}`];
    if (command) {
      return await command.execute(session, ...args);
    }
    return null;
  }
}