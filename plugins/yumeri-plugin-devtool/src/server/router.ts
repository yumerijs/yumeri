import fs from 'fs';
import path from 'path';
import { EventBuffer } from './eventBuffer';
import { Context, Session } from 'yumeri';

const buffer = new EventBuffer();

export function registerRoutes(ctx: Context, options: { basePath?: string; assetsRoot?: string } = {}) {
  const basePath = options.basePath || '/devtool';
  const core = ctx.getCore();
  const staticRoot = options.assetsRoot || core?.coreConfig?.staticDir || 'public';
  const assetsBase = path.isAbsolute(staticRoot) ? staticRoot : path.resolve(process.cwd(), staticRoot);

  ctx.route(`${basePath}/events`).action(async (session: Session) => {
    session.setMime('json');
    session.body = JSON.stringify({ events: buffer.list() });
  });

  ctx.route(`${basePath}/events/clear`).action(async (session: Session) => {
    buffer.clear();
    session.setMime('json');
    session.body = JSON.stringify({ success: true });
  });

  ctx.route(`${basePath}/context`).action(async (session: Session) => {
    const sessionId = session.sessionid;
    const latest = sessionId ? buffer.latestRoute(sessionId, basePath) : null;
    session.setMime('json');
    session.body = JSON.stringify({
      success: true,
      route: latest,
    });
  });

  // 轻量资源浏览，仅限 assetsBase 内部
  ctx.route(`${basePath}/assets`).action(async (session: Session, params: URLSearchParams) => {
    session.setMime('json');
    const raw = (params.get('path') || '/').trim() || '/';
    const targetPath = path.resolve(assetsBase, `.${raw}`);
    if (!targetPath.startsWith(assetsBase)) {
      session.body = JSON.stringify({ success: false, message: '路径越界' });
      return;
    }
    if (!fs.existsSync(targetPath)) {
      session.body = JSON.stringify({ success: false, message: '路径不存在' });
      return;
    }
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      session.body = JSON.stringify({ success: true, path: raw, items: [] });
      return;
    }
    try {
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      const items = entries.map((ent) => {
        const full = path.join(targetPath, ent.name);
        const st = fs.statSync(full);
        return {
          name: ent.name,
          type: ent.isDirectory() ? 'dir' : 'file',
          size: ent.isDirectory() ? undefined : st.size,
          mtime: st.mtimeMs,
        };
      });
      session.body = JSON.stringify({ success: true, path: raw, items });
    } catch (e) {
      session.body = JSON.stringify({ success: false, message: String(e) });
    }
  });
}

export function attachCoreEvents(ctx: Context) {
  const core = ctx.getCore();
  core.on('request:start', async (p) => { buffer.push('request:start', p); });
  core.on('request:end', async (p) => { buffer.push('request:end', p); });
  core.on('request:error', async (p) => { buffer.push('request:error', p); });
  core.on('middleware:end', async (p) => { buffer.push('middleware:end', p); });
  core.on('route:end', async (p) => { buffer.push('route:end', p); });
}
