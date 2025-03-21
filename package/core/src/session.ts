import crypto from 'crypto';

export class Session {
    public ip: string;
    public cookie: string;
    public query: string | undefined;
    public sessionid: string;
    public data: Record<string, any> = {};


    /*
     *  @ip: string，用户IP
     *  @cookie: string，会话cookie
     *  @query: string，请求字符串
     */
    constructor(ip: string, cookie: string, query?: string){
        this.ip  = ip;
        this.cookie = cookie;
        this.query = query;

        let jsoncookie: any;
        try {
             jsoncookie = JSON.parse(this.cookie);
        } catch (error) {
            console.error("Error parsing cookie:", error);
            jsoncookie = {};
        }

        if (jsoncookie.sessionid) {
            this.sessionid = jsoncookie.sessionid;
        }
        else {
            this.sessionid = this.generateId(this.ip);
            // TODO: 在这里设置 cookie，将 sessionid 返回给客户端
            // 例如设置响应头 Set-Cookie: sessionid=xxx; HttpOnly
        }
    }

    // 生成 sessionid
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

    // （可选）销毁会话
    public destroy(): void {
        this.clearData(); // 清理会话数据
    }
// 从请求路径提取指令和剩余的查询字符串
  private getCommand(): { command: string | null, queryString: string | null } {
    try {
      const jsoncookie = JSON.parse(this.cookie);
      if (jsoncookie.requestPath) {
        const path = jsoncookie.requestPath;
        const pathParts = path.split('?'); // 分割路径和查询字符串
        const command = pathParts[0].substring(1); // 移除开头的 '/' (如果存在)
        const queryString = pathParts.length > 1 ? pathParts[1] : null; // 获取查询字符串，若没有则为 null

        return { command: command || null, queryString };
      }
      return { command: null, queryString: null };
    } catch (e) {
      console.error('Could not extract path from cookie', e);
      return { command: null, queryString: null };
    }
  }
}