/**
 * @time: 2025/03/26 12:36
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import crypto from 'crypto';
import { Server } from './server.js';
import { IncomingMessage, ServerResponse } from 'http';
import * as formidable from 'formidable';
import fs from 'fs';
import { Stream } from "stream";
import { Context } from './context.js';

/** 解析后的请求参数类型，支持字符串或字符串数组 */
type ParsedParams = Record<string, string | string[] | undefined>;
/** 模板渲染中，当变量缺失时的处理策略 */
type MissingMode = 'keep-template' | 'keep-key' | 'remove';

/** 客户端对象，包含原始的 HTTP 请求和响应对象 */
export interface Client {
  /** 原始的 Node.js HTTP 请求对象 */
  req: IncomingMessage;
  /** 原始的 Node.js HTTP 响应对象 */
  res: ServerResponse;
  /** 经过处理后的规范化请求头 */
  headers?: Record<string, string>;
}

/** 设置 Cookie 时的配置项 */
export interface CookieOptions {
  /** Cookie 的过期时间 */
  expires?: Date;
  /** Cookie 的有效路径，默认为 '/' */
  path?: string;
  /** Cookie 的有效域名 */
  domain?: string;
  /** 是否仅在 HTTPS 连接中传输 */
  secure?: boolean;
  /** 是否禁止客户端脚本访问该 Cookie */
  httpOnly?: boolean;
  /** 控制 Cookie 是否随跨站请求发送 */
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** 响应缓存的配置项 */
export interface CacheOptions {
  /** 强缓存标识 ETag */
  etag?: string;
  /** 资源最后修改时间 */
  modified?: Date;
  /** 浏览器缓存最大时长（秒） */
  maxAge?: number;
  /** 代理服务器缓存最大时长（秒） */
  smaxAge?: number;
  /** 标识资源是否永不改变 */
  isImmutable?: boolean;
  /** 显式的过期时间 */
  expires?: Date,
  /** 缓存控制的具体策略 */
  cacheControl?: 'public' | 'private' | 'no-cache' | 'no-store' | 'must-revalidate' | 'proxy-revalidate';
}

/** 静态文件专用的缓存配置 */
export interface StaticCacheOptions {
  /** 是否启用 ETag 生成 */
  etag?: boolean;
  /** 最大缓存时长 */
  maxAge?: number;
  /** 代理缓存时长 */
  smaxAge?: number;
  /** 计算 ETag 使用的哈希算法 */
  etagType?: 'md5' | 'sha1' | 'sha256' | 'sha512';
}

/** 响应体的数据类型分类 */
type ResType = "plain" | "json" | "stream" | "buffer";

/** 响应类型与具体数据结构的映射表 */
interface BodyMap {
  plain: string;
  json: Record<string, any>;
  stream: Stream;
  buffer: Buffer;
}

/**
 * 会话请求包装类
 * 负责收集和整理所有来自客户端的请求信息
 */
class SessionRequest {
  /** 客户端的 IP 地址 */
  public ip: string;
  /** 请求中携带的原始 Cookie 键值对 */
  public cookies: Record<string, string>;
  /** URL 中的查询字符串参数 */
  public query: Record<string, string> | undefined;
  /** 请求的资源路径（不含查询参数） */
  public pathname: string;
  /** 所有的请求头信息 */
  public headers: Record<string, string>;
  /** 客户端支持的语言列表，已按权重排序 */
  public languages: string[] = [];
  /** 请求使用的协议 */
  public protocol: string = 'http';
  /** 原始的 IncomingMessage 对象 */
  public raw: IncomingMessage;

