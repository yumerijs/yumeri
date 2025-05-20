import { Core, Config, Session, Logger, Platform, ConfigSchema } from 'yumeri';
import * as fs from 'fs';
import * as mime from 'mime-types';
import http from 'http';
import * as path from 'path';
import { URL } from 'url';

import { IncomingMessage } from 'http'; // 引入 Node.js HTTP 模块的 IncomingMessage 类型
import * as formidable from 'formidable'; // 引入 formidable 库
type ParsedParams = Record<string, string | string[] | undefined>;
import type { IncomingForm, Fields, Files } from 'formidable';

const logger = new Logger('server');

export const provide = ['server'];

/**
 * 服务器配置接口
 */
export interface ServerConfig {
  /**
   * 服务器监听端口
   * @default 14510
   */
  port: number;
  
  /**
   * 服务器监听地址
   * @default "0.0.0.0"
   */
  host: string;
  
  /**
   * 是否启用CORS
   * @default true
   */
  enableCors: boolean;
  
  /**
   * 静态文件目录
   * @default "static"
   */
  staticDir: string;
}

/**
 * 默认服务器配置
 */
export const config = {
  schema: {
    port: {
      type: 'number',
      default: 14510,
      description: '服务器监听端口'
    },
    host: {
      type: 'string',
      default: '0.0.0.0',
      description: '服务器监听地址'
    },
    enableCors: {
      type: 'boolean',
      default: true,
      description: '是否启用CORS'
    },
    staticDir: {
      type: 'string',
      default: 'static',
      description: '静态文件目录'
    }
  } as Record<string, ConfigSchema>
};

export class Server extends Platform {
  private core: Core;
  private port: number;
  private host: string;
  private httpServer: http.Server | null = null;
  private enableCors: boolean;
  private staticDir: string;

