import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("echo");

export const depend = ['server']; // 需要的服务
export const usage = `用于测试的简单输出服务，可配置多个字符串进行串联`

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
  type: string;
}
interface contentobject {
  content: string[];
  join: string;
}

export const config = {
  schema: {
    path: {
      type: 'string',
      default: 'echo',
      description: '监听路径（命令）'
    },
    content: {
      type: 'object',
      default: { content: ['Hello World'], join: '\n'},
      properties: {
        content: {
          type: 'array',
          default: [],
          description: '输出内容'
      },
      join: {
        type: 'string',
        default: '\n',
        description: '输出内容连接符'
      }
    },
      description: '输出内容定义'
    },
    type: {
      type: 'string',
      default: 'html',
      description: '输出类型',
      enum: ['html', 'json', 'text']
    }
  } as Record<string, ConfigSchema>
};
export async function apply(ctx: Context, config: Config) {
  // 注册Echo命令
  ctx.command(config.get<string>('path', 'echo'))
    .action(async (session: Session, param?: any) => {
      session.setMime(config.get<string>('type', 'html')); // 默认设置为 HTML 类型
      session.body = config.get<contentobject>('content').content?.join(config.get<contentobject>('content').join);
    });
  logger.info('Echo plugin loaded');
}