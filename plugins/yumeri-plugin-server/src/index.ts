import { Core, Config, Session, Logger } from 'yumeri';
import * as fs from 'fs';
import * as mime from 'mime-types';
import http from 'http';
import * as path from 'path';
import { URL } from 'url';

const logger = new Logger('server');

export class Server {
  private core: Core;
  private port: number;
  private host: string;
  private httpServer: http.Server | null = null;
  

  constructor(core: Core, port: number = 14510, host: string = '0.0.0.0') {
    this.core = core;
    this.port = port;
    this.host = host;
  }

async start(): Promise<void> {
  return new Promise((resolve, reject) => {
    this.httpServer = http.createServer((req, res) => {
      // 提取指令名 (路径) 和查询参数
      const url = new URL(req.url || '/', `http://${req.headers.host}`); // 构造完整的 URL，req.url 为 undefined 时提供默认值
      const pathname = url.pathname;
      const searchParams = url.searchParams;

      // 将查询参数转换为字典
      const params: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const clientip = this.getClientIP(req); 
      const clientcookie = this.parseCookies(req);
      const session = new Session(clientip, clientcookie, params); 

        let commandname = '';
        let path = '';
        const pathParts = pathname.split('/');
        if (pathParts.length > 1) {
          commandname = pathParts[1]; // 取一级路径作为 commandname
          if (pathParts.length > 2) {
            path = '/' + pathParts.slice(2).join('/'); // 取一级路径之后的作为 path
          }
        }
        params['path'] = path; // 将path作为参数传递

      this.core.executeCommand(commandname, session, params)
        .then(session => {
          // 默认处理
          if (session != null) {
            let head = session.head;
            head['Set-Cookie'] = session.newCookie;
            res.writeHead(session.status ?? 200, head);
          } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
          }
          if (session != null) {
            res.end(session.body);
          } else {
            res.end('Hello, World from Yumeri Plugin Server!');
          }
        });
    });

    this.httpServer.listen(this.port, this.host, () => { // 监听 host
      logger.info(`Yumeri Server listening on ${this.host}:${this.port}`); // 假设logger已定义
      resolve();
    }).on('error', (err) => {
      logger.error(`Failed to start Yumeri Server on ${this.host}:${this.port}:`, err); // 假设logger已定义
      reject(err);
    });
  });
}
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        this.httpServer.close((err) => {
          if (err) {
            logger.error('Failed to stop Yumeri Server:', err);
            reject(err);
          } else {
            logger.info('Yumeri Server stopped.');
            resolve();
          }
        });
      } else {
        resolve(); // 如果服务器没有启动，直接 resolve
      }
    });
  }
  private getClientIP(req: http.IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    const remoteAddress = req.socket.remoteAddress;
    if (remoteAddress) {
      return remoteAddress;
    }
    if (req.connection && req.connection.remoteAddress) {
        return req.connection.remoteAddress;
    }
    return '127.0.0.1';
  };
  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const cookieString = req.headers.cookie;
    if (!cookieString) {
        return {};
    }

    const cookies: Record<string, string> = {};
    cookieString.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim(); // 允许 value 包含等号
            cookies[name] = value;
        }
    });

    return cookies;
  }
}

export async function apply(core: Core, config: Config) {
  const server = new Server(core, config.content.port, config.content.host);
  await server.start();
  
  /* Register dev command
   * @param: none
   */
  /*
  core.command('dev')
    .action(async (session: Session, param?: any) => {
      logger.info('Receive dev command. Sessionid: ',session.sessionid);
      session.setMime('html');
      session.body = `<h1>This is dev</h1>
<h2>welcome!</h2>`;
    });
   */
  core.command('static')
    .action(async (session: Session, param?: any) => {
      if (!param.path) {
        session.body = `<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>yumerijs</center>
</body>`;
        session.setMime('html');
        return;
      }
      try {
        const fullPath = path.join(process.cwd(), 'static', param.path);
        session.body = fs.readFileSync(fullPath);
        session.setMime(mime.lookup(fullPath) || 'text/plain');
        return;
      } catch (e) {
        session.body = `<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body></html>`;
        session.setMime("text/html");
        return;
      }
    });
  core.registerComponent('server',server);
}

export async function disable(core: Core) {
  logger.info('Stopping server...')
  let server = core.getComponent('server');
  await server.stop();
  core.unregisterComponent('server');
}