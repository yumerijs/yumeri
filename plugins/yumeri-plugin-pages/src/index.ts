import { Context, Config, Session, Logger, ConfigSchema, Database } from 'yumeri';

const logger = new Logger("pages");

export const depend = ['database', 'user']
export const provide = ['pages']
export const usage = '提供 Yumeri 文章模型'

interface Pages {
  id: number;
  name: string;
  description?: string;
  type: string;
  content: string;
  created_at: Date;
  updated_at: Date;
  author_id: number;
  status: string;
  comment_status: string;
}
 
interface Pagesmeta {
  id: number;
  page_id: number;
  meta_key: string;
  meta_value: string;
}

declare module 'yumeri' {
  interface Tables {
    pages: Pages;
    pagesmeta: Pagesmeta;
  }
  interface Components {
    pages: PagesComponent;
  }
}

export const config = {} as Record<string, ConfigSchema>

export class PagesComponent {
  constructor(private db: Database) {}

  async get(condition: Partial<Pages>) {
    const page = await this.db.select('pages', condition);
    return page || null;
  }

  async getType(id: number) {
    const page = await this.db.selectOne('pages', { id });
    return page ? page.type : null;
  }

  async getMetadatas(id: number) {
    const meta = await this.db.select('pagesmeta', { page_id: id });
    return meta || null;
  }

  async selectMetadata(id: number, key: string) {
    const meta = await this.db.selectOne('pagesmeta', { page_id: id, meta_key: key });
    return meta || null;
  }

  async insert(page: Partial<Pages>) {
    const now = new Date();

    // 自动补时间字段
    const data: Partial<Pages> = {
      created_at: now,
      updated_at: now,
      status: 'published', 
      comment_status: 'open',
      ...page,
    };

    const id = await this.db.create('pages', data);
    return id;
  }

  async update(id: number, page: Partial<Pages>) {
    const now = new Date();
    const data: Partial<Pages> = {
      ...page,
      updated_at: now, // 自动更新时间
    };
    const result = await this.db.update('pages', { id }, data);
    return result;
  }

  async getTypes() {
    const types = await this.db.select('pages', {});
    return types ? types.map((page) => page.type) : null;
  }
}

export async function apply(ctx: Context, config: Config) {
  const db = ctx.component.database;
  db.extend(
    'pages',
    {
      id: { type: 'unsigned', autoIncrement: true },
      name: 'string',
      description: 'string',
      type: 'string',
      content: 'text',
      created_at: 'date',
      updated_at: 'date',
      author_id: 'unsigned',
      status: 'string',
      comment_status: 'string',
    },
    {
      primary: 'id',
      autoInc: true,
    }
  );

  db.extend(
    'pagesmeta',
    {
      id: 'unsigned',
      page_id: 'unsigned',
      meta_key: 'string',
      meta_value: 'string',
    },
    {
      primary: 'id',
      autoInc: true,
    }
  );

  ctx.registerComponent('pages', new PagesComponent(db));
}