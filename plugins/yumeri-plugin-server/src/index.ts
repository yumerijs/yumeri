import { Context, Core, Config, Session, Logger, Platform, ConfigSchema } from 'yumeri';
import * as fs from 'fs';
import * as mime from 'mime-types';
import http from 'http';
import * as path from 'path';
import { URL } from 'url';
import Ws from 'ws';
import { IncomingMessage } from 'http';
import * as formidable from 'formidable';
type ParsedParams = Record<string, string | string[] | undefined>;

const logger = new Logger('server');

export const provide = ['server'];

export interface ServerConfig {
  port: number;
  host: string;
  enableCors: boolean;
  staticDir: string;
  enableWs: boolean;
}

export const config = {
  schema: {
    port: { type: 'number', default: 14510, description: '服务器监听端口' },
    host: { type: 'string', default: '0.0.0.0', description: '服务器监听地址' },
    enableCors: { type: 'boolean', default: true, description: '是否启用CORS' },
    staticDir: { type: 'string', default: 'static', description: '静态文件目录' },
    enableWs: { type: 'boolean', default: true, description: '是否启用WebSocket支持' }
  } as Record<string, ConfigSchema>
};

export class Server extends Platform {
  private core: Core;
  private port: number;
  private host: string;
  private httpServer: http.Server | null = null;
  private wsServer: Ws.Server | null = null;
  private enableCors: boolean;
  private staticDir: string;
  private enableWs: boolean;

  constructor(core: Core, config?: Partial<ServerConfig>) {
    super(config);
    this.core = core;
    this.port = this.getConfig<number>('port', 14510);
    this.host = this.getConfig<string>('host', '0.0.0.0');
    this.enableCors = this.getConfig<boolean>('enableCors', true);
    this.staticDir = this.getConfig<string>('staticDir', 'static');
    this.enableWs = this.getConfig<boolean>('enableWs', true);
  }

  terminationSession(session: Session, message: any) {
    session.send(message);
  }

  getPlatformId(): string {
    return 'server';
  }

  getPlatformStatus() {
    return {
      port: this.port,
      host: this.host,
      running: this.status === 'running',
      enableCors: this.enableCors,
      staticDir: this.staticDir,
      enableWs: this.enableWs
    };
  }

  getPlatformVersionCode(): string {
    return require('../package.json').version;
  }

  getPlatformName(): string {
    return 'http';
  }

  async startPlatform(core?: Core): Promise<void> {
    if (core) this.core = core;
    this.status = 'starting';
    this.emit('starting');

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        if (req.method === 'OPTIONS' && this.enableCors) {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;
        const searchParams = url.searchParams;

        const clientip = this.getClientIP(req);
        const clientcookie = this.parseCookies(req);
        const session = this.createSession(clientip, clientcookie, {});
        session.properties = { req, res, protocol: 'http' };
        session.properties['header'] = req.headers;

        if (req.method?.toLowerCase() === 'post') {
            try {
                const body = await this.parseRequestBody(req);
                // 将 body 的内容添加到 searchParams 中
                for (const key in body) {
                    const value = body[key];
                    if (typeof value === 'string') {
                        searchParams.set(key, value);
                    } else if (Array.isArray(value)) {
                        value.forEach(v => searchParams.append(key, v));
                    }
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Error parsing request body');
                logger.error('Error parsing request body', error);
                return;
            }
        }

        const routeMatched = await this.core.executeRoute(pathname, session, searchParams);

        if (routeMatched) {
            let head = session.head;
            head['Set-Cookie'] = Object.entries(session.newCookie).map(([k, v]) => `${k}=${v}`);
            if (this.enableCors) {
                head['Access-Control-Allow-Origin'] = '*';
            }
            res.writeHead(session.status ?? 200, head);
            res.end(session.body);
        } else {
            // 尝试提供静态文件
            this.serveStaticFile(pathname, session, res);
        }
      });

      if (this.enableWs) {
        this.wsServer = new Ws.Server({ server: this.httpServer });
        this.wsServer.on('connection', (ws, req) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;
            const searchParams = url.searchParams;

            const clientip = this.getClientIP(req);
            const clientcookie = this.parseCookies(req);
            const session = this.createSession(clientip, clientcookie, {});
            session.properties = { req, ws, protocol: 'ws' };

            ws.on('message', async (message) => {
                try {
                    let messageData = JSON.parse(message.toString());
                    for (const key in messageData) {
                        searchParams.set(key, messageData[key]);
                    }
                } catch (e) {
                    searchParams.set('message', message.toString());
                }
                await this.core.executeRoute(pathname, session, searchParams);
            });

            // 初始连接时也尝试匹配路由
            this.core.executeRoute(pathname, session, searchParams).catch(err => {
                logger.error(`Error in initial WebSocket route execution for ${pathname}:`, err);
                ws.close(1011, 'Internal server error during connection.');
            });
        });
      }

