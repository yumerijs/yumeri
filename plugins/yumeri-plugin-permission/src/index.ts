import { Database } from '@yumerijs/types';
import { Context, Config, Logger, ConfigSchema } from 'yumeri';
import { User } from 'yumeri-plugin-user';
import './types'; // Import for declaration merging

const logger = new Logger("permission");

export const depend = ['database', 'user'];
export const usage = `用户权限模型<br>依赖于yumeri-plugin-user（用户模型）<br>超管权限大小为10`;
export const provide = ['permission'];

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
  getPermit(username: string): Promise<number>;
}

export async function apply(ctx: Context, config: Config) {
  const db = ctx.getComponent('database') as Database;

  // Use extend() to define the table schema. This is idempotent.
  await db.extend('permission', {
    username: { type: 'string', nullable: false },
    permit: { type: 'unsigned', initial: config.get('defaultpermit', 1) }
  }, { primary: 'username' });

  ctx.registerComponent('permission', {
    async getPermit(username: string): Promise<number> {
      const result = await db.selectOne('permission', { username });
      if (result) {
        return result.permit;
      } else {
        // Although the table has a default, a record might not exist yet for a new user.
        // Creating it here ensures consistency.
        await db.create('permission', { 
          username, 
          permit: config.get('defaultpermit', 1) 
        });
        return config.get('defaultpermit', 1);
      }
    }
  } as Permit);
}