  constructor(data: {
    ip: string,
    cookies: Record<string, string>,
    query?: Record<string, string>,
    pathname?: string,
    headers: Record<string, string>,
    raw: IncomingMessage
  }) {
    this.ip = data.ip;
    this.cookies = data.cookies;
    this.query = data.query;
    this.pathname = data.pathname || '/';
    this.headers = data.headers;
    this.raw = data.raw;
  }
}

/**
 * 会话响应包装类
 * 负责管理和准备发往客户端的数据
 */
class SessionResponse {
  /** 待发送的 HTTP 状态码 */
  public status: number = 200;
  /** 待发送的响应头 */
  public headers: Record<string, any> = { 'Content-Type': 'text/plain' };
  /** 准备设置到客户端的 Cookie 集合 */
  public cookies: Record<string, { value: string, options: CookieOptions }> = {};
  /** 响应体的具体类型 */
  public type: ResType = "plain";
  /** 响应的具体内容 */
  public body: any;
  /** 标识该响应是否已经处理完毕 */
  public handled: boolean = false;
  /** 原始的 ServerResponse 对象 */
  public raw: ServerResponse;

  constructor(res: ServerResponse) {
    this.raw = res;
  }
}

/**
 * 会话对象 (Session)
 * 是插件开发中最核心的对象，封装了请求、响应及各种便捷工具
 */
export class Session {
  /** 封装后的请求对象 */
  public request: SessionRequest;
  /** 封装后的响应对象 */
  public response: SessionResponse;
  
  /** 当前会话的唯一标识符 (UUID) */
  public sessionid: string;
  /** 持久化的会话数据存储 */
  public data: Record<string, any> = {};
  /** 供插件或中间件挂载的临时属性 */
  public properties: Record<string, any> = {};
  
  /** 对核心服务器实例的引用 */
  public server: Server;
  /** 当前插件的上下文环境 */
  public pluginContext: Context | undefined;

  /**
   * 初始化一个新的会话
   * @param ip 客户端IP
   * @param cookie 请求Cookie
   * @param server 服务器实例
   * @param req 原始请求对象
   * @param res 原始响应对象
   * @param pathname 请求路径
   * @param query 查询参数
   * @param pluginContext 插件上下文
   */
  constructor(ip: string, cookie: Record<string, string>, server: Server, req?: IncomingMessage, res?: ServerResponse, pathname?: string, query?: Record<string, string>, pluginContext?: Context) {
    this.server = server;
    this.pluginContext = pluginContext;

    const headers: Record<string, string> = {};
    if (req) {
      for (const key in req.headers) {
        const value = req.headers[key];
        headers[key] = Array.isArray(value) ? value.join(', ') : String(value || '');
      }
    }

    this.request = new SessionRequest({ ip, cookies: cookie, query, pathname, headers, raw: req });
    this.response = new SessionResponse(res);

    if (cookie.sessionid) {
      this.sessionid = cookie.sessionid;
    } else {
      this.sessionid = this.generateId();
      this.setCookie('sessionid', this.sessionid);
    }

    if (cookie.lang) {
      this.request.languages = cookie.lang.split(',');
    } else if (headers['accept-language']) {
      this.request.languages = this.parseAcceptLanguages(headers['accept-language']);
      this.setCookie('lang', this.request.languages.join(','));
    }
  }

  /** 获取客户端 IP 地址 */
  get ip() { return this.request.ip; }
  /** 获取请求中的 Cookie 集合 */
  get cookie() { return this.request.cookies; }
  /** 获取 URL 查询参数 */
  get query() { return this.request.query; }
  /** 获取请求路径 */
  get pathname() { return this.request.pathname; }
  /** 获取语言列表 */
  get languages() { return this.request.languages; }
  /** 获取请求协议 */
  get protocol() { return this.request.protocol; }
  set protocol(val: string) { this.request.protocol = val; }
  /** 获取或设置响应状态码 */
  get status() { return this.response.status; }
  set status(val: number) { this.response.status = val; }
  /** 获取待发送的新 Cookie */
  get newCookie() { return this.response.cookies; }
  /** 获取响应头对象 */
  get head() { return this.response.headers; }
  /** 获取当前响应内容类型 */
  get _restype() { return this.response.type; }
  /** 获取响应是否已处理的标记 */
  get responseHandled() { return this.response.handled; }
  set responseHandled(val: boolean) { this.response.handled = val; }

  /** 组装并获取 Client 兼容对象 */
  get client(): Client {
    return {
      req: this.request.raw,
      res: this.response.raw,
      headers: this.request.headers
    };
  }

