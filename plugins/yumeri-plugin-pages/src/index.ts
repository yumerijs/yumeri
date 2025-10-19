import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import { Database } from '@yumerijs/types';

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

declare module '@yumerijs/types' {
  interface Tables {
    pages: Pages;
    pagesmeta: Pagesmeta;
  }
}

export const config = {} as Record<string, ConfigSchema>

export class PagesComponent {
  constructor(private db: Database) {}
  async get(condition: Record<string, any>) {
    const page = await this.db.select('pages', condition);
    if (!page) {
      return null;
    }
    return page;
  }
  async getType(id: number) {
    const page = await this.db.selectOne('pages', { id });
    if (!page) {
      return null;
    }
    return page.type;
  }
  async getMetadatas(id: number) {
    const meta = await this.db.select('pagesmeta', { page_id: id });
    if (!meta) {
      return null;
    }
    return meta;
  }
  async selectMetadata(id: number, key: string) {
    const meta = await this.db.selectOne('pagesmeta', { page_id: id, meta_key: key });
    if (!meta) {
      return null;
    }
    return meta;
  }
  async insert(page: Pages) {
    const id = await this.db.create('pages', page);
    return id;
  }
  async update(id: number, page: Pages) {
    const result = await this.db.update('pages', { id }, page);
    return result;
  }
  async getTypes() {
    const types = await this.db.select('pages', {});
    if (!types) {
      return null;
    }
    return types.map((page) => page.type);
  }
}

export async function apply(ctx: Context, config: Config) {
  const db = ctx.getComponent('database') as Database;
  db.extend('pages', {
    id: 'unsigned',
    name: 'string',
    description: 'string',
    type: 'string',
    content: 'text',
    created_at: 'date',
    updated_at: 'date',
    author_id: 'unsigned',
    status: 'string',
    comment_status: 'string',
  }, {
    primary: 'id'
  }
  );
  db.extend('pagesmeta', {
    id: 'unsigned',
    page_id: 'unsigned',
    meta_key: 'string',
    meta_value: 'string',
  }, {
    primary: 'id'
  }
  );
  ctx.registerComponent('pages', new PagesComponent(db));
}