  import * as yaml from 'js-yaml';
  import * as fs from 'fs';
  import * as path from 'path';

  interface Plugin {
    apply: (core: Core) => Promise<void>;
  }

  interface PluginLoader {
    load: (pluginName: string) => Promise<Plugin>;
  }

  interface CoreOptions {
    // 可以根据需要添加配置项
  }

  class Core {
    public plugins: { [name: string]: Plugin } = {};
    public config: any = null;
    private eventListeners: { [event: string]: ((...args: any[]) => Promise<void>)[] } = {};
    private components: { [name: string]: any } = {};

    constructor(options?: CoreOptions) {
      //  可以根据 options 初始化
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

    // 加载插件
    async loadPlugins(pluginLoader: PluginLoader): Promise<void> {
      if (!this.config || !this.config.plugins) {
        console.log('No plugins to load.');
        return;
      }

      for (const pluginName of this.config.plugins) {
        try {
          console.log(`Loading plugin: ${pluginName}`);

          const plugin = await pluginLoader.load(pluginName);

          this.plugins[pluginName] = plugin;
          console.log(`Plugin ${pluginName} loaded.`);

          if (plugin.apply) {
            console.log(`Applying plugin: ${pluginName}`);
            await plugin.apply(this);
            console.log(`Plugin ${pluginName} applied.`);
          }
        } catch (err) {
          console.error(`Failed to load plugin ${pluginName}:`, err);
        }
      }
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
  }

  export default Core;