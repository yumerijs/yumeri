import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("user");

export const depend = ['database'];
export const provide = ['user'];
export const usage = '用户模型插件'

export const config = {
  schema: {
    path: {
      type: 'string',
      default: 'table',
      description: '用户数据表名'
    },
    isEmailopen: {
      type: 'boolean',
      default: true,
      description: '是否开启邮箱字段'
    },
    isPhoneopen: {
      type: 'boolean',
      default: true,
      description: '是否开启手机号字段'
    },
    encryptType: {
      type: 'string',
      default: 'md5',
      enum: ['md5', 'sha1', 'sha256', 'sha512'],
      description: '密码加密方式'
    }
  } as Record<string, ConfigSchema>
};
export async function apply(ctx: Context, config: Config) {

  logger.info('User model loaded');
}