/**
 * @time: 2025/03/25 18:01
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
  public plugins: { [name: string]: Plugin } = {};
  public config: any = null;
  private eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
  private components: { [name: string]: any } = {};
  public commands: Record<string, Command> = {};
  private pluginLoader: PluginLoader;
  private logger = new Logger('core');

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
  // 加载插件
  async loadPlugins(): Promise<void> {
    if (!this.config || !this.config.plugins) {
      this.logger.info('No plugins to load.');
      return;
    }
    for (const plugins of this.config.plugins) {
      try {
        this.logger.info(`Loading plugin: ${plugins.name}`);
        const config = new Config(plugins.name, plugins.config);
        await this.loadPlugin(plugins.name, config);
      } catch (err) {
        this.logger.error(`Failed to load plugin ${plugins.name}:`, err);
      }
    }
    if (process.env.NODE_ENV === 'development') {
      this.watchPlugins(this);
    }
  }

  async loadPlugin(name: string, config: Config) {
    const plugin = await this.pluginLoader.load(name);

    this.plugins[name] = plugin;
    this.logger.info(`Plugin ${name} loaded.`);

    if (plugin.apply) {
      this.logger.info(`Applying plugin: ${name}`);
      await plugin.apply(this, config);
      this.logger.info(`Plugin ${name} applied.`);
    }
  }
  /**
   * 监听插件目录，实现热重载
   * @param core Core实例
   * @param config Config实例
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
      if (!changePath.endsWith('.ts')) return;
      const pluginName = changePath.split('/')[1];
      this.logger.info(`Plugin changed: ${pluginName}`);
      try {
        const pluginDirName = path.dirname(pluginName);
        const config = await core.getPluginConfig(pluginName);
        const plugin = core.plugins[pluginName];
        if (plugin.disable) {
          await plugin.disable(core);
        }
        await core.pluginLoader.unloadPlugin(pluginName);
        delete core.plugins[pluginName];
        await core.loadPlugin(pluginName, config);

        core.emit('plugin-reloaded', pluginName);
      } catch (error) {
        this.logger.error(`Failed to reload plugin ${pluginName}:`, error);
      }
    });

    watcher.on('unlink', async (changePath) => {
      if (!changePath.endsWith('.ts')) return;
      const pluginName = changePath.split('/')[1];
      this.logger.info(`Plugin removed: ${pluginName}`);
      try {
        const plugin = core.plugins[pluginName];
        if (plugin.disable) {
          await plugin.disable(core);
        }
        await core.pluginLoader.unloadPlugin(pluginName);
        delete core.plugins[pluginName];
        core.emit('plugin-unloaded', pluginName);
      } catch (error) {
        this.logger.error(`Failed to unload plugin ${pluginName}:`, error);
      }
    });

    logger.info(`Watching for plugin changes in ${pluginsDir}`);
  }

  // 注册组件
  registerComponent(name: string, component: any): void {
    if (this.components[name]) {
      this.logger.warn(`Component "${name}" already registered.`);
    }
    this.components[name] = component;
    this.logger.info(`Component "${name}" registered.`);
  }

  // 获取组件
  getComponent(name: string): any {
    return this.components[name];
  }

  // 取消注册组件
  unregisterComponent(name: string): void {
    delete this.components[name];
  }

  // 事件系统：监听事件
  on(event: string, listener: (...args: any[]) => Promise<void>): void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
    this.logger.info(`Listener added for event "${event}".`);
  }

  // 事件系统：触发事件
  async emit(event: string, ...args: any[]): Promise<void> {
    if (this.eventListeners[event]) {
      this.logger.info(`Emitting event "${event}" with args:`, args);
      for (const listener of this.eventListeners[event]) {
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
    this.commands[name] = command;
    return command;
  }

  // 执行指令
  async executeCommand(name: string, session: any, ...args: any[]): Promise<Session | null> {
    const command = this.commands[name];
    if (command) {
      return await command.execute(session, ...args);
    }
    return null;
  }
}