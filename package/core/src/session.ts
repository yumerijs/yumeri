/**
 * @time: 2025/03/26 12:36
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import crypto from 'crypto';
import { Server } from './server';
import { IncomingMessage, ServerResponse } from 'http';
import * as formidable from 'formidable';
type ParsedParams = Record<string, string | string[] | undefined>;


export interface Client {
    req: IncomingMessage;
    res: ServerResponse;
    headers?: Record<string, string>;
}

export class Session {
    public ip: string;
    public cookie: Record<string, string>;
    public query: Record<string, string> | undefined;
    public sessionid: string;
    public data: Record<string, any> = {};
    public newCookie: Record<string, string> = {};
    public head: Record<string, any> = {};
    public status: number = 200;
    public body: any;
    public properties?: Record<string, any> = {};
    public client: Client = null;
    public server: Server;
    public protocol: string = 'http';
    public pathname: string;

    /*
     *  @ip: string，用户IP
     *  @cookie: string，会话cookie
     *  @query: string，请求字符串
     */
    constructor(ip: string, cookie: Record<string, string>, server: Server, req?: IncomingMessage, res?: ServerResponse, pathname?: string, query?: Record<string, string>){
        this.ip  = ip;
        this.cookie = cookie;
        this.query = query;
        this.server = server;
        this.pathname = pathname;
        this.client = {
          req: req,
          res: res
        }
        this.head['Content-Type'] = 'text/plain';
        if (cookie.sessionid) {
            this.sessionid = cookie.sessionid;
        }
        else {
            this.sessionid = this.generateId(this.ip);
            this.newCookie.sessionid = this.sessionid;
        }
    }

    // 生成 sessionid
    /*
     *  @ip: string，用户IP
     *  @option: string，选项
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
    return this.client.res.end(message);
  }
}