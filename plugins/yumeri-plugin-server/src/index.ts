import { Core, Config, Session, Logger } from 'yumeri';
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
      this.httpServer = http.createServer(async (req, res) => {

        // 处理 CORS 预检请求
        if (req.method === 'OPTIONS') {
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
        const session = new Session(clientip, clientcookie, params);    // 假设 Session 类已定义

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
                    head['Access-Control-Allow-Origin'] = '*';//允许跨域
                    res.writeHead(session.status ?? 200, head);
                  } else {
                    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); //允许跨域
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
                      head['Access-Control-Allow-Origin'] = '*';//允许跨域
                      res.writeHead(session.status ?? 200, head);
                    } else {
                      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });//允许跨域
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
                logger.error('Invalid POST data', urlError); // 假设 logger 已定义
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
                head['Access-Control-Allow-Origin'] = '*';//允许跨域
                res.writeHead(session.status ?? 200, head);
              } else {
                res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });//允许跨域
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
        logger.info(`Yumeri Server listening on ${this.host}:${this.port}`);  // 假设 logger 已定义
        resolve();
      }).on('error', (err) => {
        logger.error(`Failed to start Yumeri Server on ${this.host}:${this.port}:`, err);  // 假设 logger 已定义
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
  }
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
          // >>>>>> 使用导入的 Type 'IncomingForm' 进行类型注解 <<<<<<
          const form = formidable.formidable({
               // 可选配置，例如 uploadDir, keepExtensions, maxFileSize 等
               // uploadDir: './uploads',
               // keepExtensions: true,
               // maxFileSize: 10 * 1024 * 1024 // 示例：10MB
          });

          // 调用 form.parse()
          // >>>>>> 使用导入的 Types 'Fields' 和 'Files' 进行类型注解 <<<<<<
          form.parse(req, (err: Error | null, fields: Fields, files: Files) => {
          // >>>>>> 修改结束 <<<<<<
              if (err) {
                  reject(new Error('Failed to parse multipart/form-data: ' + err.message));
                  return;
              }

              const parsedFields: ParsedParams = {};

              // 遍历 fields，处理不同版本的 formidable 返回结构
              // formidable v3+ 返回 Record<string, (string | formidable.File)[] | undefined>
              // 我们只提取字符串值
              for (const key in fields) {
                  if (Object.prototype.hasOwnProperty.call(fields, key)) {
                      const value = fields[key]; // value is (string | formidable.File)[] | undefined

                      if (Array.isArray(value) && value.length > 0) {
                           // 过滤数组，只保留字符串类型的元素
                           // 使用类型谓词 item is string 帮助 TypeScript 识别过滤后的类型
                           const stringValues = value.filter((item): item is string => typeof item === 'string');

                           if (stringValues.length > 0) {
                              // 如果有字符串值（一个或多个），存入结果
                              parsedFields[key] = stringValues.length === 1 ? stringValues[0] : stringValues;
                           }
                           // 如果 stringValues.length 是 0，表示这个字段的值都是 formidable.File 或其他非字符串类型，忽略。
                      }
                      // 忽略那些值为 undefined 或非数组的字段 (尽管 formidable 通常返回数组)
                  }
              }

              // files 对象中的文件信息被忽略，因为你只关心表单字段。
              // 如果需要处理文件，可以在这里遍历 files 并处理。

              resolve(parsedFields); // 返回解析好的文本字段参数
          });
          // formidable internal handling might cover this, but adding for completeness if needed
          // req.on('error', (error: Error) => reject(error));

      // === 处理不支持的 Content-Type ===
      } else {
          // 请求头中的 Content-Type 不支持
          reject(new Error('Unsupported Content-Type: ' + contentType));
      }
  });
}
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
  core.command('static')
    .action(async (session: Session, param?: any) => {
      if (!param.path) {
        session.body = `<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>yumerijs</center></body>`;
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
  core.registerComponent('server', server);
}

export async function disable(core: Core) {
  logger.info('Stopping server...')
  let server = core.getComponent('server');
  await server.stop();
  core.unregisterComponent('server');
}