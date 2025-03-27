/**
 * @time: 2025/03/25 23:53
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import { Core } from './core';

interface ActionFn {
  (session: any, ...args: any[]): Promise<any>;
}

export class Command {
  name: string;
  actionFn: ActionFn | null = null; // Corrected type: ActionFn | null
  core: Core;

  constructor(core: Core, name: string) {
    this.core = core; // 接收 Core 实例
    this.name = name;
  }

  action(fn: ActionFn): this {  // Corrected type: ActionFn
    this.actionFn = fn;
    return this;
  }

  async execute(session: any, ...args: any[]): Promise<{ result: any; session: any } | null> {
    if (this.actionFn) {
      await this.actionFn(session, ...args);
      return session;
    }
    return null;
  }
}