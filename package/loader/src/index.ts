
import * as path from 'path';
import { Core, Config, Logger, Context, PluginStatus } from '@yumerijs/core';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { pathToFileURL } from 'url';
import * as yaml from 'js-yaml';
import * as chokidar from 'chokidar';
import 'esbuild-register';

const execAsync = promisify(exec);

// This interface should probably be in @yumerijs/types
interface Plugin {
    apply: (ctx: Context, config: Config) => Promise<void>;
    disable: (ctx: Context) => Promise<void>;
    depend: Array<string>;
    provide: Array<string>;
}

export class PluginLoader {
    public core: Core;
    public config: any = null;
    public logger = new Logger('loader');
    public plugins: { [name: string]: Plugin & { depend?: string[]; provide?: string[] } } = {};
    public pluginStatus: Record<string, PluginStatus> = {};
    private pluginWatchers: Record<string, chokidar.FSWatcher> = {};
    private pluginModules: { [name: string]: any } = {};
    private configPath: string = '';
    private pluginContexts: Record<string, Context> = {};
    private isDev: boolean = false;

    constructor(core?: Core, private pluginsDir: string = 'plugins') {
        this.core = core || new Core(this, undefined, false);
        this.isDev = process.env.NODE_ENV === 'development';
        Logger.setCore(this.core);
    }

    /**
     * Reloads the config file from disk into memory and emits a 'config-reloaded' event.
     * This does NOT reload any plugins.
     */
    public async reloadConfigFile(): Promise<void> {
        this.logger.info('Reloading config file...');
        try {
            const doc = yaml.load(fs.readFileSync(this.configPath, 'utf8'));
            this.config = doc;
            this.core.coreConfig = this.config.core || {};
            this.core.emit('config-reloaded', this.config);
            this.logger.info('Config file reloaded.');
        } catch (e) {
            this.logger.error('Failed to reload config file:', e);
        }
    }

    getCore(): Core {
        return this.core;
    }

    getContext(pluginName: string): Context {
        if (!this.pluginContexts[pluginName]) {
            this.pluginContexts[pluginName] = new Context(this.core, pluginName);
        }
        return this.pluginContexts[pluginName];
    }

    unregall(pluginName: string): void {
        const ctx = this.pluginContexts[pluginName];
        if (ctx) {
            ctx.dispose();
            delete this.pluginContexts[pluginName];
        }
    }

    async loadConfig(configPath: string): Promise<void> {
        try {
            this.configPath = configPath;
            const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
            this.config = doc;
            this.logger.info('Config loaded.');

            this.core.coreConfig = this.config.core || {};
            this.core.i18n = new (require('@yumerijs/core').I18n)(this.core.coreConfig.lang || ['zh', 'en']);
        } catch (e) {
            this.logger.error('Failed to load config:', e);
            throw e;
        }
    }

    async getPluginConfig(pluginName: string): Promise<Config> {
        const actualPluginName = pluginName.startsWith('~') ? pluginName.substring(1) : pluginName;
        if (!this.config.plugins[actualPluginName]) {
            return new Config(actualPluginName);
        }
        return new Config(actualPluginName, this.config.plugins[actualPluginName]);
    }

    async loadPlugins(): Promise<void> {
        if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
            this.logger.info('No plugins configuration found. No plugins to load.');
            return;
        }

        const allPluginNames = Object.keys(this.config.plugins);
        this.pluginStatus = {}; // Reset status

        for (const name of allPluginNames) {
            if (name.startsWith('~')) {
                const actualName = name.substring(1);
                this.pluginStatus[actualName] = PluginStatus.DISABLED;
            } else {
                this.pluginStatus[name] = PluginStatus.PENDING;
            }
        }

        const enabledPlugins = allPluginNames.filter(name => !name.startsWith('~'));

        const currentlyLoaded = Object.keys(this.plugins);
        for (const loadedName of currentlyLoaded) {
            if (!enabledPlugins.includes(loadedName)) {
                await this.unloadPlugin(loadedName);
            }
        }

        if (enabledPlugins.length === 0) {
            this.logger.info('No enabled plugins found in configuration.');
            return;
        }

        let loadedInLastPass = true;
        while (loadedInLastPass) {
            loadedInLastPass = false;
            for (const pluginName of enabledPlugins) {
                if (this.pluginStatus[pluginName] === PluginStatus.ENABLED) {
                    continue;
                }
                const success = await this.loadSinglePlugin(pluginName, false);
                if (success) {
                    loadedInLastPass = true;
                }
            }
        }

        await this._loadPendingPlugins();