      this.httpServer.listen(this.port, this.host, () => {
        this.status = 'running';
        this.emit('started');
        logger.info(`Yumeri Server listening on ${this.host}:${this.port}`);
        resolve();
      }).on('error', (err) => {
        this.status = 'error';
        this.errorMessage = err.message;
        this.emit('error', err);
        logger.error(`Failed to start Yumeri Server on ${this.host}:${this.port}:`, err);
        reject(err);
      });
    });
  }

  private serveStaticFile(pathname: string, session: Session, res: http.ServerResponse) {
    const staticDir = this.getConfig<string>('staticDir', 'static');
    const fullPath = path.join(process.cwd(), staticDir, pathname);

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(`<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body>`);
        } else {
            const mimeType = mime.lookup(fullPath) || 'text/plain';
            res.writeHead(200, { 'Content-Type': mimeType });
            res.end(data);
        }
    });
  }

  async stopPlatform(): Promise<void> {
    if (this.status !== 'running' || !this.httpServer) {
      return Promise.resolve();
    }

    this.status = 'stopping';
    this.emit('stopping');

    return new Promise((resolve, reject) => {
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = null;
      }

      if (this.httpServer) {
        this.httpServer.close((err) => {
          if (err) {
            this.status = 'error';
            this.errorMessage = err.message;
            this.emit('error', err);
            logger.error('Failed to stop Yumeri Server:', err);
            reject(err);
          } else {
            this.status = 'idle';
            this.emit('stopped');
            logger.info('Yumeri Server stopped.');
            resolve();
          }
        });
      } else {
        this.status = 'idle';
        resolve();
      }
    });
  }

  sendMessage(session: Session, data: any) {
    if (session.properties?.protocol === 'ws') {
      const ws = session.properties?.ws;
      if (ws && ws.readyState === Ws.OPEN) {
        try {
          const processedData = this.processSessionData(session, data);
          ws.send(typeof processedData === 'object' && processedData !== null ? JSON.stringify(processedData) : processedData);
        } catch (error) {
          logger.error('Error sending WebSocket message:', error);
        }
      }
    } else {
      const res: http.ServerResponse = session.properties?.res;
      if (res && !res.writableEnded) {
        res.write(this.processSessionData(session, data));
      }
    }
  }

  public processSessionData(session: Session, data: any): any {
    if (typeof data === 'object' && data !== null && !(data instanceof Buffer) && !(data instanceof require('stream').Readable)) {
      if (session.head['Content-Type'] === 'application/json') {
        return JSON.stringify(data);
      }
    }
    return data;
  }

  private getClientIP(req: http.IncomingMessage): string {
    const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  private async parseRequestBody(req: IncomingMessage): Promise<ParsedParams> {
    return new Promise((resolve, reject) => {
      const contentType = req.headers['content-type']?.toLowerCase() || '';

      if (contentType.includes('application/json')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Invalid JSON body'));
          }
        });
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const parsed: ParsedParams = {};
          params.forEach((value, key) => parsed[key] = value);
          resolve(parsed);
        });
      } else if (contentType.includes('multipart/form-data')) {
        const form = formidable.formidable({});
        form.parse(req, (err, fields, files) => {
          if (err) return reject(err);
          const parsed: ParsedParams = {};
          for (const key in fields) {
              const value = fields[key];
              if(Array.isArray(value)) {
                parsed[key] = value.length === 1 ? value[0] : value;
              }
          }
          resolve(parsed);
        });
      } else {
        resolve({});
      }
      req.on('error', reject);
    });
  }

  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const cookieString = req.headers.cookie;
    if (!cookieString) return {};
    const cookies: Record<string, string> = {};
    cookieString.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
    return cookies;
  }

  public static getConfigSchema(): Record<string, ConfigSchema> {
    return config.schema;
  }
}

export async function apply(ctx: Context, config: Config) {
  const serverConfig: Partial<ServerConfig> = {
    port: config.get<number>('port', 14510),
    host: config.get<string>('host', '0.0.0.0'),
    enableCors: config.get<boolean>('enableCors', true),
    staticDir: config.get<string>('staticDir', 'static'),
    enableWs: config.get<boolean>('enableWs', true)
  };
  const core = ctx.getCore();

  const server = new Server(core, serverConfig);
  core.registerPlatform(server);
  ctx.registerComponent('server', server);
}

export async function disable(ctx: Context) {
  logger.info('Stopping server...');
  const server = ctx.getComponent('server') as Server;
  if (server) {
    await server.stopPlatform();
  }
}
