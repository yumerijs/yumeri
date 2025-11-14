import { Context, Config, Logger, ConfigSchema, Database } from 'yumeri';
import 'yumeri-plugin-user';
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
  getPermit(id: number): Promise<number>;
}

declare module 'yumeri' {
  interface Components {
    permission: Permit;
  }
}

export async function apply(ctx: Context, config: Config) {
  const db = ctx.component.database;

  // Use extend() to define the table schema. This is idempotent.
  await db.extend('permission', {
    id: { type: 'unsigned', nullable: false },
    permit: { type: 'unsigned', initial: config.get('defaultpermit', 1) }
  }, { primary: 'id' });

  ctx.registerComponent('permission', {
    async getPermit(id: number): Promise<number> {
      const result = await db.selectOne('permission', { id });
      if (result) {
        return result.permit;
      } else {
        // Although the table has a default, a record might not exist yet for a new user.
        // Creating it here ensures consistency.
        await db.create('permission', { 
          id, 
          permit: config.get('defaultpermit', 1) 
        });
        return config.get('defaultpermit', 1);
      }
    }
  } as Permit);
}
