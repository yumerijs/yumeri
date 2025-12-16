import { EventBuffer } from './eventBuffer';
import { Context, Session } from 'yumeri';

const buffer = new EventBuffer();

export function registerRoutes(ctx: Context, basePath = '/devtool') {
  ctx.route(`${basePath}/events`).action(async (session: Session) => {
    session.setMime('json');
    session.body = JSON.stringify({ events: buffer.list() });
  });

  ctx.route(`${basePath}/events/clear`).action(async (session: Session) => {
    buffer.clear();
    session.setMime('json');
    session.body = JSON.stringify({ success: true });
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
