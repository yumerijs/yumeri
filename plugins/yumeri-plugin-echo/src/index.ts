import { Context, Session, Logger, Schema } from 'yumeri';

const logger = new Logger("echo");

export const usage = `用于测试的简单输出服务，可配置多个字符串进行串联`

interface ContentObject {
  content: string[];
  join: string;
}

export interface EchoConfig {
  path: string;
  content: ContentObject;
  type: 'html' | 'json' | 'text' | 'file';
  filepath: string;
  isstream: boolean;
}

export const config: Schema<EchoConfig> = Schema.object({
  path: Schema.string('监听路径（命令）').default('echo'),
  content: Schema.object({
    content: Schema.array(Schema.string(), '输出内容').default([]),
    join: Schema.string('输出内容连接符').default('\n'),
  }, '输出内容定义').default({ content: ['Hello World'], join: '\n' }),
  type: Schema.enum(['html', 'json', 'text', 'file'], '输出类型').default('html'),
  filepath: Schema.string('输出文件路径(绝对路径)').default(''),
  isstream: Schema.boolean('是否流式输出文件').default(false),
});
export async function apply(ctx: Context, config: EchoConfig) {
  const routePath = `/${config.path}`;
  ctx.route(routePath)
    .action((session: Session) => {
      if (config.type !== 'file') {
        session.setMime(config.type);
        session.response(config.content.content?.join(config.content.join), 'plain');
      } else {
        session.sendFile(config.filepath, config.isstream);
      }
    });
  logger.info(`Echo plugin loaded at route: ${routePath}`);
}
