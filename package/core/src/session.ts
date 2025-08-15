/**
 * @time: 2025/03/26 12:36
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/

import crypto from 'crypto';
import { Server } from './server';
import { IncomingMessage, ServerResponse } from 'http';

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
    public res = null;
    public req = null;
    public server: Server;
    public protocol: string = 'http';

    /*
     *  @ip: string，用户IP
     *  @cookie: string，会话cookie
     *  @query: string，请求字符串
     */
    constructor(ip: string, cookie: Record<string, string>, server: Server, req?: IncomingMessage, res?: ServerResponse, query?: Record<string, string>){
        this.ip  = ip;
        this.cookie = cookie;
        this.query = query;
        this.server = server;
        this.req = req;
        this.res = res;
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
    return this.res.send(data);
  }

  public endsession(message: any): any {
    return this.res.end(message);
  }
}