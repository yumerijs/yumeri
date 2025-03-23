import * as path from 'path';
import { Core, Config } from '@yumerijs/core';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { satisfies } from 'semver';
import * as tsNode from 'ts-node';
import chokidar from 'chokidar';
import { pathToFileURL } from 'url';

const execAsync = promisify(exec);

interface Plugin {
  apply: (core: Core, config: Config) => Promise<void>;
}

class PluginLoader {
  private pluginCache: { [name: string]: Plugin } = {};
  private core: Core | null = null;
  private config: Config | null = null;
  private isDev: boolean = false;
  private pluginsDir: string = 'plugins'; // Default plugins directory

  constructor(core?: Core, config?: Config, pluginsDir: string = 'plugins') {
    this.pluginCache = {};
    this.core = core || null;
    this.config = config || null;
    this.isDev = process.env.NODE_ENV === 'development';
    this.pluginsDir = pluginsDir;
  }

  setCoreAndConfig(core: Core, config: Config) {
      this.core = core;
      this.config = config;
  }

  /**
   * 从本地目录或 npm 包加载插件.
   * @param pluginName 插件名称或路径.
   * @returns 加载的插件对象.
   * @throws 如果插件加载失败.
   */
  async load(pluginName: string): Promise<Plugin> {
      if (this.pluginCache[pluginName]) {
          console.log(`Returning cached plugin: ${pluginName}`);
          return this.pluginCache[pluginName];
      }

      let pluginPath: string;
      let isLocalPlugin = false;

      // 1. 检查是否是本地插件目录下的插件
      const localPluginPath = path.resolve(this.pluginsDir, pluginName);
      if (fs.existsSync(localPluginPath)) {
          pluginPath = localPluginPath;
          isLocalPlugin = true;
      }
      // 2. 检查是否是绝对路径或相对路径
      else if (path.isAbsolute(pluginName) || pluginName.startsWith('.')) {
          pluginPath = path.resolve(pluginName);
          isLocalPlugin = true;
      }
      // 3. 尝试作为 npm 包加载
      else {
          try {
              // 尝试 require，如果成功，则认为是一个已安装的 npm 包
              require.resolve(pluginName);  // 检查包是否已安装
              pluginPath = pluginName;
          } catch (e: any) {
              // 如果 require.resolve 失败，则抛出错误
              if (e.code === 'MODULE_NOT_FOUND') {
                  throw new Error(`Plugin ${pluginName} not found. Please install it first.`);
              }
              throw e;  // 其他类型的错误，直接抛出
          }
      }

      try {
          const plugin = await this.loadPluginFromPath(pluginPath, isLocalPlugin);
          this.pluginCache[pluginName] = plugin;
          return plugin;
      } catch (e) {
          console.error(`Failed to load plugin from ${pluginPath}:`, e);
          throw e;
      }
  }

  /**
   * 从指定路径加载插件.
   * @param pluginPath 插件路径.
   * @param isLocalPlugin 是否是本地插件
   * @returns 加载的插件对象.
   * @throws 如果插件加载失败.
   */
  private async loadPluginFromPath(pluginPath: string, isLocalPlugin: boolean): Promise<Plugin> {
    try {
      let targetPath = pluginPath;
      if (isLocalPlugin && this.isDev) {
        const targetPath = path.join(pluginPath, 'src', 'index.ts');
        if (!fs.existsSync(targetPath)) {
            throw new Error(`src/index.ts not found in ${pluginPath}`);
        }
        const module = await import(pathToFileURL(targetPath).toString());
        return module;
      } else {
        targetPath = require.resolve(pluginPath);
        const pluginModule = require(targetPath);
         return pluginModule
      }
    } catch (e) {
      console.error(`Error loading plugin from path ${pluginPath}:`, e);
      throw e;
    }
  }

  /**
   * 卸载插件
   * @param pluginName 插件名称
   */
  /**
   * 卸载插件
   * @param pluginName 插件名称
   */
  async unloadPlugin(pluginName: string): Promise<void> {
    if (!this.pluginCache[pluginName]) {
        return; // Plugin not loaded
    }

    delete this.pluginCache[pluginName];

    // Clear the module from the require cache
    const pluginPath = path.resolve(this.pluginsDir, pluginName, 'src', 'index.ts');
    const resolvedPath =  pathToFileURL(pluginPath).toString();

    if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
    }

    console.log(`Plugin unloaded: ${pluginName}`);
}

  /**
   * 检查插件的依赖是否满足.
   * @param pluginPath 插件路径.
   * @returns 如果依赖满足，则返回 true，否则返回 false.
   */
  async checkPluginDependencies(pluginPath: string): Promise<boolean> {
    // TODO: 读取插件package.json，检查依赖是否满足
    return true;
  }

  /**
   * 安装插件的依赖.
   * @param pluginPath 插件路径.
   */
  async installPluginDependencies(pluginName: string): Promise<void> {
    try {
      console.log(`Installing dependencies for plugin: ${pluginName}`);
      const { stdout, stderr } = await execAsync(`npm install ${pluginName} --save`);
      console.log(`stdout: ${stdout}`);
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
      console.log(`Dependencies installed for plugin: ${pluginName}`);
    } catch (error: any) {
      console.error(`Error installing dependencies for plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * 监听插件目录，实现热重载
   * @param core Core实例
   * @param config Config实例
   * @param pluginsDir 插件目录
   */
  watchPlugins(core: Core, config: Config, pluginsDir: string = 'plugins') {
    const watcher = chokidar.watch(pluginsDir, {
      ignored: /(^|[/\\])\../, // 忽略点文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    watcher.on('add', async (pluginName) => {
          if (pluginName.endsWith('.ts') || pluginName.endsWith('.js')) return;
          console.log(`New plugin detected: ${pluginName}`);
          try {
              // 仅加载目录名作为插件名
              const pluginDirName = path.basename(pluginName);
              await this.load(pluginDirName);
              if (this.core && this.config)
                  this.core.emit('plugin-loaded', pluginName);

          } catch (error) {
              console.error(`Failed to load new plugin ${pluginName}:`, error);
          }
      });

    watcher.on('change', async (pluginName) => {
        if (!pluginName.endsWith('.ts')) return;
        console.log(`Plugin changed: ${pluginName}`);
        try {
            const pluginDirName = path.dirname(pluginName);
            //const pluginDirName = path.basename(pluginName);
            await this.unloadPlugin(pluginDirName);
            await this.load(pluginDirName);
            if (this.core && this.config)
               this.core.emit('plugin-reloaded', pluginName);
        } catch (error) {
            console.error(`Failed to reload plugin ${pluginName}:`, error);
        }
    });

    watcher.on('unlink', async (pluginName) => {
        if (!pluginName.endsWith('.ts')) return;
        console.log(`Plugin removed: ${pluginName}`);
        try {
            const pluginDirName = path.dirname(pluginName);
            //const pluginDirName = path.basename(pluginName);
            await this.unloadPlugin(pluginDirName);
            if (this.core && this.config)
                this.core.emit('plugin-unloaded', pluginName);
        } catch (error) {
            console.error(`Failed to unload plugin ${pluginName}:`, error);
        }
    });

    console.log(`Watching for plugin changes in ${pluginsDir}`);
  }
}

export default PluginLoader;