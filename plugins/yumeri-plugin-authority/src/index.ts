import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as path from 'path';
import fs from 'fs';
import 'yumeri-plugin-user'

const logger = new Logger("authority");

export const depend = ['user']; // 需要的服务
export const provide = ['authority']; // 提供的服务
export const usage = `用户登陆验证服务<br>依赖于yumeri-plugin-user（用户模型）`

declare module 'yumeri' {
  interface Components {
    authority: Authority;
  }
}

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

async function getHook(ctx: Context, hookname: string, originString: string) {
  const result: string[] = await ctx.executeHook(hookname);
  let item = '';
  if (result) {
    result.forEach((items) => {
      item = item + items;
    })
  }
  const newString = originString.replace(`{{${hookname}}}`, item);
  return newString;
}
 
export interface Authority {
  getLoginstatus(sessionid: string): boolean
  getUserinfo(sessionid: string): Promise<Record<string, any>> | false
}

export async function apply(ctx: Context, config: Config) {
  let logins: Record<string, number> = {};
  ctx.registerComponent('authority', {
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
  const user = ctx.component.user;

  // HTML Pages
  ctx.route('/auth/login').action(async (session) => {
    const loginPath = resolvePath(config.get<string>('template.loginpath', '../static/login.html'), __dirname);
    if (!fs.existsSync(loginPath)) return;

    let html = fs.readFileSync(loginPath, 'utf-8');

    // 登录页 HTML hook 点位
    const loginHooks = [
      'authority:htmlheader',   // header 外部
      'authority:preloginform',  // form 前
      'authority:loginform',     // form 内
      'authority:postloginform', // form 后
      'authority:htmlfooter',    // footer 外部
    ];

    for (const hook of loginHooks) {
      html = await getHook(ctx, hook, html);
    }

    session.body = html;
    session.setMime('html');
  });

  ctx.route('/auth/register').action(async (session) => {
    const regPath = resolvePath(config.get<string>('template.regpath', '../static/reg.html'), __dirname);
    if (!fs.existsSync(regPath)) return;

    let html = fs.readFileSync(regPath, 'utf-8');

    // 注册页 HTML hook 点位
    const registerHooks = [
      'authority:htmlheader',      // header 外部
      'authority:preregisterform',  // form 前
      'authority:registerform',     // form 内
      'authority:postregisterform', // form 后
      'authority:htmlfooter',       // footer 外部
    ];

    for (const hook of registerHooks) {
      html = await getHook(ctx, hook, html);
    }

    session.body = html;
    session.setMime('html');
  });

  // Static Assets
  ctx.route('/auth/style.css').action(async (session) => {
    const stylePath = resolvePath('../static/style.css', __dirname);
    if (fs.existsSync(stylePath)) {
      session.body = await getHook(ctx, 'authority:css', fs.readFileSync(stylePath, 'utf-8'));
      session.setMime('text/css');
    }
  });

  ctx.route('/auth/script.js').action(async (session) => {
    const scriptPath = resolvePath('../static/script.js', __dirname);
    if (fs.existsSync(scriptPath)) {
      session.body = await getHook(ctx, 'authority:js', fs.readFileSync(scriptPath, 'utf-8'));
      session.setMime('text/javascript');
    }
  });

  // API routes
  ctx.route('/auth/api/login').action(async (session, params) => {
    const body = await session.parseRequestBody();
    const username = body.username as string;
    const password = body.password as string;

    let fine = true;
    const paramObj = Object.fromEntries(params.entries());
    const result: boolean[] = await ctx.executeHook('authority:login', paramObj)
    result.forEach((r) => {
      if (!r) {
        fine = false;
      }
    })

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
    const body = await session.parseRequestBody();
    const username = body.username as string;
    const password = body.password as string;

    let fine = true;
    const paramObj = Object.fromEntries(params.entries());
    const result: boolean[] = await ctx.executeHook('authority:register', paramObj)
    result.forEach((r) => {
      if (!r) {
        fine = false;
      }
    })

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
