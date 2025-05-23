import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("echo");

export const depend = ['server']; // 需要的服务

/**
 * 控制台插件配置接口
 */
export interface EchoConfig {
  /**
   * 监听路径（命令）
   * @default "echo"
   */
  path: string;
  
  /**
   * 输出内容
   * @default "Hello World"
   */
  content: string;
}

/**
 * 控制台插件配置schema
 */
export const config = {
  schema: {
    path: {
      type: 'string',
      default: 'echo',
      description: '监听路径（命令）'
    },
    content: {
      type: 'string',
      default: 'Hello World',
      description: '输出内容'
    }
  } as Record<string, ConfigSchema>
};
export async function apply(ctx: Context, config: Config) {
  // 注册Echo命令
  ctx.command(config.get<string>('path', 'echo'))
    .action(async (session: Session, param?: any) => {
      session.setMime('html'); // 默认设置为 HTML 类型
      session.body = config.get<string>('content', 'Hello World');
    });
  logger.info('Echo plugin loaded');
}