        const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
        if (pendingPlugins.length > 0) {
            // this.logger.warn('Some plugins could not be loaded due to unresolved dependencies:', pendingPlugins);
        }
    }

    public async loadSinglePlugin(pluginName: string, triggerPendingCheck: boolean = true, onlypending: boolean = false): Promise<boolean> {
        if (!this.pluginStatus[pluginName]) {
            this.pluginStatus[pluginName] = PluginStatus.PENDING;
        }

        if (this.pluginStatus[pluginName] !== PluginStatus.PENDING && onlypending) {
            return false;
        }

        try {
            const pluginInstance = await this.loadModule(pluginName);
            if (!pluginInstance) {
                throw new Error('Plugin loader returned no instance.');
            }

            const deps = pluginInstance.depend || [];
            const unmetDependencies = deps.filter(dep => !this.core.components[dep]);

            if (unmetDependencies.length > 0) {
                return false;
            }

            this.plugins[pluginName] = pluginInstance;
            
            const pluginConfig = await this.getPluginConfig(pluginName);
            const context = this.getContext(pluginName);

            await this.core.plugin(pluginInstance, context, pluginConfig);

            this.pluginStatus[pluginName] = PluginStatus.ENABLED;

            if (triggerPendingCheck) {
                await this._loadPendingPlugins();
            }

            if (this.isDev) {
                let pluginPathToWatch: string | null = null;
                try {
                    const pkgJsonPath = require.resolve(`${pluginName}/package.json`);
                    pluginPathToWatch = path.dirname(pkgJsonPath);
                } catch (e) {
                    const localPluginPath = path.resolve(process.cwd(), pluginName);
                    const localPluginPathInPlugins = path.resolve(process.cwd(), 'plugins', pluginName);
                    if (fs.existsSync(localPluginPath)) {
                        pluginPathToWatch = localPluginPath;
                    } else if (fs.existsSync(localPluginPathInPlugins)) {
                        pluginPathToWatch = localPluginPathInPlugins;
                    }
                }

                if (pluginPathToWatch) {
                    this.watchPlugin(pluginName, pluginPathToWatch);
                } else {
                    this.logger.warn(`Could not resolve path for plugin ${pluginName} to watch for changes.`);
                }
            }

            return true;
        } catch (err) {
            this.logger.error(`Failed to load plugin "${pluginName}":`, err);
            return false;
        }
    }

    private async _loadPendingPlugins(): Promise<void> {
        const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
        if (pendingPlugins.length === 0) return;

        for (const pluginName of pendingPlugins) {
            await this.loadSinglePlugin(pluginName, false);
        }
    }

    public async unloadPlugin(pluginNameToUnload: string, ispending = false): Promise<void> {
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
                        pluginsToCheck.push(pluginName);
                    }
                }
            }
        }

        for (const dependentName of dependents) {
            await this.unloadPlugin(dependentName, true);
        }

        await this._unloadSinglePlugin(pluginNameToUnload, ispending);
    }

    private async _unloadSinglePlugin(pluginName: string, ispending = false): Promise<void> {
        if (this.pluginStatus[pluginName] !== PluginStatus.ENABLED) {
            return;
        }

        this.logger.info(`Unloading plugin "${pluginName}"...`);
        try {
            const plugin = this.plugins[pluginName];
            if (plugin && plugin.disable) await plugin.disable(this.getContext(pluginName));

            this.unregall(pluginName);

            delete this.plugins[pluginName];
            delete this.pluginModules[pluginName];

            this.pluginStatus[pluginName] = ispending ? PluginStatus.PENDING : PluginStatus.DISABLED;

            if (this.pluginWatchers[pluginName]) {
                this.pluginWatchers[pluginName].close();
                delete this.pluginWatchers[pluginName];
            }

            this.core.emit('plugin-unloaded', pluginName);
        } catch (error) {
            this.logger.error(`Failed to unload plugin "${pluginName}":`, error);
        }
    }

    /**
     * Reloads a single plugin's code by clearing the require cache and then reloading it.
     * @param pluginName The name of the plugin to reload.
     */
    public async reloadPlugin(pluginName: string): Promise<void> {
        this.logger.info(`Reloading plugin code for "${pluginName}"...`);
        this.clearRequireCache(pluginName, new Set());
        await this.unloadPlugin(pluginName);
        const success = await this.loadSinglePlugin(pluginName);
        if (success) {
            this.core.emit('plugin-reloaded', pluginName);
        } else {
            this.logger.error(`Failed to reload plugin "${pluginName}". It may have unmet dependencies.`);
        }
    }

    private watchPlugin(pluginName: string, pluginPath: string): void {
        if (this.pluginWatchers[pluginName]) {
            return;
        }

        const logger = new Logger('hmr');
        const watcher = chokidar.watch(pluginPath, {
            ignored: /(^|[\/])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 100,
            },
        });

        watcher.on('change', async (changePath) => {
            logger.info(`Plugin file changed: ${changePath}`);
            await this.reloadPlugin(pluginName);
        });

        watcher.on('add', async (changePath) => {
            logger.info(`New file added to plugin ${pluginName}: ${changePath}`);
            await this.reloadPlugin(pluginName);
        });

        watcher.on('unlink', async (changePath) => {
            logger.info(`File removed from plugin ${pluginName}: ${changePath}`);
            await this.reloadPlugin(pluginName);
        });

        this.pluginWatchers[pluginName] = watcher;
    }

    async loadModule(pluginName: string): Promise<Plugin> {
        const plugin = await require(pluginName);
        return plugin.default || plugin;
    }

    private clearRequireCache(moduleId: string, visited: Set<string>) {
        if (visited.has(moduleId)) {
            return;
        }
        visited.add(moduleId);

        const module = require.cache[moduleId];
        if (!module) return;

        if (module.children) {
            for (const child of module.children) {
                this.clearRequireCache(child.id, visited);
            }
        }
        delete require.cache[moduleId];
    }

    async checkPluginDependencies(pluginPath: string): Promise<boolean> {
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
