import { Core } from './core';
import { Logger } from './logger';
import { Session, Client } from './session';
import http, { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import Ws from 'ws';
import * as mime from 'mime-types';


const logger = new Logger('server');

export interface ServerConfig {
    port: number;
    host: string;
    enableCors: boolean;
    staticDir: string;
    enableWs: boolean;
}

export class Server {
    private core: Core;
    private port: number;
    private host: string;
    private enableCors: boolean;
    private staticDir: string;
    private httpServer: http.Server | null = null;

    constructor(core: Core, config: Partial<ServerConfig> = {}) {
        this.core = core;
        this.port = config.port ?? 14510;
        this.host = config.host ?? '0.0.0.0';
        this.enableCors = config.enableCors ?? true;
        this.staticDir = config.staticDir ?? 'static';
    }

    private createSession(ip: string, cookies: Record<string, string>, res?: ServerResponse, req?: IncomingMessage, pathname?: string, extra: Record<string, any> = {}) {
        const session = new Session(ip, cookies, this, req, res, pathname);
        Object.assign(session.properties, extra);
        session.protocol = extra.protocol ?? 'http';
        return session;
    }

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

    private getClientIP(req: IncomingMessage) {
        const xff = req.headers['x-forwarded-for'] as string | undefined;
        return xff ? xff.split(',')[0].trim() : req.socket.remoteAddress || '127.0.0.1';
    }

    private serveStaticFile(pathname: string, res: ServerResponse) {
        const fullPath = path.join(process.cwd(), this.staticDir, pathname);
        fs.readFile(fullPath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`<html><body><h1>404 Not Found</h1></body></html>`);
            } else {
                res.writeHead(200, { 'Content-Type': mime.lookup(fullPath) || 'text/plain' });
                res.end(data);
            }
        });
    }

    async start() {
        this.httpServer = http.createServer(async (req, res) => {
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
            const session = this.createSession(ip, cookies, res, req, pathname, { protocol: 'http', header: req.headers });
            const route = this.core.getRoute(pathname);
            const rootroute = this.core.getRoute('root');
            if (route && route.allowedMethods.includes(req.method ?? 'GET')) {
                const matched = await this.core.executeRoute(pathname, session, queryParams);
                if (!matched) {
                    this.serveStaticFile(pathname, res);
                } else {
                    let head = session.head;
                    head['Set-Cookie'] = Object.entries(session.newCookie).map(([k, v]) => `${k}=${v}`);
                    if (this.enableCors) {
                        head['Access-Control-Allow-Origin'] = '*';
                    }
                    res.writeHead(session.status ?? 200, head);
                    res.end(session.body)
                }
            } else if (rootroute && rootroute.allowedMethods.includes(req.method ?? 'GET')) {
                const matched = await this.core.executeRoute('root', session, queryParams);
                if (!matched) {
                    this.serveStaticFile(pathname, res);
                } else {
                    let head = session.head;
                    head['Set-Cookie'] = Object.entries(session.newCookie).map(([k, v]) => `${k}=${v}`);
                    if (this.enableCors) {
                        head['Access-Control-Allow-Origin'] = '*';
                    }
                    res.writeHead(session.status ?? 200, head);
                    res.end(session.body)
                }
            } else {
                this.serveStaticFile(pathname, res);
            }
        });

        this.httpServer.on('upgrade', async (req, socket, head) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;
            const queryParams = url.searchParams;
            const ip = this.getClientIP(req);
            const cookies = this.parseCookies(req);
            const session = this.createSession(ip, cookies, null, req, pathname, { protocol: 'http', header: req.headers });
            const route = this.core.getRoute(pathname);
            if (route && route.ws != null) {
                const matched = await this.core.executeRoute(pathname, session, queryParams);
                if (!matched) {
                    socket.write(
                        'HTTP/1.1 400 Bad Request\r\n' +
                        'Content-Type: text/plain\r\n' +
                        'Connection: close\r\n'
                    )
                    socket.destroy()
                } else {
                    route.ws.handleUpgrade(req, socket, head, (ws) => {
                        route.ws.emit('connection', ws, req, session);
                    })
                }
            } else {
                socket.write(
                    'HTTP/1.1 400 Bad Request\r\n' +
                    'Content-Type: text/plain\r\n' +
                    'Connection: close\r\n'
                )
                socket.destroy()
            }
        })

        this.httpServer.listen(this.port, this.host, () => {
            logger.info(`Server listening on ${this.host}:${this.port}`);
        });
    }

    stop() {
        if (this.httpServer) this.httpServer.close(() => logger.info('Server stopped'));
    }
}