  /**
   * 设置响应体内容
   * @param body 响应内容
   * @param type 内容类型，默认为 'plain'
   */
  public respond<T extends ResType>(body: BodyMap[T], type: T = 'plain' as T): void {
    this.response.type = type;
    this.response.body = body;
  }

  /** 获取响应类型 */
  get restype() {
    return this.response.type;
  }

  /** 获取响应体内容 */
  get body() {
    return this.response.body;
  }

  /** 设置响应体内容，自动推断类型 */
  set body(value: any) {
    this.response.body = value;
    this.response.type = typeof value === 'string' ? "plain" : "json";
  }

  /**
   * 设置响应 Cookie
   * @param name Cookie 键名
   * @param value Cookie 值
   * @param options 配置项
   */
  public setCookie(name: string, value: string, options: CookieOptions = {}): void {
    if (options.path === undefined) {
      options.path = '/';
    }
    this.response.cookies[name] = { value, options };
  }

  /**
   * 解析 Accept-Language 请求头
   * @param header 原始头字符串
   * @returns 排序后的语言数组
   */
  public parseAcceptLanguages(header: string): string[] {
    if (!header) return [];
    const langs = header
      .split(',')
      .map(item => {
        const [lang, qStr] = item.trim().split(';');
        const q = qStr ? parseFloat(qStr.split('=')[1]) || 1 : 1;
        return { lang: lang.toLowerCase(), q };
      })
      .sort((a, b) => b.q - a.q);

    const result: string[] = [];
    const seen = new Set<string>();
    for (const { lang } of langs) {
      if (!seen.has(lang)) {
        result.push(lang);
        seen.add(lang);
      }
      const parts = lang.split('-');
      if (parts.length > 1) {
        const base = parts[0];
        if (!seen.has(base)) {
          let insertIndex = -1;
          for (let i = result.length - 1; i >= 0; i--) {
            if (result[i].startsWith(base + '-')) {
              insertIndex = i + 1;
              break;
            }
          }
          if (insertIndex === -1) insertIndex = result.length;
          result.splice(insertIndex, 0, base);
          seen.add(base);
        }
      }
    }
    return result;
  }

