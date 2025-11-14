import { Context, Config, Logger, ConfigSchema, Database } from 'yumeri'
import * as crypto from 'crypto'

const logger = new Logger('user')

export const depend = ['database']
export const provide = ['user']
export const usage = '提供 Yumeri 用户模型'

interface UserTable {
  id: number
  username: string
  password: string
  email?: string | null
  phone?: string | null
  createAt: Date
  updateAt: Date
}

declare module 'yumeri' {
  interface Tables {
    user: UserTable
  }
  interface Components {
    user: User
  }
}

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
}

export class User {
  private tableName: string

  constructor(private db: Database, private config: Config) {
    this.tableName = this.config.get('name', 'user')
  }

  private hashPassword(password: string): string {
    const encryptType = this.config.get<string>('encryptType', 'md5')
    return crypto.createHash(encryptType).update(password).digest('hex')
  }

  async getuserinfo(username: string) {
    return this.db.selectOne('user', { username }, ['id', 'username', 'email', 'phone', 'createAt', 'updateAt'])
  }

  async getuserinfobyid(id: number) {
    return this.db.selectOne('user', { id }, ['id', 'username', 'email', 'phone', 'createAt', 'updateAt'])
  }

  async updateuserinfo(id: number, data: Partial<UserTable>) {
    return this.db.update('user', { id }, data)
  }

  async changepassword(username: string, password: string) {
    const hashedPassword = this.hashPassword(password)
    return this.db.update('user', { username }, { password: hashedPassword })
  }

  async register(username: string, password: string, email?: string, phone?: string) {
    const hashedPassword = this.hashPassword(password)
    const data: Partial<UserTable> = {
      username,
      password: hashedPassword,
      email: this.config.get('isEmailopen') ? email ?? null : null,
      phone: this.config.get('isPhoneopen') ? phone ?? null : null,
      createAt: new Date(),
      updateAt: new Date()
    }
    try {
      const result = this.db.create('user', data)
      return result
    } catch (error) {
      return false
    }
  }

  async login(username: string, password: string): Promise<boolean> {
    const hashedPassword = this.hashPassword(password)
    const result = await this.db.selectOne('user', { username, password: hashedPassword })
    return !!result
  }
}

export async function apply(ctx: Context, config: Config) {
  const db = ctx.component.database;

  const schema: Record<string, any> = {
    id: { type: 'unsigned', autoIncrement: true },
    username: 'string',
    password: 'string',
    createAt: 'date',
    updateAt: 'date'
  }

  if (config.get('isEmailopen')) schema.email = 'string'
  if (config.get('isPhoneopen')) schema.phone = 'string'

  db.extend('user', schema, {
    primary: 'id',
    autoInc: true,
    unique: ['username']
  })

  ctx.registerComponent('user', new User(db, config))
  logger.info('User model loaded')
}