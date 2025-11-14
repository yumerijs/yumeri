import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import 'yumeri-plugin-user';
import 'yumeri-plugin-authority';
import 'yumeri-plugin-pages';
import 'yumeri-plugin-permission';
import path from 'path';
import fs from 'fs';

const logger = new Logger("author-center");

export const depend = ['user', 'authority', 'pages', 'permission'];

export const config = {
  schema: {
    content: {
      type: 'array',
      default: ['post'],
      description: '可发布的文章类型'
    },
    permit: {
      type: 'number',
      default: 2,
      description: '发布文章的权限'
    }
  } as Record<string, ConfigSchema>
};

export async function apply(ctx: Context, config: Config) {
  const user = ctx.component.user;
  const authority = ctx.component.authority;
  const pages = ctx.component.pages;
  const permit = ctx.component.permission;

  // 包装身份验证
  const requireLogin = (
    handler: (session: Session, params: URLSearchParams) => Promise<void>
  ) => {
    return async (session: Session, params: URLSearchParams) => {
      if (authority.getLoginstatus(session.sessionid)) {
        const userid = ((await authority.getUserinfo(session.sessionid)) as any).id;
        if (await permit.getPermit(userid) >= config.get<number>('permit')) {
          await handler(session, params);
        } else {
          session.setMime('json');
          session.body = JSON.stringify({ success: false, message: '权限不足' });
        }
      } else {
        session.setMime('json');
        session.body = JSON.stringify({ success: false, message: '请先登录' });
      }
    };
  };

  // 定义 API 路由
  const routes: Record<string, (session: Session, params: URLSearchParams) => Promise<void>> = {
    '/list': async (session, params) => {
      const allPages = await pages.get({});
      session.setMime('json');
      session.body = JSON.stringify({ success: true, data: allPages || [] });
    },
    '/get': async (session, params) => {
      const id = Number(params.get('id'));
      session.setMime('json');
      if (!id) {
        session.body = JSON.stringify({ success: false, message: '缺少id' });
        return;
      }
      const page = await pages.get({ id });
      session.body = JSON.stringify(page ? { success: true, data: page } : { success: false, message: '未找到页面' });
    },
    '/insert': async (session, params) => {
      const name = params.get('name') || '';
      const type = params.get('type') || 'post';
      const content = params.get('content') || '';
      const author_id = Number(params.get('author_id') || 0);
      session.setMime('json');
      if (!name || !author_id) {
        session.body = JSON.stringify({ success: false, message: '缺少参数' });
        return;
      }
      const id = await pages.insert({ name, type, content, author_id });
      session.body = JSON.stringify({ success: true, id });
    },
    '/update': async (session, params) => {
      const id = Number(params.get('id'));
      session.setMime('json');
      if (!id) {
        session.body = JSON.stringify({ success: false, message: '缺少id' });
        return;
      }
      const data: any = {};
      if (params.get('name')) data.name = params.get('name');
      if (params.get('type')) data.type = params.get('type');
      if (params.get('content')) data.content = params.get('content');
      if (params.get('status')) data.status = params.get('status');
      if (params.get('comment_status')) data.comment_status = params.get('comment_status');
      const result = await pages.update(id, data);
      session.body = JSON.stringify({ success: true, updated: result });
    },
    '/types': async (session, params) => {
      const types = await pages.getTypes();
      session.setMime('json');
      session.body = JSON.stringify({ success: true, data: types || [] });
    },
    '/metadata/list': async (session, params) => {
      const id = Number(params.get('page_id'));
      session.setMime('json');
      if (!id) {
        session.body = JSON.stringify({ success: false, message: '缺少 page_id' });
        return;
      }
      const meta = await pages.getMetadatas(id);
      session.body = JSON.stringify({ success: true, data: meta || [] });
    },
    '/metadata/get': async (session, params) => {
      const id = Number(params.get('page_id'));
      const key = params.get('key');
      session.setMime('json');
      if (!id || !key) {
        session.body = JSON.stringify({ success: false, message: '缺少参数' });
        return;
      }
      const meta = await pages.selectMetadata(id, key);
      session.body = JSON.stringify(meta ? { success: true, data: meta } : { success: false, message: '未找到meta' });
    },
    '/metadata/insert': async (session, params) => {
      const id = Number(params.get('page_id'));
      const key = params.get('key');
      const value = params.get('value');
      session.setMime('json');
      if (!id || !key || value === null) {
        session.body = JSON.stringify({ success: false, message: '缺少参数' });
        return;
      }
      const metaId = await pages.insert({ page_id: id, meta_key: key, meta_value: value } as any);
      session.body = JSON.stringify({ success: true, id: metaId });
    },
    '/metadata/update': async (session, params) => {
      const id = Number(params.get('page_id'));
      const key = params.get('key');
      const value = params.get('value');
      session.setMime('json');
      if (!id || !key || value === null) {
        session.body = JSON.stringify({ success: false, message: '缺少参数' });
        return;
      }
      const meta = await pages.selectMetadata(id, key);
      if (!meta) {
        session.body = JSON.stringify({ success: false, message: '未找到meta' });
        return;
      }
      const result = await pages.update(meta.id, { meta_value: value } as any);
      session.body = JSON.stringify({ success: true, updated: result });
    }
  };

  // 递归注册 API 路由
  for (const [routePath, handler] of Object.entries(routes)) {
    ctx.route(`/api/author${routePath}`).action(
      requireLogin(async (sess, params) => {
        sess.setMime('json');
        await handler(sess, params);
      })
    );
  }

  // 页面路由
  ctx.route('/author').action(async (session: Session) => {
    if (authority.getLoginstatus(session.sessionid)) {
      const content = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf-8');
      session.body = content;
    } else {
      session.body = `<h1>请先登录</h1>`;
    }
    session.setMime('html');
  });
}

export function disable(ctx: Context) {
  // 如果有需要可以清理资源或者注销路由
}