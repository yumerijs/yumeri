import { Core } from './core'; // 假设 Core 类在 core.ts 文件中

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