  constructor(core: Core, config?: Partial<ServerConfig>) {
    super(config);
    this.core = core;
    this.port = this.getConfig<number>('port', 14510);
    this.host = this.getConfig<string>('host', '0.0.0.0');
    this.enableCors = this.getConfig<boolean>('enableCors', true);
    this.staticDir = this.getConfig<string>('staticDir', 'static');
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
      staticDir: this.staticDir
    };
  }

  getPlatformVersionCode(): string {
    //自动返回npm包版本
    return require('../package.json').version;
  }

  getPlatformName(): string {
    return 'http';
  }

  async startPlatform(core?: Core): Promise<void> {
    if (core) {
      this.core = core;
    }
    
    this.status = 'starting';
    this.emit('starting');
    
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        // 处理 CORS 预检请求
        if (req.method === 'OPTIONS' && this.enableCors) {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          res.end();
          return;
        }

        // 提取指令名 (路径) 和查询参数
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;
        const searchParams = url.searchParams;

        // 将查询参数转换为字典
        const params: Record<string, string> = {};
        searchParams.forEach((value, key) => {
          params[key] = value;
        });

        const clientip = this.getClientIP(req);
        const clientcookie = this.parseCookies(req);
        const session = this.createSession(clientip, clientcookie, params);
        session.properties = {req: req, res: res};

        let commandname = '';
        let path = '';
        const pathParts = pathname.split('/');
        if (pathParts.length > 1) {
          commandname = pathParts[1];
          if (pathParts.length > 2) {
            path = '/' + pathParts.slice(2).join('/');
          }
        }
        params['path'] = path;

        if (req.method === 'POST') {
          let body;
          const reqpost = await this.parseRequestBody(req);
          body = reqpost;

          req.on('end', () => {
            try {
              const postData = body;
              Object.assign(params, postData);
              postData['yumeri-method'] = 'post';

              this.core.executeCommand(commandname, session, params)
                .then(session => {
                  // 默认处理
                  if (session != null) {
                    let head = session.head;
                    head['Set-Cookie'] = session.newCookie;
                    if (this.enableCors) {
                      head['Access-Control-Allow-Origin'] = '*'; //允许跨域
                    }
                    res.writeHead(session.status ?? 200, head);
                  } else {
                    const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                    if (this.enableCors) {
                      headers['Access-Control-Allow-Origin'] = '*'; //允许跨域
                    }
                    res.writeHead(200, headers);
                  }
                  if (session != null) {
                    res.end(session.body);
                  } else {
                    res.end('Hello, World from Yumeri Plugin Server!');
                  }
                });

            } catch (jsonError) {
              try {
                const postData = new URLSearchParams(body as Record<string, string>);
                for (const [key, value] of postData.entries()) {
                  params[key] = value;
                }
                this.core.executeCommand(commandname, session, params)
                  .then(session => {
                    // 默认处理
                    if (session != null) {
                      let head = session.head;
                      head['Set-Cookie'] = session.newCookie;
                      if (this.enableCors) {
                        head['Access-Control-Allow-Origin'] = '*'; //允许跨域
                      }
                      res.writeHead(session.status ?? 200, head);
                    } else {
                      const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                      if (this.enableCors) {
                        headers['Access-Control-Allow-Origin'] = '*'; //允许跨域
                      }
                      res.writeHead(200, headers);
                    }
                    if (session != null) {
                      res.end(session.body);
                    } else {
                      res.end('Hello, World from Yumeri Plugin Server!');
                    }
                  });

              } catch (urlError) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid POST data');
                logger.error('Invalid POST data', urlError);
              }
            }
          });
        } else {
          this.core.executeCommand(commandname, session, params)
            .then(session => {
              // 默认处理
              if (session != null) {
                let head = session.head;
                //构建cookie
                let existingCookies = head['Set-Cookie'];
                if (!existingCookies) {
                  head['Set-Cookie'] = []; //初始化为空数组
                } else if (!Array.isArray(existingCookies)) {
                  head['Set-Cookie'] = [existingCookies];
                }
                for (const cookieName in session.newCookie) {
                  if (Object.hasOwnProperty.call(session.newCookie, cookieName)) {
                    const cookieValue = session.newCookie[cookieName];
                    const cookieString = `${cookieName}=${cookieValue}`;

                    head['Set-Cookie'].push(cookieString);
                  }
                }
                if (this.enableCors) {
                  head['Access-Control-Allow-Origin'] = '*'; //允许跨域
                }
                res.writeHead(session.status ?? 200, head);
              } else {
                const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                if (this.enableCors) {
                  headers['Access-Control-Allow-Origin'] = '*'; //允许跨域
                }
                res.writeHead(200, headers);
              }
              if (session != null) {
                res.end(session.body);
              } else {
                res.end('Hello, World from Yumeri Plugin Server!');
              }
            });
        }
      });

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

  async stopPlatform(): Promise<void> {
    if (this.status !== 'running' || !this.httpServer) {
      return Promise.resolve();
    }
    
    this.status = 'stopping';
    this.emit('stopping');
    
    return new Promise((resolve, reject) => {
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
    const res: http.ServerResponse<http.IncomingMessage> = session.properties?.res;
    // 处理数据，确保它是可以发送的格式
    const processedData = this.processSessionData(session, data);
    res.write(processedData);
  }

  /**
   * 处理会话数据
   * @param session 会话对象
   * @param data 会话数据
   * @returns 处理后的数据
   */
  public processSessionData(session: Session, data: any): any {
    // 如果数据是对象且不是Buffer或Stream，则转换为JSON字符串
    if (typeof data === 'object' && data !== null && 
        !(data instanceof Buffer) && 
        !(data instanceof require('stream').Readable)) {
      if (session.head['Content-Type'] === 'application/json') {
        return JSON.stringify(data);
      }
    }
    return data;
  }

  /**
   * 获取客户端IP地址
   * @param req HTTP请求对象
   * @returns 客户端IP地址
   */
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
  }

  /**
   * 解析请求体
   * @param req HTTP请求对象
   * @returns 解析后的参数
   */
  private async parseRequestBody(req: IncomingMessage): Promise<ParsedParams> {
    return new Promise((resolve, reject) => {
      const contentType: string | undefined = req.headers['content-type'];

      if (!contentType) {
          resolve({});
          return;
      }

      // 确保 Content-Type 头部是字符串且不为 null/undefined
      const lowerCaseContentType = contentType.toLowerCase();

      // === 处理 application/json ===
      if (lowerCaseContentType.includes('application/json')) {
          let body: string = '';
          req.on('data', (chunk: Buffer | string) => {
              body += chunk.toString();
          });
          req.on('end', () => {
              try {
                  const jsonBody: Record<string, any> = JSON.parse(body);
                  resolve(jsonBody as ParsedParams);
              } catch (error: any) {
                  reject(new Error('Failed to parse JSON body: ' + error.message));
              }
          });
          req.on('error', (error: Error) => reject(error));

      // === 处理 application/x-www-form-urlencoded ===
      } else if (lowerCaseContentType.includes('application/x-www-form-urlencoded')) {
           let body: string = '';
           req.on('data', (chunk: Buffer | string) => {
               body += chunk.toString();
           });
           req.on('end', () => {
               try {
                   const params: URLSearchParams = new URLSearchParams(body);
                   const parsed: ParsedParams = {};
                   for (const [key, value] of params.entries()) {
                     parsed[key] = value;
                   }
                   resolve(parsed);
               } catch (error: any) {
                    reject(new Error('Failed to parse URL-encoded body: ' + error.message));
               }
           });
           req.on('error', (error: Error) => reject(error));

      // === 处理 multipart/form-data 使用 formidable ===
      } else if (lowerCaseContentType.includes('multipart/form-data')) {
          const form = formidable.formidable({
               // 可选配置，例如 uploadDir, keepExtensions, maxFileSize 等
               // uploadDir: './uploads',
               // keepExtensions: true,
               // maxFileSize: 10 * 1024 * 1024 // 示例：10MB
          });

          form.parse(req, (err: Error | null, fields: Fields, files: Files) => {
              if (err) {
                  reject(new Error('Failed to parse multipart/form-data: ' + err.message));
                  return;
              }

              const parsedFields: ParsedParams = {};

              // 遍历 fields，处理不同版本的 formidable 返回结构
              for (const key in fields) {
                  if (Object.prototype.hasOwnProperty.call(fields, key)) {
                      const value = fields[key];

                      if (Array.isArray(value) && value.length > 0) {
                           // 过滤数组，只保留字符串类型的元素
                           const stringValues = value.filter((item): item is string => typeof item === 'string');

                           if (stringValues.length > 0) {
                              // 如果有字符串值（一个或多个），存入结果
                              parsedFields[key] = stringValues.length === 1 ? stringValues[0] : stringValues;
                           }
                      }
                  }
              }

              resolve(parsedFields);
          });

      // === 处理不支持的 Content-Type ===
      } else {
          // 请求头中的 Content-Type 不支持
          reject(new Error('Unsupported Content-Type: ' + contentType));
      }
    });
  }

  /**
   * 解析Cookie
   * @param req HTTP请求对象
   * @returns Cookie对象
   */
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
  
  /**
   * 获取平台配置模式
   * @returns 配置模式对象
   */
  public static getConfigSchema(): Record<string, ConfigSchema> {
    return config.schema;
  }
}

