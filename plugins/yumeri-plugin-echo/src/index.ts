import { Context, Session, Logger, Schema } from 'yumeri';
import { Plugin, Get, Host } from '@yumerijs/decorator';

const logger = new Logger("echo");

export const usage = `用于测试的简单输出服务，可配置多个字符串进行串联`

interface ContentObject {
  content: string[];
  join: string;
}

export interface EchoConfig {
  path: string;
  host: string;
  content: ContentObject;
  type: 'html' | 'json' | 'text' | 'file';
  filepath: string;
  isstream: boolean;
}

export const config: Schema<EchoConfig> = Schema.object({
  path: Schema.string('监听路径').key('echo.config.path').default('echo'),
  host: Schema.string('监听地址').key('echo.config.host').default(''),
  content: Schema.object({
    content: Schema.array(Schema.string(), '输出内容').key('echo.config.content.content').default([]),
    join: Schema.string('输出内容连接符').key('echo.config.content.join').default('\n'),
  }, '输出内容定义').key('echo.config.content').default({ content: ['Hello World'], join: '\n' }),
  type: Schema.enum(['html', 'json', 'text', 'file'], '输出类型').key('echo.config.type').default('html'),
  filepath: Schema.string('输出文件路径(绝对路径)').key('echo.config.filepath').default(''),
  isstream: Schema.boolean('是否流式输出文件').key('echo.config.isstream').default(false),
});

/** 插件配置项说明的翻译表 */
const configI18n = {
  'echo.config.path': { zh: '监听路径', en: 'Listening path' },
  'echo.config.host': { zh: '监听地址', en: 'Listening host' },
  'echo.config.content': { zh: '输出内容定义', en: 'Output content definition' },
  'echo.config.content.content': { zh: '输出内容', en: 'Output content' },
  'echo.config.content.join': { zh: '输出内容连接符', en: 'Output content separator' },
  'echo.config.type': { zh: '输出类型', en: 'Output type' },
  'echo.config.filepath': { zh: '输出文件路径(绝对路径)', en: 'Output file path (absolute)' },
  'echo.config.isstream': { zh: '是否流式输出文件', en: 'Stream the output file' },
};

@Plugin
export default class EchoPlugin {
  private config: EchoConfig;

  constructor(ctx: Context, config: EchoConfig) {
    this.config = config;
    ctx.i18n(configI18n);
    logger.info(`Echo plugin loaded at route: /${config.path}`);
  }

  @Get((plugin: EchoPlugin) => `/${plugin.config.path}`)
  @Host((plugin: EchoPlugin) => plugin.config.host || undefined)
  async echo(session: Session) {
    if (this.config.type !== 'file') {
      session.setMime(this.config.type);
      session.respond(this.config.content.content?.join(this.config.content.join), 'plain');
      return;
    }

    session.sendFile(this.config.filepath, this.config.isstream);
  }
}
