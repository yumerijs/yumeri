import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { Database } from '@yumerijs/types'
const logger = new Logger("user");

export const depend = ['database'];
export const provide = ['user'];
export const usage = '用户模型插件'

export const config = {
  schema: {
    name: {
      type: 'string',
      default: 'user',
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
class User {
  constructor(private database: Database, private config: Config) {}
}
export async function apply(ctx: Context, config: Config) {
  const database: Database = ctx.getComponent('database');
  if(!await database.tableExists(config.get<string>('name', 'user'))) {
    await database.createTable(config.get<string>('name', 'user'), {
      id: { type: 'INT', autoIncrement: true, primaryKey: true },
      username: { type: 'VARCHAR', length: 20, unique: true },
      password: { type: 'VARCHAR', length: 40 },
      email: { type: 'VARCHAR', length: 255, unique: true },
      phone: { type: 'VARCHAR', length: 16, unique: true },
      createAt: { type: 'DATETIME', default: 'CURRENT_TIMESTAMP_FUNC' },
      updateAt: { type: 'DATETIME', default: 'CURRENT_TIMESTAMP_FUNC' },
    });
  }
  const user = new User(database, config);
  ctx.registerComponent('user', user);
  logger.info('User model loaded');
}