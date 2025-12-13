/**
 * @time: 2025/03/26 12:36
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import crypto from 'crypto';
import { Server } from './server';
import { IncomingMessage, ServerResponse } from 'http';
import * as formidable from 'formidable';
import fs from 'fs';
import { Stream } from "stream";
import { Context } from './context';

type ParsedParams = Record<string, string | string[] | undefined>;
type MissingMode = 'keep-template' | 'keep-key' | 'remove';


export interface Client {
  req: IncomingMessage;
  res: ServerResponse;
  headers?: Record<string, string>;
}

export interface CookieOptions {
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CacheOptions {
  etag?: string;
  modified?: Date;
  maxAge?: number;
  smaxAge?: number;
  isImmutable?: boolean;
  expires?: Date,
  cacheControl?: 'public' | 'private' | 'no-cache' | 'no-store' | 'must-revalidate' | 'proxy-revalidate';
}

export interface StaticCacheOptions {
  etag?: boolean;
  maxAge?: number;
  smaxAge?: number;
  etagType?: 'md5' | 'sha1' | 'sha256' | 'sha512';
}

type ResType = "plain" | "json" | "stream" | "buffer";

interface BodyMap {
  plain: string;
  json: Record<string, any>;
  stream: Stream;
  buffer: Buffer;
}

export class Session {
  public ip: string;
  public cookie: Record<string, string>;
  public query: Record<string, string> | undefined;
  public sessionid: string;
  public data: Record<string, any> = {};
  public newCookie: Record<string, { value: string, options: CookieOptions }> = {};
  public head: Record<string, any> = {};
  public status: number = 200;
  private _restype: ResType = "plain";
  private _body: any;
  public properties?: Record<string, any> = {};
  public client: Client = null;
  public server: Server;
  public protocol: string = 'http';
  public pathname: string;
  public languages: string[];
  public responseHandled: boolean = false;
  public pluginContext: Context | undefined;

  /**
   * @constructor
   * @param ip 用户IP
   * @param cookie 会话cookie
   * @param query 请求字符串
   */
  constructor(ip: string, cookie: Record<string, string>, server: Server, req?: IncomingMessage, res?: ServerResponse, pathname?: string, query?: Record<string, string>, pluginContext?: Context) {
    this.ip = ip;
    this.cookie = cookie;
    this.query = query;
    this.server = server;
    this.pathname = pathname;
    this.pluginContext = pluginContext;
    let header: Record<string, string> = {};
    for (let key in req.headers) {
      const value = req.headers[key];
      if (typeof value === 'string') {
        header[key] = value;
      } else if (Array.isArray(value)) {
        header[key] = value.join(', ');
      } else if (value !== undefined) {
        header[key] = String(value);
      }
    }
    this.client = {
      req: req,
      res: res,
      headers: header
    }
    this.head['Content-Type'] = 'text/plain';
    if (cookie.sessionid) {
      this.sessionid = cookie.sessionid;
    }
    else {
      this.sessionid = this.generateId(this.ip);
      this.setCookie('sessionid', this.sessionid);
    }
    if (cookie.lang) {
      this.languages = cookie.lang.split(',');
    } else if (req.headers['accept-language']) {
      this.languages = this.parseAcceptLanguages(req.headers['accept-language']);
      this.setCookie('lang', this.languages.join(','));
    }
  }

  response<T extends ResType>(body: BodyMap[T], type: T = 'text' as T): void {
    this._restype = type;
    this._body = body;
  }

  get restype() {
    return this._restype;
  }

  get body() {
    return this._body;
  }

  set body(value: string) {
    this._body = value as any;
    this._restype = "plain";  // 自动把 restype 设成 plain
  }

  public setCookie(name: string, value: string, options: CookieOptions = {}): void {
    if (options.path === undefined) {
      options.path = '/';
    }
    this.newCookie[name] = { value, options };
  }

  /**
   * 解析 Accept-Language 字符串为排序后的语言数组
   * @param header Accept-Language 头，比如 "zh-CN,zh-TW;q=0.8,en-US;q=0.6"
   * @returns 按优先级排序的语言数组，自动补上父语言
   */
  parseAcceptLanguages(header: string) {
    if (!header) return [];

    const langs = header
      .split(',')
      .map(item => {
        const [lang, qStr] = item.trim().split(';');
        const q = qStr ? parseFloat(qStr.split('=')[1]) || 1 : 1;
        return { lang: lang.toLowerCase(), q };
      })
      .sort((a, b) => b.q - a.q);

    const result = [];
    const seen = new Set();

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
   * 生成 sessionid
   * @param ip 用户IP
   * @param option 选项
   */
  private generateId(ip: string, option?: string): string {
    const sessionId = this.md5(ip + Date.now().toString() + Math.random().toString()); // 添加随机性
    return sessionId;
  }

  /**
   * 解析请求体
   * @param client 客户端
   * @returns Promise<ParsedParams>
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
   * 获取请求体
   * @param req 请求对象
   * @returns Promise<string>
   */
  public async getReqBody(req: IncomingMessage): Promise<string> {
    let body = ""
    req.on('data', chunk => body += chunk.toString());
    return body;
  }

  // MD5 加密
  private md5(str: string): string {
    const hash = crypto.createHash('md5');
    hash.update(str);
    return hash.digest('hex');
  }

  // 设置会话数据
  public setData(key: string, value: any): void {
    this.data[key] = value;
  }

  // 删除会话数据
  public deleteData(key: string): void {
    delete this.data[key];
  }

  // 清空会话数据
  public clearData(): void {
    this.data = {};
  }

  // 销毁会话
  public destroy(): void {
    this.clearData(); // 清理会话数据
  }

  public setMime(mimeType: 'png' | 'jpg' | 'jpeg' | 'pdf' | 'plain' | 'html' | 'json' | 'xml' | string): void {
    switch (mimeType) {
      case 'png':
        this.head['Content-Type'] = 'image/png';
        break;
      case 'jpg':
      case 'jpeg':
        this.head['Content-Type'] = 'image/jpeg';
        break;
      case 'pdf':
        this.head['Content-Type'] = 'application/pdf';
        break;
      case 'plain':
        this.head['Content-Type'] = 'text/plain';
        break;
      case 'html':
        this.head['Content-Type'] = 'text/html';
        break;
      case 'json':
        this.head['Content-Type'] = 'application/json';
        break;
      case 'xml':
        this.head['Content-Type'] = 'application/xml';
        break;
      default:
        this.head['Content-Type'] = mimeType;
        break;
    }
  }

  public send(data: any): any {
    return this.client.res.write(data);
  }

  public endsession(message: any): any {
    this.responseHandled = true;
    return this.client.res.end(message);
  }

  /**
   * 获取I18n文本
   * @param name 文本点名称
   */
  public text(name: string): any {
    return this.server.core.i18n.get(name, this.languages);
  }

  /**
   * 设置缓存标头
   * @param option 选项
   */
  setCache(option: CacheOptions) {
    if (option.etag) this.head['ETag'] = `${option.etag}`;
    if (option.modified) this.head['Last-Modified'] = option.modified.toUTCString();
    let control = []
    if (option.cacheControl !== undefined) control.push(option.cacheControl);
    if (option.maxAge !== undefined) control.push(`max-age=${option.maxAge}`);
    if (option.smaxAge !== undefined) control.push(`s-maxage=${option.smaxAge}`);
    if (option.isImmutable) control.push('immutable');
    if (control.length > 0) this.head['Cache-Control'] = control.join(', ');
    if (option.expires) this.head['Expires'] = option.expires.toUTCString();
  }

  /**
   * 设置静态文件
   * @param content 文件内容
   * @param option 选项
   */
  static(content: string, option: CacheOptions) {
    // 先查看用户是否在询问文件修改情况
    if (this.client.headers['If-Modified-Since']) {
      const modified = new Date(this.client.headers['If-Modified-Since']);
      if (modified.getTime() === option.modified?.getTime()) {
        this.status = 304;
        return;
      }
    }
    if (this.client.headers['If-None-Match']) {
      if (this.client.headers['If-None-Match'] === option.etag) {
        this.status = 304;
        return;
      }
    }
    this.setCache(option);
    this.response(content)
  }


  /**
   * 发送静态文件
   * @param path 文件路径
   * @param option 缓存选项
   * @returns void
   */
  file(path: string, option: StaticCacheOptions) {
    if (this.client.headers['If-Modified-Since']) {
      const modified = new Date(this.client.headers['If-Modified-Since']);

      const moditime = fs.statSync(path).mtime;
      if (modified.getTime() === moditime.getTime()) {
        this.status = 304;
        return;
      }
    }
    const etag = crypto.createHash(option.etagType || 'md5').update(fs.readFileSync(path)).digest('hex');
    if (this.client.headers['If-None-Match']) {
      if (option.etag) {
        if (this.client.headers['If-None-Match'] === etag) {
          this.status = 304;
          return;
        }
      }
    }
    this.setCache({
      modified: fs.statSync(path).mtime,
      etag,
      maxAge: option.maxAge,
      smaxAge: option.smaxAge,
      cacheControl: 'public'
    });
    this.response(fs.createReadStream(path), 'stream');
  }

  /**
   * 发送普通文件
   * @param path 文件路径
   * @param isStream 是否流式传输
   */
  sendFile(path: string, isStream: boolean = false) {
    if (isStream) {
      this.setMime('application/octet-stream')
      this.response(fs.createReadStream(path), 'stream');
    } else {
      this.response(fs.readFileSync(path), 'buffer');
    }
  }

  /**
   * 渲染模板
   * @template 模板字符串
   * @data 数据
   * @missing 缺失值处理方式，keep-template: 保留模板，keep-key: 保留键，remove: 移除
   * @regex 模板匹配正则，默认为{{ xxx.xxx }}
   */
  render(
    template: string,
    data: Record<string, any>,
    missing: MissingMode = 'keep-template',
    regex: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g
  ): string {
    const getValue = (obj: any, path: string) => {
      return path.split('.').reduce((acc, key) => acc?.[key], obj);
    };

    return template.replace(regex, (_, key) => {
      const value = getValue(data, key);
      if (value !== undefined) return String(value);
      switch (missing) {
        case 'keep-key':
          return key;
        case 'remove':
          return '';
        case 'keep-template':
        default:
          return _;
      }
    });
  }

  /**
   * Renders a UI component using the plugin's declared renderer.
   * @param component The component object to render.
   * @param data The data/props to pass to the component.
   */
  async renderView(component: any, data: Record<string, any> = {}) {
    if (!this.pluginContext) {
      throw new Error(`Cannot call 'renderView' because the session is not associated with a plugin context.`);
    }
    const rendererName = this.pluginContext.instance.render;
    const pluginName = this.pluginContext.pluginname;
    
    if (!rendererName) {
      this.server.core.logger.error(`Plugin "${pluginName}" uses 'renderView' but did not declare a renderer. Please add 'export const render = "your-renderer-name";' to your plugin's entry file.`);
      // throw new Error(`Plugin "${pluginName}" did not declare a renderer.`);
    }

    const renderer = this.server.core.renderers.get(rendererName);
    if (!renderer) {
      this.server.core.logger.error(`Renderer "${rendererName}" declared by plugin "${pluginName}" is not registered. Have you installed the renderer package (e.g., '@yumerijs/vue-renderer')?`);
      // throw new Error(`Renderer "${rendererName}" is not registered.`);
    }
    
    const renderOptions = {
      pluginName,
    };

    try {
      const html = await renderer.render(component, data, renderOptions);
      this.setMime('text/html');
      this.response(html, 'plain');
    } catch (error) {
      this.server.core.logger.error(`Error while rendering view for plugin "${pluginName}":`, error);
      throw error;
    }
  }
}
