import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';

const logger = new Logger("logger");

export const config = {} as Record<string, ConfigSchema>

interface OperateConsole {
  addconsoleitem: (name: string, icon: string, displayname: string, htmlpath: string, staticpath: string) => void;
  removeconsoleitem: (name: string) => void;
  getloginstatus: (session: Session) => boolean;
}

export async function apply(ctx: Context, config: Config) {
  const wsclients: WebSocket[] = [];
  const consoleApi: OperateConsole = ctx.getComponent('console');
  consoleApi.addconsoleitem('logger', 'fa-solid fa-file', '日志', path.join(__dirname, '../static/index.html'), path.join(__dirname, '../static'));
  const requireLogin = (session: Session) => {
    if (consoleApi.getloginstatus(session)) {
      return true
    } else {
      return false
    }
  };
  ctx.route('/api/logger')
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
      wsclients.push(ws);
    })
  ctx.on('log', async (msg) => {
    wsclients.forEach((ws) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        wsclients.splice(wsclients.indexOf(ws), 1);
      }
    });
  })
}