/**
 * @time: 2025/08/14 18:33
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

/**
 * Hook 处理器
 */
export type HookHandler = (...args: any[]) => Promise<any>;
/**
 * Hook 类
 */
export class Hook {
  public name: string;
  public handlers: Record<string, HookHandler> = {};
  /**
   * 创建 Hook 实例
   * @param name Hook 名称
   */
  constructor(name: string) {
    this.name = name;
  }
  /**
   * 添加 Hook 函数
   * @param name Hook 函数名称
   * @param handler Hook 函数
   */
  add(name: string, handler: HookHandler): void {
    this.handlers[name] = handler;
  }
  /**
   * 删除 Hook 函数
   * @param name Hook 函数名称
   */
  remove(name: string): void {
    delete this.handlers[name];
  }
  /**
   * 触发 Hook 函数
   * @param session 会话
   * @param args 参数
   * @returns 执行结果
   */
  async trigger(...args: any[]): Promise<any[]> {
    let result: any[] = [];
    for (const handler of Object.values(this.handlers)) {
      result.push(await handler(...args));
    }
    return result;
  }
}