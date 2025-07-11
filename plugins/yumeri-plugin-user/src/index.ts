import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { Database } from '@yumerijs/types/dist/database'
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
export class User {
  constructor(private database: Database, private config: Config) {}
  async getuserinfo(username: string): Promise<Record<string, any> | null>{
    const result = this.database.findOne(this.config.get<string>('name', 'user'), { username });
    return result;
  }
  async getuserinfobyid(id: number): Promise<Record<string, any> | null>{
    const result = this.database.findOne(this.config.get<string>('name', 'user'), { id });
    return result;
  }
  async updateuserinfo(id: number, data: Record<string, any>): Promise<number> {
    const result = await this.database.update(this.config.get<string>('name', 'user'), data, { id });
    return result;
  }
  async changepassword(username: string, password: string): Promise<number> {
    const result = await this.database.update(this.config.get<string>('name', 'user'), { password }, { username });
    return result;
  }
  async register(username: string, password: string, email?: string, phone?: string): Promise<number> {
    const encryptType = this.config.get<string>('encryptType', 'md5');
    if (encryptType === 'md5') {
      password = require('crypto').createHash('md5').update(password).digest('hex');
    } else if (encryptType === 'sha1') {
      password = require('crypto').createHash('sha1').update(password).digest('hex');
    } else if (encryptType === 'sha256') {
      password = require('crypto').createHash('sha256').update(password).digest('hex');
    } else if (encryptType === 'sha512') {
      password = require('crypto').createHash('sha512').update(password).digest('hex');
    }
    const insertData = {
      username,
      password,
      email: email ?? null,
      phone: phone ?? null,
    };
    const result = await this.database.insert(this.config.get<string>('name', 'user'), insertData);
    return result;
  }
  async login(username: string, password: string): Promise<boolean> {
    // 要根据加密模式进行加密
    const encryptType = this.config.get<string>('encryptType', 'md5');
    if (encryptType === 'md5') {
      password = require('crypto').createHash('md5').update(password).digest('hex');
    } else if (encryptType === 'sha1') {
      password = require('crypto').createHash('sha1').update(password).digest('hex');
    } else if (encryptType === 'sha256') {
      password = require('crypto').createHash('sha256').update(password).digest('hex');
    } else if (encryptType === 'sha512') {
      password = require('crypto').createHash('sha512').update(password).digest('hex');
    }
    const result = await this.database.findOne(this.config.get<string>('name', 'user'), { username, password });
    if (result) {
      return true;
    } else {
      return false;
    }
  }
}
export async function apply(ctx: Context, config: Config) {
  const database: Database = ctx.getComponent('database');
  if(!await database.tableExists(config.get<string>('name', 'user'))) {
    await database.createTable(config.get<string>('name', 'user'), {
      id: { type: 'INTEGER', autoIncrement: true, primaryKey: true },
      username: { type: 'VARCHAR', length: 20, unique: true },
      password: { type: 'VARCHAR', length: 128 },
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