import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as path from 'path';
import fs from 'fs';

const logger = new Logger("authority");

export const depend = ['server']; // 需要的服务
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
export async function apply(ctx: Context, config: Config) {
  // 注册Echo命令
  ctx.command('auth')
    .action(async (session: Session, param?: any) => {
      if (param.path === '/login') {
        if (fs.existsSync(resolvePath(config.get<string>('template.loginpath', '../static/login.html'), __dirname))){
          const content = fs.readFileSync(resolvePath(config.get<string>('template.loginpath', '../static/login.html'), __dirname), 'utf-8');
          session.body = content;
          session.setMime('html')
        }
      } else if (param.path === '/register') {
        if (fs.existsSync(resolvePath(config.get<string>('template.regpath', '../static/reg.html'), __dirname))){
          const content = fs.readFileSync(resolvePath(config.get<string>('template.regpath', '../static/reg.html'), __dirname), 'utf-8');
          session.setMime('html')
          session.body = content;
        }
      } else if( param.path === '/style.css') {
        if (fs.existsSync(resolvePath('../static/style.css', __dirname))){
          const content = fs.readFileSync(resolvePath('../static/style.css', __dirname), 'utf-8');
          session.body = content;
        }
      } else if (param.path === '/script.js') {
        if (fs.existsSync(resolvePath('../static/script.js', __dirname))){
          const content = fs.readFileSync(resolvePath('../static/script.js', __dirname), 'utf-8');
          session.body = content;
        }
      }
    });
}