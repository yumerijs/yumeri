
import { Context, Config, Logger, ConfigSchema, Database, Schema } from 'yumeri';
import * as crypto from 'crypto';
import './types'; // Import for declaration merging

const logger = new Logger("user");

export const depend = ['database'];
export const provide = ['user'];
export const usage = '用户模型插件';

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

// The fields to select when fetching user info to avoid exposing the password.
const USER_INFO_FIELDS = ['id', 'username', 'email', 'phone', 'createAt', 'updateAt'] as const;

export class User {
  private tableName: 'user'; // Use literal type for type safety

  constructor(private database: Database, private config: Config) {
    this.tableName = this.config.get('name', 'user');
  }

  private hashPassword(password: string): string {
    const encryptType = this.config.get<string>('encryptType', 'md5');
    return crypto.createHash(encryptType).update(password).digest('hex');
  }

  async getuserinfo(username: string) {
    return this.database.selectOne(this.tableName, { username }, [...USER_INFO_FIELDS]);
  }

  async getuserinfobyid(id: number) {
    return this.database.selectOne(this.tableName, { id }, [...USER_INFO_FIELDS]);
  }

  async updateuserinfo(id: number, data: Partial<import('./types').User>): Promise<number> {
    return this.database.update(this.tableName, { id }, data);
  }

  async changepassword(username: string, password: string): Promise<number> {
    const hashedPassword = this.hashPassword(password);
    return this.database.update(this.tableName, { username }, { password: hashedPassword });
  }

  async register(username: string, password: string, email?: string, phone?: string): Promise<import('./types').User> {
    const hashedPassword = this.hashPassword(password);
    const insertData: Partial<import('./types').User> = {
      username,
      password: hashedPassword,
    };
    if (this.config.get('isEmailopen')) insertData.email = email ?? null;
    if (this.config.get('isPhoneopen')) insertData.phone = phone ?? null;

    return this.database.create(this.tableName, insertData);
  }

  async login(username: string, password: string): Promise<boolean> {
    const hashedPassword = this.hashPassword(password);
    const result = await this.database.selectOne(this.tableName, { username, password: hashedPassword });
    return !!result;
  }
}

export async function apply(ctx: Context, config: Config) {
  const database = ctx.getComponent<Database>('database');
  const tableName = config.get('name', 'user');

  // Dynamically build the schema based on config
  const schema: Schema<import('./types').User> = {
    id: { type: 'integer', nullable: false },
    username: { type: 'string', length: 255 },
    password: { type: 'string', length: 128 },
    createAt: 'timestamp',
    updateAt: 'timestamp',
  };

  if (config.get('isEmailopen')) {
    schema.email = { type: 'string', length: 255, nullable: true };
  }
  if (config.get('isPhoneopen')) {
    schema.phone = { type: 'string', length: 255, nullable: true };
  }

  // Extend the database
  await database.extend(tableName as 'user', schema, {
    primary: 'id',
    autoInc: true,
    unique: ['username', 'email', 'phone'],
  });

  const user = new User(database, config);
  ctx.registerComponent('user', user);
  logger.info('User model loaded');
}
