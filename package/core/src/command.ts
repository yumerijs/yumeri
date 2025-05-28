/**
 * @time: 2025/03/25 23:53
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import { Core } from './core';
import { Session } from './session';
import { Middleware } from './middleware';

interface ActionFn {
  (session: any, ...args: any[]): Promise<any>;
}

export class Command {
  name: string;
  actionFn: ActionFn | null = null;
  connectFn: ActionFn | null = null;
  closeFn: ActionFn | null = null;
  core: Core;
  middlewares: Middleware[] = []; // 存储命令特定的中间件

  constructor(core: Core, name: string) {
    this.core = core;
    this.name = name;
  }

  /**
   * 注册命令处理函数
   * @param fn 处理函数
   * @returns this 支持链式调用
   */
  action(fn: ActionFn): this {
    this.actionFn = fn;
    return this;
  }

  close(fn: ActionFn): this {
    this.closeFn = fn;
    return this;
  }

  connect(fn: ActionFn): this {
    this.connectFn = fn;
    return this;
  }

  /**
   * 注册命令特定的中间件
   * @param middleware 中间件函数
   * @returns this 支持链式调用
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 执行命令，包括中间件链和处理函数
   * @param session 会话对象
   * @param args 其他参数
   * @returns 处理后的会话对象
   */
  async execute(session: any, ...args: any[]): Promise<Session | null> {
    if (this.actionFn) {
      await this.actionFn(session, ...args);
      return session;
    }
    return null;
  }

  /**
   * 执行命令处理函数（不包含中间件）
   * @param session 会话对象
   * @param args 其他参数
   * @returns 处理后的会话对象
   */
  async executeHandler(session: any, ...args: any[]): Promise<Session | null> {
    if (this.actionFn) {
      await this.actionFn(session, ...args);
      return session;
    }
    return null;
  }
}
