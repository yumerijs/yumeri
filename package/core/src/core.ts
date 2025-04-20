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
  // Note: depend and provide are handled after plugin load due to loader constraints
}

interface PluginLoader {
  load(pluginName: string): Promise<Plugin>;
  unloadPlugin(pluginName: string): Promise<void>;
  checkPluginDependencies(pluginPath: string): Promise<boolean>;
  installPluginDependencies(pluginName: string): Promise<void>;
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
    for (const plugins of this.config.plugins) {
      if (plugins.name == pluginName) {
        const config = new Config(plugins.name, plugins.config);
        return config;
      }
    }
    return new Config(pluginName);
  }

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

  // 加载插件
  async loadPlugins(): Promise<void> {
    if (!this.config || !this.config.plugins) {
      this.logger.info('No plugins to load.');
      return;
    }

    const pluginsToLoad = [...this.config.plugins];
    const loadedPluginNames: string[] = [];
    let loadAttempted: { [name: string]: boolean } = {};
    let remainingPlugins = [...pluginsToLoad];

    while (remainingPlugins.length > 0) {
      let loadedInThisPass = false;
      const nextRemainingPlugins: any[] = [];

      for (const pluginConfig of remainingPlugins) {
        const pluginName = pluginConfig.name;
        if (loadedPluginNames.includes(pluginName) || loadAttempted[`${pluginName}`]) {
          continue;
        }
        loadAttempted[`${pluginName}`] = true;

        try {
          this.logger.info(`Attempting to load plugin: ${pluginName}`);
          const pluginInstance = await this.pluginLoader.load(pluginName);
          const pluginModule = await this.importPluginModule(pluginName);

          if (pluginInstance && pluginModule) {
            const depend: string[] | undefined = pluginModule.depend;
            const provide: string[] | undefined = pluginModule.provide;

            const unmetDependencies = depend?.filter(dep => !this.components.hasOwnProperty(dep)) || [];

            if (unmetDependencies.length === 0) {
              this.plugins[`${pluginName}`] = Object.assign(pluginInstance, { depend, provide });
              this.pluginModules[`${pluginName}`] = pluginModule;
              this.logger.info(`Plugin ${pluginName} loaded.`);
              loadedPluginNames.push(pluginName);
              loadedInThisPass = true;

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
              nextRemainingPlugins.push(pluginConfig);
              this.logger.warn(
                `Plugin ${pluginName} has unmet dependencies: ${unmetDependencies.join(', ')}. Will try again later.`
              );
            }
          } else {
            this.logger.warn(`Plugin "${pluginName}" could not be loaded or its module could not be imported.`);
          }
        } catch (err) {
          this.logger.error(`Failed to load or process plugin ${pluginName}:`, err);
        }
      }

      if (!loadedInThisPass && nextRemainingPlugins.length === remainingPlugins.length && remainingPlugins.length > 0) {
        this.logger.error(
          'Detected circular or unresolvable plugin dependencies. Remaining plugins:',
          nextRemainingPlugins.map(p => p.name)
        );
        break; // Prevent infinite loop
      }

      remainingPlugins = nextRemainingPlugins;
    }

    // Apply plugins now that (hopefully) dependencies are loaded
    for (const pluginName of loadedPluginNames) {
      const plugin = this.plugins[`${pluginName}`];
      const config = await this.getPluginConfig(pluginName);
      if (plugin && plugin.apply) {
        this.logger.info(`Applying plugin: ${pluginName}`);
        await plugin.apply(this, config);
        this.logger.info(`Plugin ${name} applied.`);
        // Register provided components after apply, in case apply logic influences it
        const provide = plugin.provide;
        if (provide) {
          for (const componentName of provide) {
            this.registerComponent(componentName, plugin); // Register the plugin instance as the component
          }
        }
      }
    }

    if (remainingPlugins.length > 0) {
      this.logger.warn(
        'Some plugins could not be fully loaded due to unresolved dependencies:',
        remainingPlugins.map(p => p.name)
      );
    }

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
      await this.loadPlugins();
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
      const plugin = core.plugins[`${pluginName}`];
      if (plugin && plugin.disable) {
        await plugin.disable(core);
      }
      await core.pluginLoader.unloadPlugin(pluginName);
      delete core.plugins[`${pluginName}`];
      delete this.pluginModules[`${pluginName}`];
      // Temporarily remove provided components from this plugin
      for (const componentName in this.providedComponents) {
        if (this.providedComponents[`${componentName}`] === pluginName) {
          delete this.components[`${componentName}`];
          delete this.providedComponents[`${componentName}`];
        }
      }

      await this.loadPlugins();

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
    this.logger.info(`Listener added for event "${event}".`);
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
      this.logger.info(`No listeners for event "${event}".`);
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