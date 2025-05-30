/**
 * @time: 2025/03/25 23:53
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import { Core } from './core';
import { Session } from './session';
import { Middleware } from './middleware';

/**
 * 命令处理函数接口
 * @param session 会话对象
 * @param args 其他参数
 * @returns Promise<any>
 */
interface ActionFn {
  (session: any, ...args: any[]): Promise<any>;
}

/**
 * 支持的协议类型
 * @enum {string}
 */
export enum ProtocolType {
  /** HTTP 协议 */
  HTTP = 'http',
  /** WebSocket 协议 */
  WS = 'ws',
  /** 所有协议 */
  ALL = 'all'
}

/**
 * 支持的 HTTP 方法
 * @enum {string}
 */
export enum HttpMethod {
  /** GET 请求方法 */
  GET = 'get',
  /** POST 请求方法 */
  POST = 'post',
  /** PUT 请求方法 */
  PUT = 'put',
  /** DELETE 请求方法 */
  DELETE = 'delete',
  /** PATCH 请求方法 */
  PATCH = 'patch',
  /** HEAD 请求方法 */
  HEAD = 'head',
  /** OPTIONS 请求方法 */
  OPTIONS = 'options',
  /** 所有 HTTP 方法 */
  ALL = 'all'
}

/**
 * 命令类，用于注册和执行命令
 */
export class Command {
  /** 命令名称 */
  name: string;
  /** 命令处理函数 */
  actionFn: ActionFn | null = null;
  /** WebSocket 连接处理函数 */
  connectFn: ActionFn | null = null;
  /** WebSocket 关闭处理函数 */
  closeFn: ActionFn | null = null;
  /** 核心实例 */
  core: Core;
  /** 命令特定的中间件数组 */
  middlewares: Middleware[] = [];
  /** 支持的协议类型，默认为所有协议 */
  protocol: ProtocolType = ProtocolType.ALL;
  /** 支持的 HTTP 方法，默认为所有方法 */
  httpMethods: HttpMethod[] = [HttpMethod.ALL];

  /**
   * 创建命令实例
   * @param core 核心实例
   * @param name 命令名称
   */
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

  /**
   * 注册 WebSocket 关闭处理函数
   * @param fn 处理函数
   * @returns this 支持链式调用
   */
  close(fn: ActionFn): this {
    this.closeFn = fn;
    return this;
  }

  /**
   * 注册 WebSocket 连接处理函数
   * @param fn 处理函数
   * @returns this 支持链式调用
   */
  connect(fn: ActionFn): this {
    this.connectFn = fn;
    return this;
  }

  /**
   * 设置命令支持的协议类型
   * @param protocol 协议类型
   * @returns this 支持链式调用
   */
  setProtocol(protocol: ProtocolType): this {
    this.protocol = protocol;
    return this;
  }

  /**
   * 设置命令支持的 HTTP 方法
   * @param methods 单个 HTTP 方法或 HTTP 方法数组
   * @returns this 支持链式调用
   */
  setHttpMethods(methods: HttpMethod | HttpMethod[]): this {
    if (Array.isArray(methods)) {
      this.httpMethods = methods;
    } else {
      this.httpMethods = [methods];
    }
    return this;
  }

  /**
   * 检查命令是否支持指定的协议类型
   * @param protocol 协议类型
   * @returns 是否支持
   */
  supportsProtocol(protocol: ProtocolType): boolean {
    return this.protocol === ProtocolType.ALL || this.protocol === protocol;
  }

  /**
   * 检查命令是否支持指定的 HTTP 方法
   * @param method HTTP 方法
   * @returns 是否支持
   */
  supportsHttpMethod(method: string): boolean {
    const lowerMethod = method.toLowerCase();
    return this.httpMethods.includes(HttpMethod.ALL) || 
           this.httpMethods.some(m => m.toLowerCase() === lowerMethod);
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
