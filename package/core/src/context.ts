import { Core } from './core';
import { Command } from './command';

export class Context {
    private core: Core;
    public pluginname: string;
    constructor(core: Core, pluginname: string) {
        this.core = core;
        this.pluginname = pluginname;
    }

    command(name: string) {
        if(this.core.commands[name]) {
            this.core.logger.warn(`Plugin "${this.pluginname}" attempt to register command "${name}", but it has been registered by plugin "${this.core.cmdtoplu[name]}."`)
            return new Command(this.core, name)
        } else {
            this.core.cmdtoplu[name] = this.pluginname;
            return this.core.command(name);
        }
    }
    on(name: string, callback: Function) {
        this.core.evttoplu[name] = this.pluginname;
        this.core.on(name, async (...args: any[]) => {
            return callback(...args);
        });        
    }
    use(name: string, callback: Function) {
        this.core.mdwtoplu[name] = this.pluginname;
        this.core.use(name, async (...args: any[]) => {
            return callback(...args);
        });
    }
    /*
     *Unless nessesary, do not use core directly
     */
    getCore() {
        return this.core;
    }
    async emit(event: string, ...args: any[]) {
        return await this.core.emit(event, ...args);
    }
    getComponent(name: string) {
        return this.core.getComponent(name);
    }
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