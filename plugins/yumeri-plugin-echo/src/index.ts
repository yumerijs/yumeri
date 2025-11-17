import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("echo");

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
      default: { content: ['Hello World'], join: '\n' },
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
      enum: ['html', 'json', 'text', 'file']
    },
    filepath: {
      type: 'string',
      default: '',
      description: '输出文件路径(绝对路径)'
    },
    isstream: {
      type: 'boolean',
      default: false,
      description: '是否流式输出文件'
    }
  } as Record<string, ConfigSchema>
};
export async function apply(ctx: Context, config: Config) {
  const routePath = `/${config.get<string>('path', 'echo')}`;
  ctx.route(routePath)
    .action((session: Session) => {
      if (config.get<string>('type') !== 'file') {
        session.setMime(config.get<string>('type', 'html'));
        const contentConfig = config.get<contentobject>('content');
        session.response(contentConfig.content?.join(contentConfig.join), 'plain');
      } else {
        session.sendFile(config.get<string>('filepath'), config.get<boolean>('isstream'));
      }
    });
  logger.info(`Echo plugin loaded at route: ${routePath}`);
}