  /**
   * 生成会话 ID (UUID)
   */
  private generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * 异步解析请求体
   * @returns 返回解析后的参数
   */
  public async parseRequestBody(client: Client = this.client): Promise<ParsedParams> {
    const req = client.req;
    return new Promise((resolve, reject) => {
      const contentType = (req.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json') || contentType.includes('application/x-www-form-urlencoded')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try {
            if (contentType.includes('application/json')) resolve(JSON.parse(body));
            else {
              const params = new URLSearchParams(body);
              const parsed: ParsedParams = {};
              params.forEach((v, k) => parsed[k] = v);
              resolve(parsed);
            }
          } catch (e) { reject(e); }
        });
      } else if (contentType.includes('multipart/form-data')) {
        const form = formidable.formidable({});
        form.parse(req, (err, fields) => {
          if (err) return reject(err);
          const parsed: ParsedParams = {};
          Object.keys(fields).forEach(k => {
            const val = fields[k];
            parsed[k] = Array.isArray(val) && val.length === 1 ? val[0] : val;
          });
          resolve(parsed);
        });
      } else resolve({});
      req.on('error', reject);
    });
  }

  /**
   * 获取请求体文本
   */
  public async getReqBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => resolve(body));
    });
  }

  /**
   * MD5 加密
   */
  private md5(str: string): string {
    const hash = crypto.createHash('md5');
    hash.update(str);
    return hash.digest('hex');
  }

  /** 设置会话数据 */
  public setData(key: string, value: any): void { this.data[key] = value; }
  /** 删除会话数据 */
  public deleteData(key: string): void { delete this.data[key]; }
  /** 清空会话数据 */
  public clearData(): void { this.data = {}; }
  /** 销毁会话 */
  public destroy(): void { this.clearData(); }

  /** 设置 MIME 类型 */
  public setMime(mimeType: string): void {
    const map: Record<string, string> = {
      'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'pdf': 'application/pdf', 'plain': 'text/plain', 'html': 'text/html',
      'json': 'application/json', 'xml': 'application/xml'
    };
    this.response.headers['Content-Type'] = map[mimeType] || mimeType;
  }

  /** 向响应流写入数据 */
  public send(data: any): any { return this.response.raw.write(data); }

  /** 结束响应 */
  public endsession(message: any): any {
    this.response.handled = true;
    return this.response.raw.end(message);
  }

  /** 获取国际化文本 */
  public text(name: string): any {
    return this.server.core.i18n.get(name, this.request.languages);
  }

  /** 设置缓存标头 */
  public setCache(option: CacheOptions): void {
    if (option.etag) this.response.headers['ETag'] = `${option.etag}`;
    if (option.modified) this.response.headers['Last-Modified'] = option.modified.toUTCString();
    const control: string[] = [];
    if (option.cacheControl !== undefined) control.push(option.cacheControl);
    if (option.maxAge !== undefined) control.push(`max-age=${option.maxAge}`);
    if (option.smaxAge !== undefined) control.push(`s-maxage=${option.smaxAge}`);
    if (option.isImmutable) control.push('immutable');
    if (control.length > 0) this.response.headers['Cache-Control'] = control.join(', ');
    if (option.expires) this.response.headers['Expires'] = option.expires.toUTCString();
  }

  /** 发送静态内容并处理缓存 */
  public static(content: string, option: CacheOptions): void {
    if (this.request.headers['if-modified-since']) {
      const modified = new Date(this.request.headers['if-modified-since']);
      if (option.modified && modified.getTime() === option.modified.getTime()) {
        this.response.status = 304; return;
      }
    }
    if (this.request.headers['if-none-match'] === option.etag) {
      this.response.status = 304; return;
    }
    this.setCache(option);
    this.respond(content);
  }

  /** 发送文件并处理缓存 */
  public file(path: string, option: StaticCacheOptions): void {
    const stats = fs.statSync(path);
    if (this.request.headers['if-modified-since']) {
      const modified = new Date(this.request.headers['if-modified-since']);
      if (modified.getTime() === stats.mtime.getTime()) {
        this.response.status = 304; return;
      }
    }
    const etag = crypto.createHash(option.etagType || 'md5').update(fs.readFileSync(path)).digest('hex');
    if (this.request.headers['if-none-match'] === etag) {
      this.response.status = 304; return;
    }
    this.setCache({
      modified: stats.mtime, etag,
      maxAge: option.maxAge, smaxAge: option.smaxAge, cacheControl: 'public'
    });
    this.respond(fs.createReadStream(path), 'stream');
  }

  /** 直接发送文件 */
  public sendFile(path: string, isStream: boolean = false): void {
    if (isStream) {
      this.setMime('application/octet-stream');
      this.respond(fs.createReadStream(path), 'stream');
    } else {
      this.respond(fs.readFileSync(path), 'buffer');
    }
  }

  /** 渲染组件视图 */
  public async renderView(component: any, data: Record<string, any> = {}): Promise<void> {
    if (!this.pluginContext) throw new Error(`Plugin context missing.`);
    const renderer = this.pluginContext.renderer;
    if (!renderer) {
      this.server.core.logger.error(`Renderer missing for ${this.pluginContext.pluginname}`);
      return;
    }
    try {
      const html = await renderer.render(component, data, { pluginName: this.pluginContext.pluginname });
      this.setMime('text/html');
      this.respond(html, 'plain');
    } catch (error) {
      this.server.core.logger.error(`Render error:`, error);
      throw error;
    }
  }

  /** 渲染文件 */
  public async render(filePath: string, data?: any): Promise<void> {
    const renderer = this.pluginContext?.renderer;
    if (!renderer) {
      this.server.core.logger.error(`Renderer missing.`);
      return;
    }
    try {
      const html = await renderer.renderFile(filePath, data);
      this.setMime('text/html');
      this.respond(html, 'plain');
    } catch (error) {
      this.server.core.logger.error(`File render error:`, error);
      throw error;
    }
  }
}
