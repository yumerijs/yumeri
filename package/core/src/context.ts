/**
 * @time: 2025/08/14 19:10
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Core } from './core';
import { Route } from './route';
import { HookHandler } from './hook';

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

    /**
     * 插件名称
     */
    public pluginname: string;

    /**
     * 创建 Context 实例
     * @param core Core 实例
     * @param pluginname 插件名称
     */
    constructor(core: Core, pluginname: string) {
        this.core = core;
        this.pluginname = pluginname;
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
        // 记录插件自己的事件监听器
        this.eventlisteners.push({ name, listener });
        // 注册到 core 的全局事件监听器中
        this.core.on(name, listener);
    }

    /**
     * 注册全局中间件
     * @param name 中间件名称
     * @param callback 中间件回调函数
     */
    use(name: string, callback: Function) {
        this.middlewares.push(name);
        this.core.use(name, async (...args: any[]) => callback(...args));
    }

    /**
     * 注册 Hook 钩子
     * @param name Hook 点名称
     * @param hookname 钩子名称
     * @param callback 钩子回调函数
     */
    hook(name: string, hookname: string, callback: HookHandler) {
        this.core.hook(name, hookname, callback);
        if (!this.hooks[name]) {
            this.hooks[name] = [];
        }
        this.hooks[name].push(hookname);
    }

    /**
     * 执行 Hook 钩子
     * @param name Hook 点名称
     * @param args Hook 参数
     * @returns Promise<any[]>
     */
    async executeHook(name: string, ...args: any[]) {
        return await this.core.hookExecute(name, ...args);
    }

    /** 
     * 获取 Core 实例
     * @returns Core
     */
    getCore() {
        return this.core;
    }

    /**
     * 触发事件
     * @param event 事件名称
     * @param args 事件参数
     * @returns Promise<void>
     */
    async emit(event: string, ...args: any[]) {
        return await this.core.emit(event, ...args);
    }

    /**
     * 获取组件实例
     * @param name 组件名称
     * @returns 组件实例
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
     * 卸载插件时清理注册的所有资源
     * 包括组件、路由、中间件和事件监听器
     */
    dispose() {
        // 删除组件
        this.components.forEach((name) => {
            delete this.core.components[name];
        });

        // 删除路由
        this.routes.forEach((route) => {
            delete this.core.routes[route];
        });

        // 删除中间件
        this.middlewares.forEach((middleware) => {
            delete this.core.globalMiddlewares[middleware];
        });

        // 删除事件监听器
        this.eventlisteners.forEach(({ name, listener }) => {
            if (this.core.eventListeners?.[name]) {
                this.core.eventListeners[name] =
                    this.core.eventListeners[name].filter((l) => l !== listener);
            }
        });

        // 删除钩子
        for (const hook in this.hooks) {
            this.hooks.hook.forEach((hookname) => {
                this.core.unhook(hook, hookname);
            })
        }

        // 清空 Context 内部记录，避免内存泄漏
        this.components = [];
        this.routes = [];
        this.middlewares = [];
        this.eventlisteners = [];
    }
}
