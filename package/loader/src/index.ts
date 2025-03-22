import * as path from 'path';
import { Core, Config } from '@yumerijs/core';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { satisfies } from 'semver';

const execAsync = promisify(exec);

interface Plugin {
  apply: (core: Core, config: Config) => Promise<void>;
}

class PluginLoader {
  private pluginCache: { [name: string]: Plugin } = {};

  constructor() {
    this.pluginCache = {};
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

    // 1. 检查是否是本地路径
    if (path.isAbsolute(pluginName) || pluginName.startsWith('.')) {
      pluginPath = path.resolve(pluginName);
    }
    // 2. 尝试作为 npm 包加载
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
      const plugin = await this.loadPluginFromPath(pluginPath);
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
   * @returns 加载的插件对象.
   * @throws 如果插件加载失败.
   */
  private async loadPluginFromPath(pluginPath: string): Promise<Plugin> {
    try {
      const resolvedPath = require.resolve(pluginPath);
      const pluginModule = require(resolvedPath);

      if (typeof pluginModule === 'function') {
        // 假设导出一个函数
        return { apply: pluginModule };
      } else if (typeof pluginModule.apply === 'function') {
        // 假设导出一个对象，并且有 apply 方法
        return pluginModule;
      } else {
        throw new Error(`Plugin at ${pluginPath} does not export an 'apply' function.`);
      }
    } catch (e) {
      console.error(`Error loading plugin from path ${pluginPath}:`, e);
      throw e;
    }
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
}

export default PluginLoader;