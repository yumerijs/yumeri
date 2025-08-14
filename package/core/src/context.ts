/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Core } from './core';
import { Command } from './command';
import { Route } from './route';

export class Context {
    private core: Core;
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
     * @deprecated Use route() instead.
     */
    command(name: string) {
        if(this.core.commands[name]) {
            this.core.logger.warn(`Plugin "${this.pluginname}" attempt to register command "${name}", but it has been registered by plugin "${this.core.cmdtoplu[name]}."`)
            return new Command(this.core, name)
        } else {
            this.core.cmdtoplu[name] = this.pluginname;
            return this.core.command(name);
        }
    }

    /**
     * 注册路由
     * @param path 路由路径
     * @returns Route
     */
    route(path: string): Route {
        if (this.core.routes[path]) {
            this.core.logger.warn(`Plugin "${this.pluginname}" attempt to register route "${path}", but it has been registered by plugin "${this.core.routetoplu[path]}."`)
            return this.core.routes[path];
        } else {
            this.core.routetoplu[path] = this.pluginname;
            return this.core.route(path);
        }
    }

    /**
     * 注册事件
     * @param name 事件名称
     * @param listener 事件监听器
     */
    on(name: string, listener: (...args: any[]) => Promise<void>) {
        // 存储该插件监听的事件，需要注意的是一个事件可由多个插件监听
        if (!this.core.evttoplu[name]) {
            this.core.evttoplu[name] = {};
        }
        if (!this.core.evttoplu[name][this.pluginname]) {
            this.core.evttoplu[name][this.pluginname] = [];
        }
        this.core.evttoplu[name][this.pluginname].push(listener);
        this.core.on(name, listener);        
    }

    /**
     * 注册全局中间件
     * @param name 中间件名称
     * @param callback 中间件回调函数
     */
    use(name: string, callback: Function) {
        this.core.mdwtoplu[name] = this.pluginname;
        this.core.use(name, async (...args: any[]) => {
            return callback(...args);
        });
    }

    /** 
     * Unless nessesary, do not use core directly
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
     * @param name  组件名称
     * @returns 组件实例
     */
    getComponent(name: string) {
        return this.core.getComponent(name);
    }
    
    /**
     * 注册组件
     * @param name 组件名称
     * @param component 组件实例
     * @returns void
     */
    registerComponent(name: string, component: any) {
        if(this.core.components[name]) {
            this.core.logger.warn(`Plugin "${this.pluginname}" attempt to register component "${name}", but it has been registered by plugin "${this.core.comtoplu[name]}."`)
            return
        }
        this.core.comtoplu[name] = this.pluginname;
        this.core.components[name] = component;
        return;
    }
}