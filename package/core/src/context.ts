import { Core, Plugin } from './core.js';
import { Route } from './route.js';
import { HookHandler } from './hook.js';
import { Middleware } from './middleware.js';
import { Config } from './config.js';
import { I18n } from './i18n.js';
import { IRenderer } from '@yumerijs/types';
import { SessionStorageProcessor, Storage, SessionStorageSnapshot } from './storage.js';
import { Service } from './service.js';
import path from 'path';
import { setInterval as nodeSetInterval, clearInterval as nodeClearInterval, setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'timers';

export interface Components {
    [key: string]: any;
}

/**
 * 插件上下文对象
 * 每个插件一个 Context，用于管理插件注册的命令、路由、事件、组件和中间件
 */
export class Context {
    private core: Core;
    private routes: string[] = [];
    private eventlisteners: { name: string; listener: (...args: any[]) => Promise<void> }[] = [];
    private components: string[] = [];
    private middlewares: string[] = [];
    private hooks: Record<string, string[]> = {};
    private childContexts: Context[] = [];
    private childPlugins: Map<Context, Plugin> = new Map();
    private i18ns: string[] = [];
    private affects: (() => void | Promise<void>)[] = [];
    private services: string[] = [];
    private timers: Set<NodeJS.Timeout> = new Set();
    private disposed: boolean = false;
    public component!: Components;
    public renderer?: IRenderer;
    public module: any;
    public childpath: string = '/';

    /** 插件名称 */
    public pluginname: string;

    /**
     * 创建 Context 实例
     * @param core Core 实例
     * @param pluginname 插件名称
     */
    constructor(core: Core, pluginname: string, module?: any, injections: Record<string, any> = {}) {
        this.core = core;
        this.module = module;
        this.pluginname = pluginname;
        this.childPlugins = new Map();
        this.component = injections;
    }

    /**
     * 注入依赖
     * @param name 依赖名称
     * @param value 依赖值
     */
    inject(name: string, value: any) {
        this.component[name] = value;
    }

    /**
     * 注册 Context 销毁时执行的回调
     * @param callback 销毁回调
     */
    affect(callback: () => void | Promise<void>) {
        if (!callback) return;
        this.affects.push(callback);
    }

    /**
     * 注册重复定时器（Node 原生 setInterval 的包装）
     *
     * 参数与行为和原生 setInterval 完全一致，额外保证插件卸载后不留副作用：
     * - 定时器句柄会被 Context 记录，插件卸载（dispose）时统一清理，
     *   不会留下继续运行、拖住事件循环的“幽灵定时器”
     * - 卸载后即使还有已经排队的 tick，包装层也会拦截，不再调用插件回调
     * - 回调中的同步异常与 async 回调的 Promise 拒绝会被捕获并写入日志，
     *   不会变成 uncaughtException / unhandledRejection 影响整个进程
     *
     * @param callback 定时执行的回调
     * @param ms 间隔毫秒数
     * @param args 原样透传给回调的额外参数
     * @returns 定时器句柄，可用 ctx.clearInterval 或原生 clearInterval 取消；
     *          若 Context 已卸载则返回 undefined（此时不会创建定时器）
     */
    setInterval(callback: (...args: any[]) => any, ms?: number, ...args: any[]): NodeJS.Timeout | undefined {
        if (!this.prepareTimer('interval', callback)) return undefined;

        const timer = nodeSetInterval(() => {
            // 兜底：卸载后可能仍有已经排队的 tick，直接丢弃
            if (this.disposed) return;
            this.invokeTimerCallback(callback, args);
        }, ms);

        this.timers.add(timer);
        return timer;
    }

    /**
     * 注册一次性定时器（Node 原生 setTimeout 的包装）
     *
     * 行为与原生 setTimeout 一致，卸载保证同 setInterval：
     * 卸载时清理尚未触发的句柄，已排队但尚未执行的回调同样会被拦截。
     *
     * @param callback 延时执行的回调
     * @param ms 延时毫秒数
     * @param args 原样透传给回调的额外参数
     * @returns 定时器句柄，可用 ctx.clearTimeout 或原生 clearTimeout 取消；
     *          若 Context 已卸载则返回 undefined（此时不会创建定时器）
     */
    setTimeout(callback: (...args: any[]) => any, ms?: number, ...args: any[]): NodeJS.Timeout | undefined {
        if (!this.prepareTimer('timeout', callback)) return undefined;

        const timer = nodeSetTimeout(() => {
            // 触发过的句柄不必再被追踪，先摘掉再执行回调
            this.timers.delete(timer);
            if (this.disposed) return;
            this.invokeTimerCallback(callback, args);
        }, ms);

        this.timers.add(timer);
        return timer;
    }

    /**
     * 取消由 setInterval 创建的定时器（Node 原生 clearInterval 的包装）
     * @param timer 定时器句柄
     */
    clearInterval(timer?: NodeJS.Timeout | number | null) {
        if (timer === undefined || timer === null) return;
        this.timers.delete(timer as NodeJS.Timeout);
        nodeClearInterval(timer as any);
    }

    /**
     * 取消由 setTimeout 创建的定时器（Node 原生 clearTimeout 的包装）
     * @param timer 定时器句柄
     */
    clearTimeout(timer?: NodeJS.Timeout | number | null) {
        if (timer === undefined || timer === null) return;
        this.timers.delete(timer as NodeJS.Timeout);
        nodeClearTimeout(timer as any);
    }

    /**
     * 校验回调参数并确认 Context 尚未卸载
     * @param kind 定时器类型，仅用于日志
     * @param callback 用户回调
     */
    private prepareTimer(kind: string, callback: unknown): boolean {
        if (typeof callback !== 'function') {
            throw new TypeError('The "callback" argument must be of type function.');
        }
        if (this.disposed) {
            this.core.logger.warn(
                `Plugin "${this.pluginname}" attempt to create a ${kind} after its context was disposed, ignored.`
            );
            return false;
        }
        return true;
    }

    /**
     * 调用插件定时器回调，并捕获同步异常与 async 拒绝
     * @param callback 用户回调
     * @param args 透传给回调的参数
     */
    private invokeTimerCallback(callback: (...args: any[]) => any, args: any[]) {
        try {
            const result = callback(...args);
            // 兼容 async 回调，避免未处理的 Promise 拒绝
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).catch((error) => {
                    this.core.logger.error(
                        `Unhandled rejection in timer callback of plugin "${this.pluginname}":`,
                        error
                    );
                });
            }
        } catch (error) {
            this.core.logger.error(
                `Unhandled error in timer callback of plugin "${this.pluginname}":`,
                error
            );
        }
    }

    /**
     * 注册路由
     * @param path 路由路径
     * @returns Route 实例
     */
    route(routepath: string): Route {
        // `root` is a special fallback route name, not a filesystem path.
        // URL paths must use POSIX separators even when Yumeri runs on Windows.
        const realpath = routepath === 'root'
            ? 'root'
            : path.posix.join(this.childpath, routepath);
        if (this.core.routes[realpath]) {
            // Reuse the registered route so the same path can be split across
            // multiple declarations, e.g. one GET handler and one POST handler.
            return this.core.routes[realpath];
        }
        this.routes.push(realpath);
        return this.core.route(realpath, this);
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
     * 替换 core 的 session 存储处理器或底层存储。
     */
    setStorage(storage: SessionStorageProcessor | Storage<SessionStorageSnapshot>) {
        this.core.setStorage(storage);
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
     * @deprecated
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
     * 注册服务
     * @param name 服务名称
     * @param service Service 派生类
     */
    registerService(name: string, service: new (context: Context) => Service) {
        if (this.core.services[name]) {
            this.core.logger.warn(
                `Plugin "${this.pluginname}" attempt to register service "${name}", but it has already been registered.`
            );
            return;
        }
        this.core.services[name] = service;
        this.services.push(name);
    }

    /**
     * 注册子 Context
     * @param name 子 Context 名称
     */
    fork(name = this.pluginname, path?: string) {
        const ctx = new Context(this.core, name);
        ctx.childpath = path ?? '/';
        this.childContexts.push(ctx);
        return ctx;
    }

    /**
     * 注册子插件
     * @param module 插件模块
     * @param config 插件配置
     */
    async apply(module: Plugin, config: any) {
        if (!module) return;
        const ctx = this.fork();
        await this.core.plugin(module, ctx, config);
        this.childPlugins.set(ctx, module);
    }

    /**
     * 快速注册子插件（自动 fork）
     * @param module 插件模块
     * @param config 插件配置
     */
    async plugin(module: Plugin, config: any = {}) {
        if (!module) return;
        const ctx = this.fork();
        await this.core.plugin(module, ctx, config);
        this.childPlugins.set(ctx, module);
        return ctx;
    }

    /**
     * 注册 i18n
     * @param content 内容（可以是嵌套对象或单个key）
     * @param locale 可选的语言映射
     */
    public i18n(content: string | Record<string, any>, locale?: Record<string, string>) {
        if (!this.i18ns) this.i18ns = []

        const isLangObject = (obj: any) =>
            typeof obj === 'object' && Object.values(obj).every(v => typeof v === 'string')

        const flatten = (obj: Record<string, any>, prefix = ''): Record<string, Record<string, string>> => {
            const result: Record<string, Record<string, string>> = {}
            for (const [key, value] of Object.entries(obj)) {
                const fullKey = prefix ? `${prefix}.${key}` : key
                if (isLangObject(value)) {
                    result[fullKey] = value
                } else if (typeof value === 'object') {
                    Object.assign(result, flatten(value, fullKey))
                }
            }
            return result
        }

        if (typeof content === 'string' && locale) {
            this.core.i18n.register(content, locale)
            this.i18ns.push(content)
        } else if (typeof content === 'object') {
            const flat = flatten(content)
            this.core.i18n.register(flat)
            this.i18ns.push(...Object.keys(flat))
        }
    }

    /**
     * 卸载插件时清理注册的所有资源
     */
    async dispose() {
        // 先把自己标记为已卸载并停掉所有定时器（Node 里 clearTimeout/clearInterval 可互换）：
        // 这样后续拆卸过程中即使有已排队的 tick 也不会再触发插件回调
        this.disposed = true;
        this.timers.forEach((timer) => nodeClearTimeout(timer));
        this.timers.clear();

        // 删除组件
        this.components.forEach((name) => delete this.core.components[name]);

        // 删除服务
        this.services.forEach((name) => delete this.core.services[name]);

        // 删除路由
        this.routes.forEach((route) => delete this.core.routes[route]);

        // 删除中间件
        this.middlewares.forEach((middleware) => delete this.core.globalMiddlewares[middleware]);

        // 删除事件监听器
        this.eventlisteners.forEach(({ name, listener }) => {
            this.core.off(name, listener);
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

        // 删除i18n
        if (this.i18ns?.length) {
            for (const key of this.i18ns) {
                this.core.i18n.delete(key)
            }
            this.i18ns.length = 0
        }

        // 执行 Context 销毁回调
        for (const callback of this.affects) {
            await callback();
        }

        // 清空内部记录
        this.components = [];
        this.routes = [];
        this.middlewares = [];
        this.eventlisteners = [];
        this.hooks = {};
        this.childContexts = [];
        this.affects = [];
        this.services = [];
    }
}
