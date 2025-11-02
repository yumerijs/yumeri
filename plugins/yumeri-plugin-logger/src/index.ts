import { Context, Config, Session, Logger, ConfigSchema, Route } from 'yumeri';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';

const logger = new Logger("logger");

export const depend = ['console'];

export const config = {} as Record<string, ConfigSchema>

interface OperateConsole {
  addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => void;
  removeconsoleitem: (name: string) => void;
  getloginstatus: (session: Session) => boolean;
}

let route: Route;

export async function apply(ctx: Context, config: Config) {
  const consoleApi: OperateConsole = ctx.getComponent('console');
  consoleApi.addconsoleitem('logger', 'fa-solid fa-file', '日志', path.join(__dirname, '../static/index.html'), path.join(__dirname, '../static'));
  const requireLogin = (session: Session) => {
    if (consoleApi.getloginstatus(session)) {
      return true
    } else {
      return false
    }
  };
  route = ctx.route('/api/logger')
    .action(async (session: Session) => {
      if (!requireLogin(session)) {
        session.status = 401;
        return
      }
      session.body = JSON.stringify(Logger.logs);
      session.setMime('json');
    })
    .wsOn('connection', (ws: WebSocket, req: any, session: Session) => {
      if (!requireLogin(session)) {
        ws.close();
      }
    })
  ctx.on('log', async (msg) => {
    route.ws.clients.forEach((ws) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
      }
    });
  })
}

export async function disable(ctx: Context) {
  const consoleApi: OperateConsole = ctx.getComponent('console');
  consoleApi.removeconsoleitem('logger');
  route.ws.close();
}