export async function apply(core: Core, config: Config) {
  // 创建服务器实例，使用配置内容
  const serverConfig: Partial<ServerConfig> = {
    port: config.get<number>('port', 14510),
    host: config.get<string>('host', '0.0.0.0'),
    enableCors: config.get<boolean>('enableCors', true),
    staticDir: config.get<string>('staticDir', 'static')
  };
  
  const server = new Server(core, serverConfig);
  core.registerPlatform(server);
  
  // 注册静态文件处理命令
  core.command('static')
    .action(async (session: Session, param?: any) => {
      if (!param.path) {
        await session.send(`<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body>`);
        session.setMime('html');
        return;
      }
      try {
        const staticDir = server.getConfig<string>('staticDir', 'static');
        const fullPath = path.join(process.cwd(), staticDir, param.path);
        session.body = fs.readFileSync(fullPath);
        session.setMime(mime.lookup(fullPath) || 'text/plain');
        return;
      } catch (e) {
        await session.send(`<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body>`);
        session.setMime("text/html");
        return;
      }
    });
    
  // 注册服务器组件
  core.registerComponent('server', server);
}

export async function disable(core: Core) {
  logger.info('Stopping server...');
  const server = core.getComponent('server') as Server;
  await server.stopPlatform();
  core.unregisterComponent('server');
}
