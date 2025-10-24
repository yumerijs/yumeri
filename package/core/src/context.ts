/**
 * @time: 2025/10/25 01:30
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import { Core } from './core';
import { Route } from './route';
import { HookHandler } from './hook';
import { Middleware } from './middleware';
import { Config } from './config';

interface Plugin {
    apply: (ctx: Context, config: Config) => Promise<void>;
    disable: (ctx: Context) => Promise<void>;
    depend: Array<string>;
    provide: Array<string>;
}

/**
 * 插件上下文对象
 * 每个插件一个 Context，用于管理插件注册的命令、路由、事件、组件和中间件
 */
export class Context {
    private core: Core;
    private routes: string[] = [];
    private eventlisteners: { name: string; listener: Function }[] = [];
    private components: string[] = [];
    private middlewares: string[] = [];
    private hooks: Record<string, string[]> = {};
    private childContexts: Context[] = [];
    private childPlugins: Map<Context, Plugin> = new Map();

    /** 插件名称 */
    public pluginname: string;

    /**
     * 创建 Context 实例
     * @param core Core 实例
     * @param pluginname 插件名称
     */
    constructor(core: Core, pluginname: string) {
        this.core = core;
        this.pluginname = pluginname;
        this.childPlugins = new Map();
    }

    /**
     * 注册路由
     * @param path 路由路径
     * @returns Route 实例
     */
    route(path: string): Route {
        if (this.core.routes[path]) {
            this.core.logger.warn(
                `Plugin "${this.pluginname}" attempt to register route "${path}", but it has already been registered.`
            );
            return new Route(path);
        }
        this.routes.push(path);
        return this.core.route(path);
    }

    /**
     * 注册事件
     * @param name 事件名称
     * @param listener 事件监听器
     */
    on(name: string, listener: (...args: any[]) => Promise<void>) {
        if (!listener) return;
        this.eventlisteners.push({ name, listener });
        this.core.on(name, listener);
    }

    /**
     * 注册全局中间件
     * @param name 中间件名称
     * @param callback 中间件回调函数
     */
    use(name: string, callback: Middleware) {
        if (!callback) return;
        this.middlewares.push(name);
        this.core.use(name, callback);
    }

    /**
     * 注册 Hook 钩子
     * @param name Hook 点名称
     * @param hookname 钩子名称
     * @param callback 钩子回调函数
     */
    hook(name: string, hookname: string, callback: HookHandler) {
        if (!callback || !hookname) return;
        this.core.hook(name, hookname, callback);
        if (!this.hooks[name]) this.hooks[name] = [];
        this.hooks[name].push(hookname);
    }

    /**
     * 执行 Hook 钩子
     * @param name Hook 点名称
     * @param args Hook 参数
     */
    async executeHook(name: string, ...args: any[]) {
        return await this.core.hookExecute(name, ...args);
    }

    /** 获取 Core 实例 */
    getCore() {
        return this.core;
    }

    /**
     * 触发事件
     * @param event 事件名称
     * @param args 事件参数
     */
    async emit(event: string, ...args: any[]) {
        return await this.core.emit(event, ...args);
    }

    /**
     * 获取组件实例
     * @param name 组件名称
     */
    getComponent(name: string) {
        return this.core.getComponent(name);
    }

    /**
     * 注册组件
     * @param name 组件名称
     * @param component 组件实例
     */
    registerComponent(name: string, component: any) {
        if (!component) return;
        if (this.core.components[name]) {
            this.core.logger.warn(
                `Plugin "${this.pluginname}" attempt to register component "${name}", but it has already been registered.`
            );
            return;
        }
        this.core.components[name] = component;
        this.components.push(name);
    }

    /**
     * 注册子 Context
     * @param name 子 Context 名称
     */
    fork(name = this.pluginname) {
        const ctx = new Context(this.core, name);
        this.childContexts.push(ctx);
        return ctx;
    }

    /**
     * 注册子插件
     * @param plugin 插件实例
     * @param config 插件配置
     */
    async apply(plugin: Plugin, config: Config) {
        if (!plugin || !plugin.apply) return;
        const ctx = this.fork();
        await plugin.apply(ctx, config);
        this.childPlugins.set(ctx, plugin);
    }

    /**
     * 卸载插件时清理注册的所有资源
     */
    async dispose() {
        // 删除组件
        this.components.forEach((name) => delete this.core.components[name]);

        // 删除路由
        this.routes.forEach((route) => delete this.core.routes[route]);

        // 删除中间件
        this.middlewares.forEach((middleware) => delete this.core.globalMiddlewares[middleware]);

        // 删除事件监听器
        this.eventlisteners.forEach(({ name, listener }) => {
            const listeners = this.core.eventListeners?.[name];
            if (listeners) {
                this.core.eventListeners[name] = listeners.filter(l => l !== listener);
            }
        });

        // 删除钩子
        for (const hook in this.hooks) {
            this.hooks[hook].forEach((hookname) => {
                if (hookname) this.core.unhook(hook, hookname);
            });
        }

        // 卸载子插件（异步即可，不必按顺序）
        this.childPlugins.forEach(async (plugin, ctx) => {
            if (plugin?.disable) await plugin.disable(ctx);
        });

        // 删除子上下文
        this.childContexts.forEach((ctx) => {
            if (ctx?.dispose) ctx.dispose();
        });

        // 清空内部记录
        this.components = [];
        this.routes = [];
        this.middlewares = [];
        this.eventlisteners = [];
        this.hooks = {};
        this.childContexts = [];
    }
}