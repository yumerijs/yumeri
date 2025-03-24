/**
 * @time: 2025/03/24 12:26
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/ 

import { Core } from './core';

export class Command {
    name: string;
    actionFn: Function | null = null;
    core: Core;

    constructor(core: Core, name: string) {
        this.core = core; // 接收 Core 实例
        this.name = name;
    }

    action(fn: Function): this {
        this.actionFn = fn;
        return this; // 返回 this 以支持链式调用
    }

    execute(session: any, ...args: any[]): any {
        if (this.actionFn) {
            return this.actionFn(session, ...args);
        }
        return null;
    }
}