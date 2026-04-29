import { Core } from './core.js';
import { Logger } from './logger.js';
import { Session } from './session.js';
import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { Stream } from 'stream';
import { Context } from './context.js';
import { resolveVirtualAsset } from '@yumerijs/types';


const logger = new Logger('server');

/** 服务器配置接口 */
export interface ServerConfig {
    /** 监听端口 */
    port: number;
    /** 监听主机 */
    host: string;
    /** 是否启用跨域 */
    enableCors: boolean;
    /** 是否启用 WebSocket */
    enableWs: boolean;
}

/** 判断是否为流对象 */
function isStream(value: any): value is Stream {
    return value && typeof value.pipe === "function";
}

/**
 * 核心服务器类
 * 负责底层 HTTP 请求的监听、分发和响应
 */
export class Server {
    public core: Core;
    private port: number;
    private host: string;
    private enableCors: boolean;
    private httpServer: http.Server | null = null;

    constructor(core: Core, config: Partial<ServerConfig> = {}) {
        this.core = core;
        this.port = config.port ?? 14510;
        this.host = config.host ?? '0.0.0.0';
        this.enableCors = config.enableCors ?? true;
    }

    /**
     * 创建一个新的会话对象
     */
    private createSession(ip: string, cookies: Record<string, string>, res?: ServerResponse, req?: IncomingMessage, pathname?: string, pluginContext?: Context, extra: Record<string, any> = {}) {
        const session = new Session(ip, cookies, this, req, res, pathname, undefined, pluginContext);
        Object.assign(session.properties, extra);
        session.protocol = extra.protocol ?? 'http';
        return session;
    }

    /**
     * 解析请求中的 Cookie
     */
    private parseCookies(req: IncomingMessage) {
        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) return {};
        const cookies: Record<string, string> = {};
        cookieHeader.split(';').forEach(c => {
            const [k, ...v] = c.split('=');
            cookies[k.trim()] = v.join('=').trim();
        });
        return cookies;
    }

    /**
     * 获取客户端真实 IP
     */
    private getClientIP(req: IncomingMessage) {
        const xff = req.headers['x-forwarded-for'] as string | undefined;
        return xff ? xff.split(',')[0].trim() : req.socket.remoteAddress || '127.0.0.1';
    }

    /**
     * 启动服务器
     */
    async start() {
        this.httpServer = http.createServer(async (req, res) => {
            // 处理跨域预检请求
            if (req.method === 'OPTIONS' && this.enableCors) {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                });
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;
            const queryParams = url.searchParams;
            const ip = this.getClientIP(req);
            const cookies = this.parseCookies(req);

            // 处理虚拟资产加载
            if (req.method === 'GET' || req.method === 'HEAD') {
                const virtualAsset = await resolveVirtualAsset(pathname);
                if (virtualAsset) {
                    const headers = virtualAsset.headers || {};
                    headers['Content-Type'] = headers['Content-Type'] || virtualAsset.contentType || 'application/octet-stream';
                    res.writeHead(200, headers);
                    res.end(virtualAsset.body);
                    return;
                }
            }

            const route = this.core.getRoute(pathname);
            const rootroute = this.core.getRoute('root');
            const pluginContext = route ? route.context : (rootroute ? rootroute.context : undefined);

            const session = this.createSession(ip, cookies, res, req, pathname, pluginContext, { protocol: 'http', header: req.headers });
            (session as any)._startAt = Date.now();

            /** 路由处理逻辑 */
            const handleRoute = async (routePath: string) => {
                const matched = await this.core.executeRoute(routePath, session, queryParams);
                if (!matched) {
                    // 核心层不再提供静态文件服务，直接返回 404
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                    return;
                }

                if (session.responseHandled) return;

                // 组装响应头
                const head = { ...session.head };
                head['Set-Cookie'] = Object.entries(session.newCookie).map(([name, cookie]) => {
                    let cookieString = `${name}=${cookie.value}`;
                    if (cookie.options.expires) cookieString += `; Expires=${cookie.options.expires.toUTCString()}`;
                    if (cookie.options.path) cookieString += `; Path=${cookie.options.path}`;
                    if (cookie.options.domain) cookieString += `; Domain=${cookie.options.domain}`;
                    if (cookie.options.secure) cookieString += `; Secure`;
                    if (cookie.options.httpOnly) cookieString += `; HttpOnly`;
                    if (cookie.options.sameSite) cookieString += `; SameSite=${cookie.options.sameSite}`;
                    return cookieString;
                });

                if (this.enableCors) {
                    head['Access-Control-Allow-Origin'] = '*';
                }

                res.writeHead(session.status ?? 200, head);

                // 根据响应类型输出内容
                switch (session.restype) {
                    case 'plain':
                        res.end(session.body as string);
                        break;
                    case 'buffer':
                        res.end(session.body);
                        break;
                    case 'json':
                        res.end(JSON.stringify(session.body));
                        break;
                    case 'stream':
                        if (isStream(session.body)) {
                            const stream = session.body as Stream;
                            stream.pipe(res);
                        }
                        break;
                    default:
                        res.end(session.body);
                }
            };

            // 分发请求
            if (route && route.allowedMethods.includes(req.method ?? 'GET')) {
                await handleRoute(pathname);
            } else if (rootroute && rootroute.allowedMethods.includes(req.method ?? 'GET')) {
                await handleRoute('root');
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        // 处理 WebSocket 升级
        this.httpServer.on('upgrade', async (req, socket, head) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;
            const queryParams = url.searchParams;
            const ip = this.getClientIP(req);
            const cookies = this.parseCookies(req);
            const route = this.core.getRoute(pathname);
            const pluginContext = route ? route.context : undefined;

            const session = this.createSession(ip, cookies, null, req, pathname, pluginContext, { protocol: 'http', header: req.headers });
            if (route && route.ws != null) {
                const matched = await this.core.executeRoute(pathname, session, queryParams);
                if (!matched) {
                    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                    socket.destroy();
                } else {
                    route.ws.handleUpgrade(req, socket, head, (ws) => {
                        route.ws.emit('connection', ws, req, session);
                    })
                }
            } else {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
            }
        })

        this.httpServer.listen(this.port, this.host, () => {
            logger.info(`Server listening on ${this.host}:${this.port}`);
        });
    }

    /** 停止服务器 */
    stop() {
        if (this.httpServer) this.httpServer.close(() => logger.info('Server stopped'));
    }
}
