import { Context, Core, Config, Session, Logger, Platform, ConfigSchema } from 'yumeri';
import { Command, ProtocolType, HttpMethod } from 'yumeri';
import * as fs from 'fs';
import * as mime from 'mime-types';
import http from 'http';
import * as path from 'path';
import { URL } from 'url';
import Ws from 'ws';

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

  /**
   * 是否启用 WebSocket 支持
   * @default true
   */
  enableWs: boolean;
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
    },
    enableWs: {
      type: 'boolean',
      default: true,
      description: '是否启用WebSocket支持（实验性）'
    }
  } as Record<string, ConfigSchema>
};

export class Server extends Platform {
  /** 核心实例 */
  private core: Core;
  /** 服务器监听端口 */
  private port: number;
  /** 服务器监听地址 */
  private host: string;
  /** HTTP 服务器实例 */
  private httpServer: http.Server | null = null;
  /** WebSocket 服务器实例 */
  private wsServer: Ws.Server | null = null;
  /** 是否启用 CORS */
  private enableCors: boolean;
  /** 静态文件目录 */
  private staticDir: string;
  /** 是否启用 WebSocket 支持 */
  private enableWs: boolean;

  /**
   * 创建服务器实例
   * @param core 核心实例
   * @param config 服务器配置
   */
  constructor(core: Core, config?: Partial<ServerConfig>) {
    super(config);
    this.core = core;
    this.port = this.getConfig<number>('port', 14510);
    this.host = this.getConfig<string>('host', '0.0.0.0');
    this.enableCors = this.getConfig<boolean>('enableCors', true);
    this.staticDir = this.getConfig<string>('staticDir', 'static');
    this.enableWs = this.getConfig<boolean>('enableWs', true);
  }

  /**
   * 终止会话
   * @param session 会话对象
   * @param message 消息内容
   */
  terminationSession(session: Session, message: any) {
    session.send(message);
  }

  /**
   * 获取平台ID
   * @returns 平台ID
   */
  getPlatformId(): string {
    return 'server';
  }

  /**
   * 获取平台状态
   * @returns 平台状态对象
   */
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

  /**
   * 获取平台版本代码
   * @returns 版本代码字符串
   */
  getPlatformVersionCode(): string {
    //自动返回npm包版本
    return require('../package.json').version;
  }

  /**
   * 获取平台名称
   * @returns 平台名称
   */
  getPlatformName(): string {
    return 'http';
  }

  /**
   * 启动平台
   * @param core 可选的核心实例
   * @returns Promise<void>
   */
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
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
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
        session.properties = { req: req, res: res, protocol: ProtocolType.HTTP };
        const header = req.headers;
        session.properties['header'] = header;

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

        // 获取 HTTP 方法并转换为小写
        const httpMethod = (req.method || 'GET').toLowerCase();
        params['yumeri-method'] = httpMethod;

        // 查找命令
        const command = this.core.getCommand(commandname);
        const fallbackcommand = this.core.getCommand('/')

