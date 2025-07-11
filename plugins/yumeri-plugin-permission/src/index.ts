import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import * as path from 'path';
import fs from 'fs';
import { User } from 'yumeri-plugin-user'
import { Database } from '@yumerijs/types/dist/database'

const logger = new Logger("permission");

export const depend = ['database', 'user']; // 需要的服务
export const usage = `用户权限模型<br>依赖于yumeri-plugin-user（用户模型）<br>超管权限大小为10`

export const config = {
  schema: {
    defaultpermit: {
      type: 'number',
      default: 1,
      description: '默认权限',
      required: true
    }
  } as Record<string, ConfigSchema>
};

export interface Permit {
  getPermit(username: string): Promise<number>
}

export async function apply(ctx: Context, config: Config) {
  const user = ctx.getComponent('user') as User
  const db = ctx.getComponent('database') as Database
  if (!await db.tableExists('permission')) {
    await db.createTable('permission', {
      username: { type: 'string', primaryKey: true },
      permit: { type: 'number', default: config.get<number>('defaultpermit') }
    })
  }
  ctx.registerComponent('permission', {
    async getPermit(username: string) {
      const result = await db.findOne('permission', { username })
      if (result) {
        return result.permit
      } else {
        return config.get<number>('defaultpermit')
      }
    }
  } as Permit)
}