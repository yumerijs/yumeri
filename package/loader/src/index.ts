import * as path from 'path';
import { Core, Config, Logger, Context, PluginStatus, fallback, Schema, I18n, resolvePluginModule } from '@yumerijs/core';
import * as fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import * as chokidar from 'chokidar';

const execFileAsync = promisify(execFile);

// This interface should probably be in @yumerijs/types
interface Plugin {
    apply: (ctx: Context, config: Config) => Promise<void>;
    disable: (ctx: Context) => Promise<void>;
    depend: Array<string>;
    optional?: Array<string>;
    provide: Array<string>;
    render?: string;
    config?: Schema<any>;
}

export interface PluginConfigEntry {
    id: string;
    moduleName: string;
    config: any;
    configKey: string;
    enabled: boolean;
    legacy: boolean;
}

export class PluginLoader {
    public core: Core;
    public config: any = null;
    public logger = new Logger('loader');
    public plugins: { [name: string]: Plugin & { depend?: string[]; optional?: string[]; provide?: string[] } } = {};
    public pluginStatus: Record<string, PluginStatus> = {};
    private pluginWatchers: Record<string, chokidar.FSWatcher> = {};
    private pluginModules: { [name: string]: any } = {};
    private configPath: string = '';
    private pluginContexts: Record<string, Context> = {};
    private isDev: boolean = false;
    /** Install every missing configured plugin without prompting. */
    public autoInstallMissingPlugins: boolean = false;

    constructor(core?: Core, private pluginsDir: string = 'plugins') {
        this.core = core || new Core(this, undefined, false);
        this.isDev = process.env.NODE_ENV === 'development';
        Logger.setCore(this.core);
    }

    /**
     * Normalize both the legacy `{ "package-name": { ...config } }` form and
     * the named instance form `{ "instance-id": { module, config } }`.
     */
    public getPluginEntry(pluginId: string): PluginConfigEntry | undefined {
        const plugins = this.config?.plugins;
        if (!plugins || typeof plugins !== 'object') return undefined;

        const configKey = Object.prototype.hasOwnProperty.call(plugins, pluginId)
            ? pluginId
            : Object.prototype.hasOwnProperty.call(plugins, `~${pluginId}`)
                ? `~${pluginId}`
                : undefined;
        if (!configKey) return undefined;

        const enabled = !configKey.startsWith('~');
        const id = enabled ? configKey : configKey.substring(1);
        const value = plugins[configKey];
        const isInstance = value && typeof value === 'object' && !Array.isArray(value)
            && typeof value.module === 'string';

        return {
            id,
            moduleName: isInstance ? value.module : id,
            config: isInstance ? (value.config ?? {}) : (value ?? {}),
            configKey,
            enabled,
            legacy: !isInstance,
        };
    }

    public setPluginConfig(pluginId: string, config: any): boolean {
        const entry = this.getPluginEntry(pluginId);
        if (!entry) return false;
        if (entry.legacy) {
            this.config.plugins[entry.configKey] = config;
        } else {
            this.config.plugins[entry.configKey].config = config;
        }
        return true;
    }