        // 检查命令是否存在且支持 HTTP 协议和当前 HTTP 方法
        if (!command ||
          !command.supportsProtocol(ProtocolType.HTTP) ||
          !command.supportsHttpMethod(httpMethod)) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(`<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body>`);
          return;
        }
        if (!command && fallbackcommand) {
          commandname = '/'
        }

        // 在 startPlatform 方法中，找到 httpMethod === 'post' 的处理部分
        if (httpMethod === 'post') {
          let body: ParsedParams;
          try {
            const reqpost = await this.parseRequestBody(req);
            body = reqpost;

              try {
                const postData = body;
                Object.assign(params, postData);
                postData['yumeri-method'] = 'post'; // 确保保留这个标记

                this.core.executeCommand(commandname, session, params)
                  .then(session => {
                    // 默认处理
                    if (session != null) {
                      let head = session.head;
                      head['Set-Cookie'] = session.newCookie; // 使用原始的 Cookie 设置方式
                      if (this.enableCors) {
                        head['Access-Control-Allow-Origin'] = '*'; // 允许跨域
                      }
                      res.writeHead(session.status ?? 200, head);
                    } else {
                      const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                      if (this.enableCors) {
                        headers['Access-Control-Allow-Origin'] = '*'; // 允许跨域
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
                          head['Access-Control-Allow-Origin'] = '*'; // 允许跨域
                        }
                        res.writeHead(session.status ?? 200, head);
                      } else {
                        const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                        if (this.enableCors) {
                          headers['Access-Control-Allow-Origin'] = '*'; // 允许跨域
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
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Error parsing request body');
            logger.error('Error parsing request body', error);
          }
        } else {
          this.core.executeCommand(commandname, session, params)
            .then(session => {
              // 默认处理
              if (session != null) {
                let head = session.head;
                // 构建 cookie
                let existingCookies = head['Set-Cookie'];
                if (!existingCookies) {
                  head['Set-Cookie'] = []; // 初始化为空数组
                } else if (!Array.isArray(existingCookies)) {
                  head['Set-Cookie'] = [existingCookies];
                }
                for (const cookieName in session.newCookie) {
                  if (Object.prototype.hasOwnProperty.call(session.newCookie, cookieName)) {
                    const cookieValue = session.newCookie[cookieName];
                    const cookieString = `${cookieName}=${cookieValue}`;
                    head['Set-Cookie'].push(cookieString);
                  }
                }
                if (this.enableCors) {
                  head['Access-Control-Allow-Origin'] = '*'; // 允许跨域
                }
                res.writeHead(session.status ?? 200, head);
              } else {
                const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'text/plain' };
                if (this.enableCors) {
                  headers['Access-Control-Allow-Origin'] = '*'; // 允许跨域
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

      // 如果启用了 WebSocket 支持，则创建 WebSocket 服务器
      if (this.enableWs) {
        this.wsServer = new Ws.Server({ server: this.httpServer });
        this.wsServer.on('connection', (ws, req) => {
          // 提取路径和查询参数
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const pathname = url.pathname;
          const searchParams = url.searchParams;

          // 将查询参数转换为字典
          const params: Record<string, string> = {};
          searchParams.forEach((value, key) => {
            params[key] = value;
          });

          // 提取命令名
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

          const clientip = this.getClientIP(req);
          const clientcookie = this.parseCookies(req);
          const session = this.createSession(clientip, clientcookie, params);
          session.properties = { req, ws, protocol: ProtocolType.WS };

          // 查找命令
          const command = this.core.getCommand(commandname);

          // 检查命令是否存在且支持 WebSocket 协议
          if (!command || !command.supportsProtocol(ProtocolType.WS)) {
            ws.close(1000, `Command not found or does not support WebSocket protocol`);
            return;
          }

          // 执行连接处理函数
          if (command.connectFn) {
            command.connectFn(session, params).catch(error => {
              logger.error(`Error in WebSocket connect handler for command ${commandname}:`, error);
              ws.close(1011, 'Internal server error');
            });
          }

          // 监听消息
          ws.on('message', async (message) => {
            try {
              let messageData;
              try {
                // 尝试解析 JSON 消息
                messageData = JSON.parse(message.toString());
              } catch (e) {
                // 如果不是 JSON，则作为字符串处理
                messageData = { message: message.toString() };
              }

              // 合并消息数据到参数
              Object.assign(params, messageData);

              // 执行命令
              await this.core.executeCommand(commandname, session, params);
            } catch (error) {
              logger.error(`Error processing WebSocket message for command ${commandname}:`, error);
              ws.send(JSON.stringify({ error: 'Internal server error' }));
            }
          });

          // 监听关闭
          ws.on('close', () => {
            if (command.closeFn) {
              command.closeFn(session, params).catch(error => {
                logger.error(`Error in WebSocket close handler for command ${commandname}:`, error);
              });
            }
          });

          // 监听错误
          ws.on('error', (error) => {
            logger.error(`WebSocket error for command ${commandname}:`, error);
          });

          // // 设置消息发送处理
          // this.core.on('message', (msgSession, data) => {
          //   if (msgSession.properties?.ws === ws && ws.readyState === Ws.OPEN) {
          //     try {
          //       // 如果数据是对象，转换为 JSON 字符串
          //       if (typeof data === 'object' && data !== null) {
          //         ws.send(JSON.stringify(data));
          //       } else {
          //         ws.send(data);
          //       }
          //     } catch (error) {
          //       logger.error(`Error sending WebSocket message:`, error);
          //     }
          //   }
          // });

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

  /**
   * 停止平台服务
   * @returns 返回一个 Promise，表示平台停止操作的完成状态
   */
  async stopPlatform(): Promise<void> {
    if (this.status !== 'running' || !this.httpServer) {
      return Promise.resolve();
    }

    this.status = 'stopping';
    this.emit('stopping');

    return new Promise((resolve, reject) => {
      // 关闭 WebSocket 服务器（如果存在）
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = null;
      }

      // 关闭 HTTP 服务器
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

  /**
   * 向会话发送消息
   * @param session 会话对象
   * @param data 要发送的数据
   */
  sendMessage(session: Session, data: any) {
    // 检查会话协议类型
    if (session.properties?.protocol === ProtocolType.WS) {
      // WebSocket 会话
      const ws = session.properties?.ws;
      if (ws && ws.readyState === Ws.OPEN) {
        try {
          // 处理数据，确保它是可以发送的格式
          const processedData = this.processSessionData(session, data);
          if (typeof processedData === 'object' && processedData !== null) {
            ws.send(JSON.stringify(processedData));
          } else {
            ws.send(processedData);
          }
        } catch (error) {
          logger.error('Error sending WebSocket message:', error);
        }
      }
    } else {
      // HTTP 会话
      const res: http.ServerResponse<http.IncomingMessage> = session.properties?.res;
      if (res && !res.writableEnded) {
        // 处理数据，确保它是可以发送的格式
        const processedData = this.processSessionData(session, data);
        res.write(processedData);
      }
    }
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

export async function apply(ctx: Context, config: Config) {
  // 创建服务器实例，使用配置内容
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

  // 注册静态文件处理命令
  ctx.command('static')
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
  ctx.registerComponent('server', server);
}

export async function disable(ctx: Context) {
  logger.info('Stopping server...');
  const server = ctx.getComponent('server') as Server;
  await server.stopPlatform();
}
