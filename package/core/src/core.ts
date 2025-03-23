/**
 * @time: 2025/03/24 00:19
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/ 
  import * as yaml from 'js-yaml';
  import * as fs from 'fs';
  import * as path from 'path';
  import { Config } from './config';
  import { Command } from './command';
  import chokidar from 'chokidar';

  interface Plugin {
    apply: (core: Core, config: Config) => Promise<void>;
  }

  interface PluginLoader {
  load(pluginName: string): Promise<Plugin>;
  unloadPlugin(pluginName: string): Promise<void>;
  checkPluginDependencies(pluginPath: string): Promise<boolean>;
  installPluginDependencies(pluginName: string): Promise<void>;
  watchPlugins(core: Core, config: Config, pluginsDir: string): void;
}
  interface CoreOptions {
    // 可以根据需要添加配置项
  }

  export class Core {
    public plugins: { [name: string]: Plugin } = {};
    public config: any = null;
    private eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
    private components: { [name: string]: any } = {};
    public commands: Record<string, Command> = {};
    private pluginLoader: PluginLoader;

    constructor(pluginLoader: PluginLoader) {
      this.pluginLoader = pluginLoader;
    }

    // 加载配置文件
    async loadConfig(configPath: string): Promise<void> {
      try {
        const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
        this.config = doc;
        console.log('Config loaded:', this.config);
      } catch (e) {
        console.error('Failed to load config:', e);
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
        console.log('No plugins to load.');
        return;
      }
      for (const plugins of this.config.plugins) {
        try {
          console.log(`Loading plugin: ${plugins.name}`);
          const config = new Config(plugins.name, plugins.config);
          await this.loadPlugin(plugins.name, config);
        } catch (err) {
          console.error(`Failed to load plugin ${plugins.name}:`, err);
        }
      }
      this.watchPlugins(this);
    }
    
    async loadPlugin(name: string, config: Config) {
      const plugin = await this.pluginLoader.load(name);

      this.plugins[name] = plugin;
      console.log(`Plugin ${name} loaded.`);

      if (plugin.apply) {
        console.log(`Applying plugin: ${name}`);
        await plugin.apply(this, config);
        console.log(`Plugin ${name} applied.`);
      }
    }
      /**
       * 监听插件目录，实现热重载
       * @param core Core实例
       * @param config Config实例
       * @param pluginsDir 插件目录
       */
  watchPlugins(core: Core, pluginsDir: string = 'plugins') {
    const watcher = chokidar.watch(pluginsDir, {
      ignored: /(^|[/\\])\../, // 忽略点文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    watcher.on('add', async (changePath) => {
          if (changePath.endsWith('.ts') || changePath.endsWith('.js')) return;
          //console.log(`New plugin detected: ${pluginName}`);
          const pluginName = changePath.split('/')[1];
          try {
              // 仅加载目录名作为插件名
              const pluginDirName = path.basename(pluginName);
              const config = await core.getPluginConfig(pluginName);
              await core.loadPlugin(pluginName, config);
              
              core.emit('plugin-loaded', pluginName);

          } catch (error) {
              console.error(`Failed to load new plugin ${pluginName}:`, error);
          }
      });

    watcher.on('change', async (changePath) => {
        if (!changePath.endsWith('.ts')) return;
        const pluginName = changePath.split('/')[1];
        console.log(`Plugin changed: ${pluginName}`);
        try {
            const pluginDirName = path.dirname(pluginName);
            const config = await core.getPluginConfig(pluginName);
            //const pluginDirName = path.basename(pluginName);
            await core.pluginLoader.unloadPlugin(pluginName);
            await core.loadPlugin(pluginName, config);
            
            core.emit('plugin-reloaded', pluginName);
        } catch (error) {
            console.error(`Failed to reload plugin ${pluginName}:`, error);
        }
    });

    watcher.on('unlink', async (changePath) => {
        if (!changePath.endsWith('.ts')) return;
        const pluginName = changePath.split('/')[1];
        console.log(`Plugin removed: ${pluginName}`);
        try {
            //const pluginDirName = path.dirname(pluginName);
            //const pluginDirName = path.basename(pluginName);
            await core.pluginLoader.unloadPlugin(pluginName);
            core.emit('plugin-unloaded', pluginName);
        } catch (error) {
            console.error(`Failed to unload plugin ${pluginName}:`, error);
        }
    });

    console.log(`Watching for plugin changes in ${pluginsDir}`);
  }
  
  

    // 注册组件
    registerComponent(name: string, component: any): void {
      if (this.components[name]) {
        console.warn(`Component "${name}" already registered.`);
      }
      this.components[name] = component;
      console.log(`Component "${name}" registered.`);
    }

    // 获取组件
    getComponent(name: string): any {
      return this.components[name];
    }

    // 事件系统：监听事件
    on(event: string, listener: (...args: any[]) => Promise<void>): void {
      if (!this.eventListeners[event]) {
        this.eventListeners[event] = [];
      }
      this.eventListeners[event].push(listener);
      console.log(`Listener added for event "${event}".`);
    }

    // 事件系统：触发事件
    async emit(event: string, ...args: any[]): Promise<void> {
      if (this.eventListeners[event]) {
        console.log(`Emitting event "${event}" with args:`, args);
        for (const listener of this.eventListeners[event]) {
          try {
            await listener(...args);
          } catch (err) {
            console.error(`Error in event listener for "${event}":`, err);
          }
        }
      } else {
        console.log(`No listeners for event "${event}".`);
      }
    }
    
    command(name: string): Command {
        const command = new Command(this, name); // 传递 Core 实例
        this.commands[name] = command;
        return command;
    }

    // 用于执行指令
    executeCommand(name: string, session: any, ...args: any[]): any {
        const command = this.commands[name];
        if (command) {
            return command.execute(session, ...args);
        }
        return null;
    }


  }