import * as path from 'path';
import { Core, Config, Logger, Context } from '@yumerijs/core';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { pathToFileURL } from 'url';

const execAsync = promisify(exec);

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

class PluginLoader {
    private pluginCache: { [name: string]: Plugin } = {};
    private core: Core | null = null;
    private config: Config | null = null;
    private isDev: boolean = false;
    private pluginsDir: string = 'plugins'; // Default plugins directory
    public logger = new Logger('loader');

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

    async load(pluginName: string): Promise<Plugin> {
        if (this.pluginCache[pluginName] && !this.isDev) {
            return this.pluginCache[pluginName];
        }

        let pluginPath: string;
        let isLocalPlugin = false;

        const localPluginPath = path.resolve(process.cwd(), this.pluginsDir, pluginName);
        const localPluginPathAlt = path.resolve(process.cwd(), pluginName);

        if (fs.existsSync(localPluginPath)) {
            pluginPath = localPluginPath;
            isLocalPlugin = true;
        } else if (fs.existsSync(localPluginPathAlt)) {
            pluginPath = localPluginPathAlt;
            isLocalPlugin = true;
        } else if (path.isAbsolute(pluginName) || pluginName.startsWith('.')) {
            pluginPath = path.resolve(pluginName);
            isLocalPlugin = true;
        } else {
            try {
                pluginPath = require.resolve(pluginName);
            } catch (e: any) {
                if (e.code === 'MODULE_NOT_FOUND') {
                    throw new Error(`Plugin ${pluginName} not found. Please install it first.`);
                }
                throw e;
            }
        }

        try {
            const plugin = await this.loadPluginFromPath(pluginPath, isLocalPlugin);
            this.pluginCache[pluginName] = plugin;
            return plugin;
        } catch (e) {
            this.logger.error(`Failed to load plugin from ${pluginPath}:`, e);
            throw e;
        }
    }

    private async loadPluginFromPath(pluginPath: string, isLocalPlugin: boolean): Promise<Plugin> {
        try {
            let targetPath = pluginPath;

            if (isLocalPlugin && this.isDev) {
                const jsonPath = path.join(pluginPath, 'package.json');
                if (fs.existsSync(jsonPath)) {
                    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
                    const pkg = JSON.parse(jsonContent);
                    if (pkg.dev) {
                        targetPath = path.join(pluginPath, pkg.dev);
                    } else if (pkg.main) {
                        targetPath = path.join(pluginPath, pkg.main);
                    }
                }
            }

            if (this.isDev) {
                // In development, use require() to leverage esbuild-register
                // and clear cache for HMR.
                const resolvedPath = require.resolve(targetPath);
                
                // Clean up the cache for the main module and its children
                if (require.cache[resolvedPath]) {
                    this.clearRequireCache(resolvedPath, new Set());
                }

                const module = require(resolvedPath);
                return module.default || module;
            } else {
                // In production, use dynamic import.
                const url = pathToFileURL(targetPath).href;
                const module = await import(url);
                return module.default || module;
            }
        } catch (e) {
            this.logger.error(`Error loading plugin from path ${pluginPath}:`, e);
            throw e;
        }
    }

    private clearRequireCache(moduleId: string, visited: Set<string>) {
        if (visited.has(moduleId)) {
            return; // Cycle detected
        }
        visited.add(moduleId);

        const module = require.cache[moduleId];
        if (!module) return;

        // Recursively clear children's cache
        if (module.children) {
            for (const child of module.children) {
                this.clearRequireCache(child.id, visited);
            }
        }

        // Delete the module from cache
        delete require.cache[moduleId];
    }


    async unloadPlugin(pluginName: string): Promise<void> {
        if (!this.pluginCache[pluginName]) {
            return; // Plugin not loaded
        }

        delete this.pluginCache[pluginName];
        
        // With dynamic import, there's no direct equivalent of require.cache to clear.
        // The timestamp query in dev mode handles fresh loading.
        // For production, modules are cached intentionally.
        
        this.core?.unregall(pluginName);
        // this.logger.info(`Plugin unloaded: ${pluginName}`);
    }

    async checkPluginDependencies(pluginPath: string): Promise<boolean> {
        // TODO: Implement dependency checking from package.json
        return true;
    }

    async installPluginDependencies(pluginName: string): Promise<void> {
        try {
            this.logger.info(`Installing dependencies for plugin: ${pluginName}`);
            const { stdout, stderr } = await execAsync(`npm install ${pluginName} --save`);
            this.logger.info(`stdout: ${stdout}`);
            if (stderr) {
                this.logger.error(`stderr: ${stderr}`);
            }
            this.logger.info(`Dependencies installed for plugin: ${pluginName}`);
        } catch (error: any) {
            this.logger.error(`Error installing dependencies for plugin ${pluginName}:`, error);
            throw error;
        }
    }
}

export default PluginLoader;
