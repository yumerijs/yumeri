import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as path from 'path';
import fs from 'fs';
import { User } from 'yumeri-plugin-user'

const logger = new Logger("authority");

export const depend = ['server', 'user']; // 需要的服务
export const provide = ['authority']; // 提供的服务
export const usage = `用户登陆验证服务<br>依赖于yumeri-plugin-user（用户模型）`

export const config = {
  schema: {
    template: {
      type: 'object',
      properties: {
        loginpath: {
          type: 'string',
          default: '../static/login.html',
          description: '登录页模板地址'
        },
        regpath: {
          type: 'string',
          default: '../static/reg.html',
          description: '注册页模板地址'
        }
      },
      description: 'HTML模板配置'
    }
  } as Record<string, ConfigSchema>
};

export function resolvePath(inputPath: string, currentFileDirectory: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  } else {
    return path.resolve(currentFileDirectory, inputPath);
  }
}

export interface Authority {
  hooklogin(name: string, action: (param: Record<string, any>) => boolean): void
  delhooklogin(name: string): void
  hookregister(name: string, action: (param: Record<string, any>) => boolean): void
  delhookregister(name: string): void
  getLoginstatus(sessionid: string): boolean
  getUserinfo(sessionid: string): Promise<Record<string, any>> | false
}

export async function apply(ctx: Context, config: Config) {
  let hookslogin: Record<string, (param: Record<string, any>) => boolean> = {};
  let hooksregister: Record<string, (param: Record<string, any>) => boolean> = {};
  let logins: Record<string, number> = {};
  ctx.registerComponent('authority', {
    hooklogin(name: string, action: (param: Record<string, any>) => boolean) {
      hookslogin[name] = action;
    },
    delhooklogin(name: string) {
      delete hookslogin[name];
    },
    hookregister(name: string, action: (param: Record<string, any>) => boolean) {
      hooksregister[name] = action;
    },
    delhookregister(name: string) {
      delete hooksregister[name];
    },
    getLoginstatus(sessionid: string) {
      if (logins[sessionid]) {
        return true
      } else {
        return false
      }
    },
    async getUserinfo(sessionid: string) {
      if (logins[sessionid]) {
        return await user.getuserinfobyid(logins[sessionid])
      } else {
        return false
      }
    }
  } as Authority)
  const user = ctx.getComponent('user') as User;

  // HTML Pages
  ctx.route('/auth/login').action((session) => {
    const loginPath = resolvePath(config.get<string>('template.loginpath', '../static/login.html'), __dirname);
    if (fs.existsSync(loginPath)) {
      session.body = fs.readFileSync(loginPath, 'utf-8');
      session.setMime('html');
    }
  });

  ctx.route('/auth/register').action((session) => {
    const regPath = resolvePath(config.get<string>('template.regpath', '../static/reg.html'), __dirname);
    if (fs.existsSync(regPath)) {
      session.body = fs.readFileSync(regPath, 'utf-8');
      session.setMime('html');
    }
  });

  // Static Assets
  ctx.route('/auth/style.css').action((session) => {
    const stylePath = resolvePath('../static/style.css', __dirname);
    if (fs.existsSync(stylePath)) {
      session.body = fs.readFileSync(stylePath, 'utf-8');
      session.setMime('text/css');
    }
  });

  ctx.route('/auth/script.js').action((session) => {
    const scriptPath = resolvePath('../static/script.js', __dirname);
    if (fs.existsSync(scriptPath)) {
      session.body = fs.readFileSync(scriptPath, 'utf-8');
      session.setMime('text/javascript');
    }
  });

  // API routes
  ctx.route('/auth/api/login').action(async (session, params) => {
    const username = params.get('username');
    const password = params.get('password');
    
    let fine = true;
    const paramObj = Object.fromEntries(params.entries());
    for (const hook in hookslogin) {
      if (!hookslogin[hook](paramObj)) {
        fine = false;
        session.body = JSON.stringify({ code: 1, message: '登录失败' });
        break;
      }
    }

    if (fine && username && password) {
      const result = await user.login(username, password);
      if (!result) {
        session.body = JSON.stringify({ code: 1, message: '用户名或密码错误' });
        return;
      }
      const userInfo = await user.getuserinfo(username);
      if (userInfo) {
        logins[session.sessionid] = userInfo.id;
      }
      session.body = JSON.stringify({ code: 0, message: '登录成功' });
    } else if (fine) {
        session.body = JSON.stringify({ code: 1, message: '缺少用户名或密码' });
    }
  });

  ctx.route('/auth/api/register').action(async (session, params) => {
    const username = params.get('username');
    const password = params.get('password');

    let fine = true;
    const paramObj = Object.fromEntries(params.entries());
    for (const hook in hooksregister) {
      if (!hooksregister[hook](paramObj)) {
        fine = false;
        session.body = JSON.stringify({ code: 1, message: '注册失败' });
        break;
      }
    }

    if (fine && username && password) {
      const result = await user.register(username, password);
      if (!result) {
        session.body = JSON.stringify({ code: 1, message: '注册失败' });
        return;
      }
      session.body = JSON.stringify({ code: 0, message: '注册成功' });
    } else if (fine) {
        session.body = JSON.stringify({ code: 1, message: '缺少用户名或密码' });
    }
  });
}