    private getEnabledPluginEntries(): PluginConfigEntry[] {
        if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
            return [];
        }
        return Object.keys(this.config.plugins)
            .map(key => this.getPluginEntry(key.startsWith('~') ? key.substring(1) : key)!)
            .filter(entry => entry && entry.enabled);
    }

    /**
     * Reloads the config file from disk into memory and emits a 'config-reloaded' event.
     * This does NOT reload any plugins.
     */
    public async reloadConfigFile(): Promise<void> {
        this.core.coreConfig = this.config.core || {};
        this.core.emit('config-reloaded', this.config);
    }

    public async saveConfig(): Promise<void> {
        try {
            const jsonConfig = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, jsonConfig, 'utf8');
        } catch (e) {
            this.logger.error('Failed to save config file:', e);
        }
    }


    getCore(): Core {
        return this.core;
    }

    getContext(pluginName: string, injections: Record<string, any> = {}): Context {
        if (!this.pluginContexts[pluginName]) {
            this.pluginContexts[pluginName] = new Context(this.core, pluginName, null, injections);

        }
        return this.pluginContexts[pluginName];
    }

    async unregall(pluginName: string): Promise<void> {
        const ctx = this.pluginContexts[pluginName];
        if (ctx) {
            await ctx.dispose();
            delete this.pluginContexts[pluginName];
        }
    }

    async loadConfig(configPath: string): Promise<void> {
        try {
            this.configPath = configPath;
            const fileContents = fs.readFileSync(configPath, 'utf8');

            let doc: any;
            if (path.extname(configPath) === '.json') {
                doc = JSON.parse(fileContents);
            } else {
                doc = yaml.load(fileContents);
            }

            this.config = doc;
            this.logger.info('Config loaded.');

            this.core.coreConfig = this.config.core || {};
            this.core.i18n = new I18n(this.core.coreConfig.lang || ['zh', 'en']);
        } catch (e) {
            this.logger.error('Failed to load config:', e);
            throw e;
        }
    }



    async loadPlugins(): Promise<boolean> {
        if (!this.config || typeof this.config.plugins !== 'object' || this.config.plugins === null) {
            this.logger.info('No plugins configuration found. No plugins to load.');
            return false;
        }

        const allEntries = Object.keys(this.config.plugins)
            .map(key => this.getPluginEntry(key.startsWith('~') ? key.substring(1) : key)!)
            .filter(Boolean);
        this.pluginStatus = {}; // Reset status

        for (const entry of allEntries) {
            this.pluginStatus[entry.id] = entry.enabled ? PluginStatus.PENDING : PluginStatus.DISABLED;
        }

        const enabledPlugins = allEntries.filter(entry => entry.enabled).map(entry => entry.id);

        const currentlyLoaded = Object.keys(this.plugins);
        for (const loadedName of currentlyLoaded) {
            if (!enabledPlugins.includes(loadedName)) {
                await this.unloadPlugin(loadedName);
            }
        }

        if (enabledPlugins.length === 0) {
            this.logger.info('No enabled plugins found in configuration.');
            return false;
        }

        // Resolve and install every configured plugin before any plugin module is loaded.
        const installedMissingPlugins = await this.installMissingPluginModules(allEntries.filter(entry => entry.enabled));
        if (installedMissingPlugins) {
            this.logger.info('Missing plugin packages were installed. A worker restart is required before loading plugins.');
            return true;
        }

        // 第一阶段：将 optional 与 depend 一样处理，尽量让可选服务先完成加载并注入。
        while (await this._loadPendingPlugins(true)) {
            // Continue scanning until no plugin can satisfy all required and optional dependencies.
        }

        // 第二阶段：严格扫描无法推进后，忽略尚未提供的 optional；depend 仍必须满足。
        while (await this._loadPendingPlugins(false)) {
            // Continue scanning in relaxed mode until only genuinely missing dependencies remain.
        }

        const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
        if (pendingPlugins.length > 0) {
            this.logger.warn('Some plugins could not be loaded due to unresolved required dependencies:', pendingPlugins);
        }

        return false;
    }

    public async loadSinglePlugin(pluginName: string, triggerPendingCheck: boolean = true, onlypending: boolean = false, requireOptionalDependencies: boolean = true): Promise<boolean> {
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

            // Auto-load and register renderer if declared
            if (pluginInstance.render && typeof pluginInstance.render === 'string') {
                const rendererName = pluginInstance.render;
                this.logger.info(`Plugin "${pluginName}" requires renderer "${rendererName}".`);

                this.core.pluginRenderers.set(pluginName, rendererName);

                if (!this.core.renderers.has(rendererName)) {
                    this.logger.info(`Renderer "${rendererName}" is not registered. Attempting to auto-load...`);
                    try {
                        const rendererPackageMap: Record<string, string> = {
                            'react': '@yumerijs/react-renderer',
                            'ejs': '@yumerijs/ejs-renderer'
                        };

                        const rendererPackageName = rendererPackageMap[rendererName] || rendererName;

                        this.logger.info(`Loading renderer package: "${rendererPackageName}"...`);
                        const RendererClass = await import(rendererPackageName);
                        // Handle both ES modules (default export) and CommonJS modules
                        const ActualRendererClass = RendererClass.default || RendererClass;
                        const rendererInstance = new ActualRendererClass();

                        this.core.addRenderer(rendererInstance);
                        this.logger.info(`Successfully loaded and registered renderer "${rendererName}".`);

                    } catch (err) {
                        this.logger.error(`Failed to auto-load renderer package for "${rendererName}". Please make sure the renderer package is installed.`);
                        this.logger.error(err);
                    }
                }
            }

            const deps = [
                ...(pluginInstance.depend || []),
                ...(requireOptionalDependencies ? (pluginInstance.optional || []) : []),
            ];
            const unmetDependencies = deps.filter(dep => !this.core.components[dep] && !this.core.services[dep]);

            if (unmetDependencies.length > 0) {
                return false;
            }

            this.plugins[pluginName] = pluginInstance;

            const entry = this.getPluginEntry(pluginName);
            if (!entry) {
                throw new Error(`Plugin configuration not found for instance "${pluginName}".`);
            }
            const schema = pluginInstance.config || Schema.object({});
            const finalConfig = fallback(schema, entry.config);
            this.setPluginConfig(pluginName, finalConfig);

            const context = this.getContext(pluginName, {});

            if (pluginInstance.render) {
                context.renderer = this.core.renderers.get(pluginInstance.render || '');
            }
            await this.core.plugin(pluginInstance, context, finalConfig);

            this.pluginStatus[pluginName] = PluginStatus.ENABLED;

            if (triggerPendingCheck) {
                await this._loadPendingPlugins(requireOptionalDependencies);
            }

            if (this.isDev) {
                let pluginPathToWatch: string | null = null;
                const moduleName = entry.moduleName;
                try {
                    const packageJsonUrl = import.meta.resolve(`${moduleName}/package.json`);
                    const pkgJsonPath = fileURLToPath(packageJsonUrl);
                    pluginPathToWatch = path.dirname(pkgJsonPath);
                } catch (e) {
                    const localPluginPath = path.resolve(process.cwd(), moduleName);
                    const localPluginPathInPlugins = path.resolve(process.cwd(), 'plugins', moduleName);
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

    private async _loadPendingPlugins(requireOptionalDependencies: boolean = true): Promise<boolean> {
        const pendingPlugins = Object.keys(this.pluginStatus).filter(p => this.pluginStatus[p] === PluginStatus.PENDING);
        let loadedAny = false;

        for (const pluginName of pendingPlugins) {
            const loaded = await this.loadSinglePlugin(pluginName, false, true, requireOptionalDependencies);
            loadedAny ||= loaded;
        }

        return loadedAny;
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

            await this.unregall(pluginName);

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

    public async reloadPlugin(pluginName: string): Promise<void> {
        this.logger.info(`Reloading plugin: "${pluginName}"...`);
        await this.reloadConfigFile();
        await this.unloadPlugin(pluginName, true);
        let success = await this.loadSinglePlugin(pluginName, true, false, true);
        if (!success) {
            success = await this.loadSinglePlugin(pluginName, true, false, false);
        }
        if (success) {
            this.logger.info(`Plugin "${pluginName}" reloaded successfully.`);
            this.core.emit('plugin-reloaded', pluginName);
        } else {
            this.logger.error(`Failed to reload plugin "${pluginName}". It may have unmet dependencies or other errors.`);
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

    private isMissingModuleError(error: unknown, moduleName: string): boolean {
        const candidate = error as NodeJS.ErrnoException & { message?: string };
        if (candidate?.code !== 'ERR_MODULE_NOT_FOUND') return false;
        return typeof candidate.message === 'string' && candidate.message.includes(moduleName);
    }

    private isNpxInvocation(): boolean {
        const argv = process.argv.map(value => value.toLowerCase());
        const env = process.env;
        return Boolean(
            env.npm_config_npx_command ||
            env.npm_command === 'exec' ||
            argv.some(value => /(?:^|[\\/])npx(?:\.cmd)?$/.test(value)) ||
            (env._ && /(?:^|[\\/])npx(?:\.cmd)?$/.test(env._.toLowerCase()))
        );
    }

    private detectPackageManager(): string {
        const cwd = process.cwd();
        try {
            const packageJsonPath = path.join(cwd, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (typeof packageJson.packageManager === 'string') {
                    return packageJson.packageManager.split('@')[0];
                }
            }
        } catch {
            // Fall back to lockfile detection when package.json is unavailable or invalid.
        }

        if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
        if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) return 'bun';
        return 'npm';
    }

    private async confirmPluginInstall(moduleName: string): Promise<boolean> {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            this.logger.warn(`Plugin package "${moduleName}" is not installed and no interactive terminal is available.`);
            return false;
        }

        const scope = this.isNpxInvocation() ? 'globally' : 'in the current project';
        const answer = await this.logger.input(
            `Plugin package "${moduleName}" is not installed. Install it ${scope}? [y/N] `
        );
        return /^(y|yes)$/i.test(answer.trim());
    }

    private isPluginModuleResolvable(moduleName: string): boolean {
        try {
            import.meta.resolve(moduleName);
            return true;
        } catch (error) {
            if (this.isMissingModuleError(error, moduleName)) return false;
            throw error;
        }
    }

    private async installMissingPluginModules(entries: PluginConfigEntry[]): Promise<boolean> {
        const missingModules = [...new Set(entries.map(entry => entry.moduleName))]
            .filter(moduleName => !this.isPluginModuleResolvable(moduleName));
        if (missingModules.length === 0) return false;

        if (this.autoInstallMissingPlugins) {
            this.logger.info(`Automatically installing missing plugin packages: ${missingModules.join(', ')}`);
            try {
                await this.installMissingPlugin(missingModules);
                return true;
            } catch (error) {
                this.logger.error('Failed to automatically install missing plugin packages:', error);
                return false;
            }
        }

        let installedAny = false;
        for (const moduleName of missingModules) {
            const shouldInstall = await this.confirmPluginInstall(moduleName);
            if (!shouldInstall) continue;

            try {
                await this.installMissingPlugin(moduleName);
                installedAny = true;
            } catch (error) {
                this.logger.error(`Failed to install missing plugin "${moduleName}":`, error);
            }
        }

        return installedAny;
    }

    private async installMissingPlugin(moduleNames: string | string[]): Promise<void> {
        const packages = Array.isArray(moduleNames) ? moduleNames : [moduleNames];
        for (const moduleName of packages) {
            if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(moduleName)) {
                throw new Error(`Cannot automatically install invalid package name "${moduleName}".`);
            }
        }

        const packageManager = this.detectPackageManager();
        const global = this.isNpxInvocation();
        const argsByManager: Record<string, string[]> = {
            npm: global ? ['install', '--global', ...packages] : ['install', ...packages, '--save'],
            yarn: global ? ['global', 'add', ...packages] : ['add', ...packages],
            pnpm: global ? ['add', '--global', ...packages] : ['add', ...packages],
            bun: global ? ['add', '--global', ...packages] : ['add', ...packages],
        };
        const args = argsByManager[packageManager] || argsByManager.npm;
        const command = process.platform === 'win32' ? `${packageManager}.cmd` : packageManager;
        const packageLabel = packages.map(moduleName => `"${moduleName}"`).join(', ');

        this.logger.info(
            `Installing missing plugin package${packages.length === 1 ? '' : 's'} ${packageLabel} with ${command} ${args.join(' ')}` +
            (global ? ' (global)' : '')
        );
        // Windows command shims (for example npm.cmd) require cmd.exe; execFile
        // otherwise fails before the package manager can start with spawn EINVAL.
        if (process.platform === 'win32') {
            await execFileAsync(process.env.ComSpec || 'cmd.exe', [
                '/d',
                '/s',
                '/c',
                `${command} ${args.join(' ')}`,
            ], { cwd: process.cwd() });
            return;
        }

        await execFileAsync(command, args, { cwd: process.cwd() });
    }

    private async importPluginModule(moduleName: string): Promise<any> {
        return await import(moduleName);
    }

    async loadModule(pluginName: string): Promise<Plugin> {
        const entry = this.getPluginEntry(pluginName);
        if (!entry) throw new Error(`Plugin configuration not found for instance "${pluginName}".`);
        const pluginModule = await this.importPluginModule(entry.moduleName);
        const context = this.getContext(pluginName, {});
        return resolvePluginModule(pluginModule, context, entry.config) as Plugin;
    }

    async checkPluginDependencies(pluginPath: string): Promise<boolean> {
        return true;
    }

    async installPluginDependencies(pluginName: string): Promise<void> {
        await this.installMissingPlugin(pluginName);
    }
}

export default PluginLoader;
